import {
    anchorPayload, anchorMessage, anchorLinks, anchorReview, checkAnchorRecord, verifyAnchor, anchorSigner,
    ANCHOR_KIND, HCS_MESSAGE_LIMIT,
} from './anchor.js';
import { outputRootOf, reviewRoot, generateReviewerKey, credentialSigner } from './review-credential.js';
import { createHash } from 'node:crypto';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  ok ${name}`); }
    else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}
const sha = (b) => createHash('sha256').update(b).digest('hex');

const subjects = [
    { id: 'ixbrl', claim: '@[tool:ixbrl]{iXBRL} is %[category]{inline financial tagging standard}.' },
    { id: 'lfdt', claim: '@[org:lfdt]{LF Decentralized Trust} launched with %[projectsAtLaunch]{17} projects.' },
];
const judgements = {
    '6625cbda9b4ad6d8': { verdict: 'fair', src: 'lfdt', field: 'projectsAtLaunch', at: '2026-09-02T12:41:43.973Z' },
    '0eb184ab275921c5': { verdict: 'fair', src: 'ixbrl', field: 'category', at: '2026-09-02T12:41:50.000Z' },
};
const output = outputRootOf(subjects);
const review = reviewRoot(judgements, output);
const operator = { network: 'testnet', accountId: '0.0.1001', privateKey: '302e020100300506032b657004220420' + '11'.repeat(32), topicId: '0.0.5555' };

/**
 * A stand-in for the Hiero SDK and the mirror node: the topic is an array,
 * the mirror serves it after one 404 so the read-back has to wait, like the
 * real one. Nothing here reaches the network.
 */
function fakeLedger({ lagOnce = true, tamper = null } = {}) {
    const topic = [];
    let pending = lagOnce;
    const sdk = {
        PrivateKey: { fromStringED25519: (s) => ({ ed: s }), fromStringECDSA: (s) => ({ ec: s }) },
        Client: { forTestnet: () => ({ operator: null, setOperator(id, key) { this.operator = { id, key }; }, close() { this.closed = true; } }), forMainnet: () => { throw new Error('mainnet not in this test'); } },
        TopicCreateTransaction: class { setTopicMemo() { return this; } async execute() { return { getReceipt: async () => ({ topicId: { toString: () => '0.0.9999' } }) }; } },
        TopicMessageSubmitTransaction: class {
            setTopicId(id) { this.id = id; return this; }
            setMessage(m) { this.m = Buffer.from(m); return this; }
            async execute(c) {
                if (!c.operator) throw new Error('no operator set');
                const seq = topic.push({ message: this.m.toString('base64'), consensus_timestamp: `17884707${10 + topic.length}.000000001`, running_hash: sha(`rh${topic.length}`), running_hash_version: 3, payer_account_id: c.operator.id, sequence_number: topic.length, topic_id: this.id });
                return { transactionId: { toString: () => `${c.operator.id}@1788470702.863049633` }, getReceipt: async () => ({ topicSequenceNumber: { toString: () => String(seq) } }) };
            }
        },
    };
    const fetch = async (url) => {
        const m = url.match(/\/topics\/([^/]+)\/messages\/(\d+)$/);
        if (!m) return { ok: false, status: 400, json: async () => ({}), text: async () => 'bad url' };
        if (pending) { pending = false; return { ok: false, status: 404, json: async () => ({}), text: async () => 'not yet' }; }
        const entry = topic[Number(m[2]) - 1];
        if (!entry) return { ok: false, status: 404, json: async () => ({}), text: async () => 'no such message' };
        return { ok: true, status: 200, json: async () => (tamper ? tamper(entry) : entry), text: async () => '' };
    };
    return { sdk, fetch, topic };
}

console.log('anchor: payload and message');
const payload = anchorPayload({ review, output, sources: 2, at: '2026-09-06T20:00:00.000Z' });
assert('payload is a review anchor', payload.kind === ANCHOR_KIND && payload.v === 1);
assert('payload carries both roots', payload.review === review && payload.output === output && payload.sources === 2);
assert('payload names no credential when there is none', !('credentialSha256' in payload));
assert('a credential is named by its hash', anchorPayload({ review, output, credential: 'eyJ.abc.def' }).credentialSha256 === sha('eyJ.abc.def'));
assert('a non-root review is refused', (() => { try { anchorPayload({ review: 'x', output }); return false; } catch { return true; } })());
assert('message is compact JSON under the HCS limit', anchorMessage(payload).length < HCS_MESSAGE_LIMIT && anchorMessage(payload).toString() === JSON.stringify(payload));
assert('an oversized message is refused', (() => { try { anchorMessage({ ...payload, pad: 'x'.repeat(HCS_MESSAGE_LIMIT) }); return false; } catch { return true; } })());
const links = anchorLinks({ network: 'testnet', topicId: '0.0.5555', sequenceNumber: 3, transactionId: '0.0.1-1-2' });
assert('links point at the mirror node and HashScan', links.mirror.endsWith('/api/v1/topics/0.0.5555/messages/3') && links.hashscanTopic.endsWith('/testnet/topic/0.0.5555') && links.hashscanTx.endsWith('/transaction/0.0.1-1-2'));
assert('an unknown network is refused', (() => { try { anchorLinks({ network: 'previewnet', topicId: '0.0.1', sequenceNumber: 1 }); return false; } catch { return true; } })());

console.log('anchor: submit and read back');
{
    const { sdk, fetch, topic } = fakeLedger();
    const record = await anchorReview({ payload, operator, sdk, fetch, wait: 0 });
    assert('the message landed on the topic', topic.length === 1 && Buffer.from(topic[0].message, 'base64').toString() === JSON.stringify(payload));
    assert('record is what the mirror returned', record.sequenceNumber === 1 && record.consensusTimestamp === topic[0].consensus_timestamp && record.runningHash === topic[0].running_hash);
    assert('record names topic, payer and transaction', record.topicId === '0.0.5555' && record.payerAccountId === '0.0.1001' && record.transactionId === '0.0.1001-1788470702-863049633');
    assert('record carries the payload and its hash', record.payload === payload && record.messageSha256 === sha(anchorMessage(payload)));
    assert('record feeds the review page shape', record.mirror && record.hashscanTopic && record.hashscanTx && record.network === 'testnet');
    assert('no topic is created when one is given', !record.topicCreated);

    const created = await anchorReview({ payload, operator: { ...operator, topicId: undefined }, sdk, fetch, wait: 0 });
    assert('without a topic one is created and returned', created.topicCreated === true && created.topicId === '0.0.9999');

    console.log('anchor: check offline');
    assert('a fresh record checks', checkAnchorRecord(record).ok);
    assert('an edited payload fails the hash', !checkAnchorRecord({ ...record, payload: { ...payload, review: 'f'.repeat(64) } }).ok);
    assert('a record without consensus time fails', !checkAnchorRecord({ ...record, consensusTimestamp: undefined }).ok);
    assert('a foreign payload kind fails', !checkAnchorRecord({ ...record, payload: { ...payload, kind: 'other' }, messageSha256: undefined }).ok);
    assert('garbage fails without throwing', !checkAnchorRecord(null).ok && !checkAnchorRecord('x').ok);

    console.log('anchor: verify against the mirror');
    const v = await verifyAnchor(record, { fetch });
    assert('the mirror confirms the record', v.ok && v.confirmed, v.reason);
    const moved = await verifyAnchor({ ...record, consensusTimestamp: '1.000000000' }, { fetch });
    assert('a record claiming another time is not confirmed', !moved.ok && !moved.confirmed && /dates the message/.test(moved.reason));
    const tampered = fakeLedger({ lagOnce: false, tamper: (e) => ({ ...e, message: Buffer.from('{"v":1}').toString('base64') }) });
    await anchorReview({ payload, operator, sdk: tampered.sdk, fetch: async (u) => { const r = await tampered.fetch(u); return { ...r, json: async () => tampered.topic[0] }; }, wait: 0 });
    const bytes = await verifyAnchor(record, { fetch: tampered.fetch });
    assert('different bytes on the mirror are not confirmed', !bytes.ok && /different bytes/.test(bytes.reason));
    const gone = await verifyAnchor({ ...record, sequenceNumber: 42 }, { fetch });
    assert('a missing message is not confirmed', !gone.ok && !gone.confirmed);
}

console.log('anchor: refusals');
{
    const { sdk, fetch } = fakeLedger();
    assert('no operator is refused', await anchorReview({ payload, sdk, fetch }).then(() => false, (e) => /operator/.test(e.message)));
    assert('no payload is refused', await anchorReview({ operator, sdk, fetch }).then(() => false, (e) => /payload/.test(e.message)));
    assert('without the SDK the error names the install', await anchorReview({ payload, operator, fetch, sdk: undefined }).then(() => false, (e) => /Hiero SDK|hiero-ledger/.test(e.message)));
    const mismatch = fakeLedger({ lagOnce: false, tamper: (e) => ({ ...e, message: Buffer.from('{"v":2}').toString('base64') }) });
    assert('a mirror returning other bytes at submit is refused', await anchorReview({ payload, operator, sdk: mismatch.sdk, fetch: mismatch.fetch, wait: 0 }).then(() => false, (e) => /different message/.test(e.message)));
}

console.log('anchor: as a signer');
{
    const { sdk, fetch } = fakeLedger();
    const signer = anchorSigner({ operator, subjects, sources: { ixbrl: 'a'.repeat(64), lfdt: 'b'.repeat(64) }, sdk, fetch, wait: 0 });
    const signed = await signer({ exported: '2026-09-02T12:43:31.206Z', judgements });
    assert('the review gains an anchor over its own root', signed.anchor && signed.anchorRoot === review && signed.anchor.payload.review === review);
    assert('the anchor counts the sources', signed.anchor.payload.sources === 2);
    assert('the signer leaves the judgements alone', signed.judgements === judgements);

    const { privateJwk } = generateReviewerKey();
    const withCredential = credentialSigner({ issuer: 'did:web:example.org', privateJwk, subjects });
    const both = await signer(await withCredential({ exported: '2026-09-02T12:43:31.206Z', judgements }));
    assert('after the credential, the anchor names it', both.anchor.payload.credentialSha256 === sha(both.credential));
    assert('credential root and anchor root agree', both.credentialRoot === both.anchorRoot);
    assert('a review whose credential root disagrees is refused', await signer({ judgements, credentialRoot: 'c'.repeat(64) }).then(() => false, (e) => /mismatch/.test(e.message)));
    assert('a signer without operator is refused', (() => { try { anchorSigner({ subjects }); return false; } catch { return true; } })());
    assert('a signer without output is refused', (() => { try { anchorSigner({ operator }); return false; } catch { return true; } })());
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
