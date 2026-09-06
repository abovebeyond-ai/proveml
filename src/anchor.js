/**
 * One anchor path for a standalone review: Hedera Consensus Service.
 *
 * A review that sits beside an action rides in the Proof-of-Control token
 * and inherits its anchor; only a review with no gateway needs its own way
 * to prove WHEN it existed. It gets one path, not a menu: a message on a
 * Hedera Consensus Service topic, submitted through Hiero (the SDK is an LF
 * Decentralized Trust project) and read back from a public mirror node,
 * which returns the message with a consensus timestamp, a sequence number
 * and a running hash that nobody, including us, can change afterwards.
 * Other ledgers stay as examples in proveml-demos, not as package features.
 *
 * What is anchored is the review root, the output root it folds in, a count
 * of the sources, and when present the sha256 of the review credential, so
 * one message vouches for the signed review as a whole. The record kept is
 * what the mirror node returned, read back the way a stranger would read it.
 *
 * Verifying needs nothing but fetch: the mirror node is a public REST API.
 * Submitting needs an operator account and the Hiero SDK
 * (`@hiero-ledger/sdk`, an optional peer dependency, imported only then), so
 * the package itself keeps its zero dependencies.
 */

import { createHash } from 'node:crypto';
import { outputRootOf, reviewRoot } from './review-credential.js';

export const ANCHOR_KIND = 'proveml-review-anchor';
export const HCS_MESSAGE_LIMIT = 1024;
export const NETWORKS = {
    mainnet: { mirror: 'https://mainnet-public.mirrornode.hedera.com', hashscan: 'https://hashscan.io/mainnet' },
    testnet: { mirror: 'https://testnet.mirrornode.hedera.com', hashscan: 'https://hashscan.io/testnet' },
};

const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function network(name) {
    const n = NETWORKS[name || 'testnet'];
    if (!n) throw new Error(`anchor: unknown Hedera network "${name}" (mainnet or testnet).`);
    return n;
}

/** The message the ledger carries. Deterministic apart from `at`, so pass it to reproduce a record. */
export function anchorPayload({ review, output, sources = 0, credential, at = new Date().toISOString() }) {
    if (!/^[0-9a-f]{64}$/.test(review || '')) throw new Error('anchorPayload: review must be a sha256 hex root.');
    if (!/^[0-9a-f]{64}$/.test(output || '')) throw new Error('anchorPayload: output must be a sha256 hex root.');
    const p = { v: 1, kind: ANCHOR_KIND, review, output, sources: Number(sources) || 0 };
    if (credential) p.credentialSha256 = sha(credential);
    p.at = at;
    return p;
}

/** The bytes that go on the topic: the payload as compact JSON, under the 1024-byte HCS limit. */
export function anchorMessage(payload) {
    const m = Buffer.from(JSON.stringify(payload), 'utf8');
    if (m.length > HCS_MESSAGE_LIMIT) throw new Error(`anchorMessage: ${m.length} bytes, over the ${HCS_MESSAGE_LIMIT}-byte HCS limit.`);
    return m;
}

/** Where a message lives on the mirror node and on HashScan. */
export function anchorLinks({ network: net = 'testnet', topicId, sequenceNumber, transactionId }) {
    const n = network(net);
    return {
        mirror: `${n.mirror}/api/v1/topics/${topicId}/messages/${sequenceNumber}`,
        hashscanTopic: `${n.hashscan}/topic/${topicId}`,
        ...(transactionId ? { hashscanTx: `${n.hashscan}/transaction/${transactionId}` } : {}),
    };
}

async function mirrorMessage(url, { fetch: f, tries = 12, wait = 2500 }) {
    let last = 0;
    for (let i = 0; i < tries; i++) {
        const res = await f(url, { headers: { accept: 'application/json' } });
        if (res.ok) return res.json();
        last = res.status;
        if (res.status !== 404) break;
        if (i + 1 < tries) await sleep(wait);
    }
    throw new Error(`mirror node ${last || 'never'} returned ${url}`);
}

async function loadSdk(sdk) {
    if (sdk) return sdk;
    try { return await import('@hiero-ledger/sdk'); } catch {
        throw new Error('anchorReview: submitting needs the Hiero SDK: npm install @hiero-ledger/sdk (verifying does not).');
    }
}

function privateKeyFrom(s, str) {
    // DER keys from the portal start with 302e (ED25519) or 3030 (ECDSA).
    return String(str).startsWith('3030') ? s.PrivateKey.fromStringECDSA(str) : s.PrivateKey.fromStringED25519(str);
}

/**
 * Submit the anchor to the topic and read it back from the mirror node.
 * Returns the record as the mirror returned it, plus the payload it stands
 * for. The operator is `{ network, accountId, privateKey, topicId }`; without
 * a topicId one is created and returned on the record so the caller can
 * write it back. `sdk` and `fetch` are injectable so a test can stand in
 * for the network.
 */
export async function anchorReview({ payload, operator, sdk, fetch: f = globalThis.fetch, tries, wait } = {}) {
    if (!payload) throw new Error('anchorReview: pass a payload (anchorPayload).');
    if (!operator || !operator.accountId || !operator.privateKey) throw new Error('anchorReview: pass an operator { network, accountId, privateKey, topicId }.');
    if (typeof f !== 'function') throw new Error('anchorReview: no fetch available.');
    const message = anchorMessage(payload);
    const net = operator.network || 'testnet';
    network(net);
    const s = await loadSdk(sdk);
    const c = net === 'mainnet' ? s.Client.forMainnet() : s.Client.forTestnet();
    c.setOperator(operator.accountId, privateKeyFrom(s, operator.privateKey));
    let topicId = operator.topicId, topicCreated = false;
    try {
        if (!topicId) {
            const rx = await new s.TopicCreateTransaction().setTopicMemo('proveml review anchors').execute(c);
            topicId = (await rx.getReceipt(c)).topicId.toString();
            topicCreated = true;
        }
        const tx = await new s.TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(c);
        const receipt = await tx.getReceipt(c);
        const seq = Number(receipt.topicSequenceNumber && receipt.topicSequenceNumber.toString());
        // HashScan reads the id as 0.0.x-seconds-nanos; the SDK prints 0.0.x@seconds.nanos.
        const transactionId = tx.transactionId.toString().replace('@', '-').replace(/\.(\d+)$/, '-$1');
        const links = anchorLinks({ network: net, topicId, sequenceNumber: seq, transactionId });
        // Keep only what the mirror node confirms.
        const body = await mirrorMessage(links.mirror, { fetch: f, ...(tries ? { tries } : {}), ...(wait !== undefined ? { wait } : {}) });
        const onLedger = Buffer.from(body.message, 'base64');
        if (!onLedger.equals(message)) throw new Error('anchorReview: the mirror node returned a different message than was submitted.');
        return {
            network: net, topicId, sequenceNumber: seq,
            consensusTimestamp: body.consensus_timestamp,
            runningHash: body.running_hash, runningHashVersion: body.running_hash_version,
            payerAccountId: body.payer_account_id, transactionId,
            ...links,
            messageSha256: sha(message), payload,
            confirmedByMirrorAt: new Date().toISOString(),
            ...(topicCreated ? { topicCreated: true } : {}),
        };
    } finally {
        if (typeof c.close === 'function') c.close();
    }
}

/**
 * What can be checked with the record alone, no network: it names a topic,
 * a sequence number and a consensus time, and its payload is a review
 * anchor whose bytes hash to what the record says went on the ledger. A
 * payload edited after the fact fails the hash. WHEN it existed is the
 * mirror node's word, not the record's: see verifyAnchor.
 */
export function checkAnchorRecord(record) {
    try {
        if (!record || typeof record !== 'object') return { ok: false, reason: 'no record' };
        if (!record.payload || record.payload.kind !== ANCHOR_KIND) return { ok: false, reason: 'payload is not a proveml review anchor' };
        if (!/^[0-9a-f]{64}$/.test(record.payload.review || '')) return { ok: false, reason: 'payload carries no review root' };
        if (!record.topicId || typeof record.sequenceNumber !== 'number') return { ok: false, reason: 'record names no topic and sequence number' };
        if (!record.consensusTimestamp) return { ok: false, reason: 'record carries no consensus timestamp' };
        network(record.network);
        const message = anchorMessage(record.payload);
        if (record.messageSha256 && record.messageSha256 !== sha(message)) return { ok: false, reason: 'payload does not hash to the message the record names' };
        return { ok: true, reason: `record names topic ${record.topicId}, sequence ${record.sequenceNumber}, consensus time ${record.consensusTimestamp}` };
    } catch (error) {
        return { ok: false, reason: `unreadable record: ${error && error.message || error}` };
    }
}

/**
 * The full check: the record holds on its own, and the mirror node still
 * returns the same bytes at the same sequence number with the same
 * consensus timestamp. The mirror's answer is what proves WHEN; the record
 * alone proves only WHAT.
 */
export async function verifyAnchor(record, { fetch: f = globalThis.fetch } = {}) {
    const local = checkAnchorRecord(record);
    if (!local.ok) return { ...local, confirmed: false };
    const { mirror } = anchorLinks(record);
    let body;
    try { body = await mirrorMessage(mirror, { fetch: f, tries: 1 }); } catch (error) { return { ok: false, confirmed: false, reason: String(error && error.message || error) }; }
    const onLedger = Buffer.from(body.message || '', 'base64');
    if (!onLedger.equals(anchorMessage(record.payload))) return { ok: false, confirmed: false, reason: 'the mirror node returns different bytes than the recorded payload', entry: body };
    if (body.consensus_timestamp !== record.consensusTimestamp) return { ok: false, confirmed: false, reason: `the mirror node dates the message ${body.consensus_timestamp}, the record says ${record.consensusTimestamp}`, entry: body };
    if (record.runningHash && body.running_hash !== record.runningHash) return { ok: false, confirmed: false, reason: 'the running hash on the mirror node differs from the record', entry: body };
    return { ok: true, confirmed: true, reason: `the mirror node confirms topic ${record.topicId}, sequence ${record.sequenceNumber}, consensus time ${body.consensus_timestamp}`, entry: body };
}

/**
 * A signer for awaitReview (or a step after credentialSigner): anchors the
 * review root and adds the record to the review as `anchor`. Runs after the
 * credential when both are used, so the message can name the credential too.
 */
export function anchorSigner({ operator, outputRoot, subjects, sources = {}, sdk, fetch: f, tries, wait } = {}) {
    if (!operator) throw new Error('anchorSigner: pass an operator.');
    const root = outputRoot || (subjects ? outputRootOf(subjects) : null);
    if (!root) throw new Error('anchorSigner: pass outputRoot or subjects.');
    return async (review) => {
        const rr = reviewRoot(review.judgements || {}, root);
        if (review.credentialRoot && review.credentialRoot !== rr) throw new Error('anchorSigner: the credential root does not match the review root; refusing to anchor a mismatch.');
        const payload = anchorPayload({ review: rr, output: root, sources: Object.keys(sources).length, credential: review.credential });
        const anchor = await anchorReview({ payload, operator, sdk, ...(f ? { fetch: f } : {}), ...(tries ? { tries } : {}), ...(wait !== undefined ? { wait } : {}) });
        return { ...review, anchor, anchorRoot: rr, outputRoot: root };
    };
}
