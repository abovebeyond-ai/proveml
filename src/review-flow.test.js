import { awaitReview } from './review-flow.js';
import { evidenceReviewId } from './review-page.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
mkdirSync('audit-snapshots-test-dir', { recursive: true });
writeFileSync('audit-snapshots-test-dir/a.txt', 'snapshot body');
process.on('exit', () => rmSync('audit-snapshots-test-dir', { recursive: true, force: true }));

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  ok ${name}`); }
    else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}

const store = {
    'tool:ixbrl.name': 'iXBRL',
    'tool:ixbrl.category': 'inline financial tagging standard',
};
const subjects = [{
    id: 'ixbrl',
    title: 'iXBRL',
    claim: '@[tool:ixbrl]{iXBRL} is %[category]{inline financial tagging standard}.',
    evidence: [
        { field: 'category', claimValue: 'inline financial tagging standard', basis: 'quote', sourceQuote: 'embeds extra tags' },
        { field: 'inferenceLayer', claimValue: 'no', basis: 'absence' },
    ],
}];
const snapshots = { ixbrl: 'iXBRL embeds extra tags into HTML.' };
const fairId = evidenceReviewId('ixbrl', subjects[0].evidence[0]);

console.log('\n=== review-flow: the gate is one awaitable step ===');
{
    let signerSaw = null;
    const done = awaitReview({
        store, subjects, snapshots,
        open: false,
        signedBy: 'test-reviewer',
        signer: (review) => { signerSaw = review; return { ...review, signature: 'adapter-was-here' }; },
        assets: { '/snap/': 'audit-snapshots-test-dir' },
        onServe: async (url) => {
            const page = await (await fetch(url)).text();
            assert('an asset under a prefix serves', (await fetch(url + 'snap/a.txt')).status === 200 && (await (await fetch(url + 'snap/a.txt')).text()) === 'snapshot body');
            assert('a path outside the prefix is 404', (await fetch(url + 'nope.html')).status === 404);
            assert('traversal is refused', [403, 404].includes((await fetch(url + 'snap/../review-flow.test.js')).status));
            assert('served page is submittable', page.includes('PROVEML_REVIEW_SUBMIT'));
            assert('served page carries the readings', page.includes(`data-review="${fairId}"`));
            const res = await fetch(`${url}review`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ judgements: { [fairId]: { verdict: 'fair', at: new Date().toISOString() } } }),
            });
            assert('the post is accepted', res.ok);
        },
    });
    const { review, summary } = await done;
    assert('the flow resumes with the signed review', review.judgements[fairId].verdict === 'fair');
    assert('signedBy and signedAt are recorded before the signer runs', signerSaw.signedBy === 'test-reviewer' && /\d{4}-/.test(signerSaw.signedAt));
    assert('the signer adapter shapes the attestation', review.signature === 'adapter-was-here');
    assert('the summary keeps unjudged visible to the caller', summary.total === 2 && summary.judged === 1 && summary.unjudged.length === 1, JSON.stringify(summary));
}

console.log('\n=== review-flow: a signer that throws fails the gate ===');
{
    let failedAsExpected = false;
    try {
        await awaitReview({
            store, subjects, snapshots,
            open: false,
            signer: () => { throw new Error('key unavailable'); },
            onServe: (url) => fetch(`${url}review`, { method: 'POST', body: JSON.stringify({ judgements: {} }) }),
        });
    } catch (error) {
        failedAsExpected = /key unavailable/.test(String(error.message));
    }
    assert('the promise rejects with the signer error', failedAsExpected);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
