/**
 * The review as a credential: the reviewer signs the review root.
 *
 * A hand-back is judgements in a JSON file. That is enough for the page and
 * for the person who made them; it is not enough for a stranger, or for a
 * gateway that wants "a person signed this" as evidence rather than as a
 * claim. This module turns the review into one signed object that carries
 * its own root and can be checked with nothing but a public key.
 *
 * Shape: a compact JWS, EdDSA over Ed25519, typ "proveml-review+jwt",
 * payload vct "urn:proveml:review:1". The payload carries the judgements,
 * the output root they were made against, the source roots the readings
 * stood on, and the review root that folds all of it. A verifier recomputes
 * the root from the payload under the same recipe the page uses
 * (reviewRootOf) and only then checks the signature. Change a judgement, a
 * word of the output, or a source, and the recomputed root walks away from
 * the one that was signed.
 *
 * No dependencies: node:crypto does Ed25519 and JWK import natively. The
 * key is a JWK (OKP, Ed25519); resolving an issuer's key from a did:web or
 * a registry is the caller's adapter, exactly like evidence sources are.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { buildManifest } from './manifest.js';
import { reviewRootOf } from './review-page.js';

export const REVIEW_VCT = 'urn:proveml:review:1';
export const REVIEW_TYP = 'proveml-review+jwt';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');
const json = (o) => Buffer.from(JSON.stringify(o), 'utf8');

/** The output root the page folds in as the first leaf: one line per subject, id and claim. */
export function outputRootOf(subjects) {
    return buildManifest(subjects.map((sj) => `${sj.id} ${String(sj.claim).replace(/\s+/g, ' ').trim()}`).join('\n'), { html: false }).root;
}

/** The review root: output root first, then every judgement in key order. Same recipe as the page. */
export function reviewRoot(judgements, outputRoot) {
    return reviewRootOf(judgements, outputRoot).root;
}

/** A fresh reviewer key pair as JWKs. Keep the private one out of the repo. */
export function generateReviewerKey() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateJwk = privateKey.export({ format: 'jwk' });
    const publicJwk = publicKey.export({ format: 'jwk' });
    return { privateJwk, publicJwk, kid: thumbprint(publicJwk) };
}

/** RFC 7638 thumbprint of an OKP key: a stable, key-derived id. */
export function thumbprint(publicJwk) {
    const canon = JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x });
    return createHash('sha256').update(canon).digest('base64url');
}

function summarizeJudgements(judgements) {
    const all = Object.values(judgements);
    return { judged: all.length, flagged: all.filter((v) => v.verdict === 'flag').length };
}

/**
 * Sign a review. Returns the compact JWS and the root it signed.
 * @param {object} p
 * @param {{judgements: object, signedBy?: string, exported?: string}} p.review
 * @param {string} p.outputRoot  the root of the output the judgements were made against
 * @param {Record<string,string>} [p.sources]  source id to manifest root; carried, not re-hashed
 * @param {string} p.issuer  who signs: a did:web, a mail address, a name a registry knows
 * @param {object} p.privateJwk  OKP Ed25519 private JWK
 * @param {string} [p.keyId]  defaults to the public key's thumbprint
 */
export function issueReviewCredential({ review, outputRoot, sources = {}, issuer, privateJwk, keyId }) {
    if (!review || !review.judgements) throw new Error('issueReviewCredential: expected a review with judgements.');
    if (!outputRoot) throw new Error('issueReviewCredential: expected the outputRoot the judgements were made against.');
    if (!issuer) throw new Error('issueReviewCredential: expected an issuer.');
    if (!privateJwk || privateJwk.kty !== 'OKP' || privateJwk.crv !== 'Ed25519' || !privateJwk.d) throw new Error('issueReviewCredential: expected an Ed25519 private JWK.');
    const privateKey = createPrivateKey({ key: privateJwk, format: 'jwk' });
    const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
    const kid = keyId || thumbprint(publicJwk);
    const root = reviewRoot(review.judgements, outputRoot);
    const { judged, flagged } = summarizeJudgements(review.judgements);
    const header = { alg: 'EdDSA', typ: REVIEW_TYP, kid };
    const payload = {
        vct: REVIEW_VCT, iss: issuer, iat: Math.floor(Date.now() / 1000),
        root, output: outputRoot, sources, judged, flagged,
        ...(review.signedBy ? { signedBy: review.signedBy } : {}),
        ...(review.exported ? { exported: review.exported } : {}),
        judgements: review.judgements,
    };
    const signingInput = `${b64u(json(header))}.${b64u(json(payload))}`;
    const signature = sign(null, Buffer.from(signingInput, 'utf8'), privateKey);
    return { credential: `${signingInput}.${b64u(signature)}`, root, kid };
}

/** Split a compact JWS without checking anything. */
export function decodeReviewCredential(credential) {
    const parts = String(credential || '').split('.');
    if (parts.length !== 3) throw new Error('decodeReviewCredential: not a compact JWS.');
    const header = JSON.parse(unb64u(parts[0]).toString('utf8'));
    const payload = JSON.parse(unb64u(parts[1]).toString('utf8'));
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: unb64u(parts[2]) };
}

/**
 * Check a review credential. The order matters: the root is recomputed from
 * the payload first, so a payload that does not fold to its own root fails
 * before any key is consulted; then the signature is checked against the
 * public key the caller resolved for the issuer.
 * @returns {{ok: boolean, reason?: string, payload?: object, root?: string}}
 */
export function verifyReviewCredential(credential, { publicJwk } = {}) {
    let decoded;
    try { decoded = decodeReviewCredential(credential); } catch (e) { return { ok: false, reason: e.message }; }
    const { header, payload, signingInput, signature } = decoded;
    if (header.alg !== 'EdDSA') return { ok: false, reason: `alg ${header.alg}, expected EdDSA` };
    if (header.typ !== REVIEW_TYP) return { ok: false, reason: `typ ${header.typ}, expected ${REVIEW_TYP}` };
    if (payload.vct !== REVIEW_VCT) return { ok: false, reason: `vct ${payload.vct}, expected ${REVIEW_VCT}` };
    if (!payload.judgements || !payload.output || !payload.root) return { ok: false, reason: 'payload lacks judgements, output or root' };
    const recomputed = reviewRoot(payload.judgements, payload.output);
    if (recomputed !== payload.root) return { ok: false, reason: 'review root does not refold from the payload', payload, root: recomputed };
    if (!publicJwk) return { ok: false, reason: 'no public key to check the signature against', payload, root: recomputed };
    let publicKey;
    try { publicKey = createPublicKey({ key: publicJwk, format: 'jwk' }); } catch (e) { return { ok: false, reason: `bad public key: ${e.message}`, payload }; }
    if (header.kid && header.kid !== thumbprint(publicJwk)) return { ok: false, reason: 'kid does not match the public key', payload, root: recomputed };
    const good = verify(null, Buffer.from(signingInput, 'utf8'), publicKey, signature);
    if (!good) return { ok: false, reason: 'signature does not verify', payload, root: recomputed };
    return { ok: true, payload, root: recomputed, issuer: payload.iss, kid: header.kid };
}

/**
 * A signer for awaitReview: the posted review comes back with `credential`
 * (the JWS) and `credentialRoot` beside its judgements, so the hand-back
 * file is also the signed object. Pass either `outputRoot` or `subjects`.
 */
export function credentialSigner({ issuer, privateJwk, keyId, outputRoot, subjects, sources = {} }) {
    const root = outputRoot || (subjects ? outputRootOf(subjects) : null);
    if (!root) throw new Error('credentialSigner: pass outputRoot or subjects.');
    return async (review) => {
        const { credential, root: reviewRootValue, kid } = issueReviewCredential({ review, outputRoot: root, sources, issuer, privateJwk, keyId });
        return { ...review, credential, credentialRoot: reviewRootValue, credentialKid: kid, outputRoot: root };
    };
}
