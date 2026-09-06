import {
    generateReviewerKey, issueReviewCredential, verifyReviewCredential, decodeReviewCredential,
    outputRootOf, reviewRoot, credentialSigner, thumbprint, REVIEW_VCT, REVIEW_TYP,
} from './review-credential.js';
import { reviewRootOf } from './review-page.js';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  ok ${name}`); }
    else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}

const subjects = [
    { id: 'ixbrl', claim: '@[tool:ixbrl]{iXBRL} is %[category]{inline financial tagging standard}.' },
    { id: 'lfdt', claim: '@[org:lfdt]{LF Decentralized Trust} launched with %[projectsAtLaunch]{17} projects.' },
];
const judgements = {
    '6625cbda9b4ad6d8': { verdict: 'fair', src: 'lfdt', field: 'projectsAtLaunch', at: '2026-09-02T12:41:43.973Z' },
    '0eb184ab275921c5': { verdict: 'fair', src: 'ixbrl', field: 'category', at: '2026-09-02T12:41:50.000Z' },
};
const review = { exported: '2026-09-02T12:43:31.206Z', signedBy: 'a reviewer', judgements };
const outputRoot = outputRootOf(subjects);
const { privateJwk, publicJwk, kid } = generateReviewerKey();

console.log('review-credential: roots');
assert('output root is a sha256 hex', /^[0-9a-f]{64}$/.test(outputRoot));
assert('review root matches the page recipe', reviewRoot(judgements, outputRoot) === reviewRootOf(judgements, outputRoot).root);
assert('thumbprint is stable and key-derived', thumbprint(publicJwk) === kid && kid.length > 20);

console.log('review-credential: issue and verify');
const { credential, root } = issueReviewCredential({ review, outputRoot, sources: { lfdt: 'abc' }, issuer: 'did:web:example.org', privateJwk });
const decoded = decodeReviewCredential(credential);
assert('header says EdDSA and the review typ', decoded.header.alg === 'EdDSA' && decoded.header.typ === REVIEW_TYP && decoded.header.kid === kid);
assert('payload carries vct, issuer, roots and judgements', decoded.payload.vct === REVIEW_VCT && decoded.payload.iss === 'did:web:example.org'
    && decoded.payload.root === root && decoded.payload.output === outputRoot && decoded.payload.sources.lfdt === 'abc'
    && decoded.payload.judged === 2 && decoded.payload.flagged === 0 && decoded.payload.signedBy === 'a reviewer');
const ok = verifyReviewCredential(credential, { publicJwk });
assert('verifies with the reviewer key', ok.ok === true && ok.root === root && ok.issuer === 'did:web:example.org', ok.reason || '');
assert('refuses without a key, but only after the root refolds', (() => { const r = verifyReviewCredential(credential); return r.ok === false && /no public key/.test(r.reason) && r.root === root; })());

console.log('review-credential: tampering');
const other = generateReviewerKey();
assert('another key does not verify', verifyReviewCredential(credential, { publicJwk: other.publicJwk }).ok === false);
const [h, p, s] = credential.split('.');
const tamperedPayload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
tamperedPayload.judgements['6625cbda9b4ad6d8'].verdict = 'flag';
const tampered = `${h}.${Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url')}.${s}`;
const t = verifyReviewCredential(tampered, { publicJwk });
assert('a flipped judgement stops the root from refolding, before the key is consulted', t.ok === false && /refold/.test(t.reason), t.reason || '');
const movedOutput = { ...tamperedPayload, judgements, output: 'f'.repeat(64) };
const moved = `${h}.${Buffer.from(JSON.stringify(movedOutput)).toString('base64url')}.${s}`;
assert('a changed output root stops the refold too', /refold/.test(verifyReviewCredential(moved, { publicJwk }).reason || ''));
const resigned = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
resigned.iss = 'did:web:someone.else';
const forged = `${h}.${Buffer.from(JSON.stringify(resigned)).toString('base64url')}.${s}`;
const f = verifyReviewCredential(forged, { publicJwk });
assert('a changed issuer with the old signature fails on the signature', f.ok === false && /signature/.test(f.reason), f.reason || '');
assert('garbage is refused with a reason, not a throw', verifyReviewCredential('not.a', { publicJwk }).ok === false);

console.log('review-credential: signer for awaitReview');
const signer = credentialSigner({ issuer: 'did:web:example.org', privateJwk, subjects });
const signed = await signer({ judgements, signedBy: 'a reviewer' });
assert('the signer adds the credential and the roots to the review', typeof signed.credential === 'string' && signed.credentialRoot === root && signed.outputRoot === outputRoot && signed.credentialKid === kid);
assert('what the signer produced verifies', verifyReviewCredential(signed.credential, { publicJwk }).ok === true);
let threw = false; try { credentialSigner({ issuer: 'x', privateJwk }); } catch { threw = true; }
assert('the signer refuses to sign against no output', threw);
let threw2 = false; try { issueReviewCredential({ review, outputRoot, issuer: 'x', privateJwk: publicJwk }); } catch { threw2 = true; }
assert('a public key cannot sign', threw2);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
