import { reviewPage, evidenceReviewId, reviewRootOf } from './review-page.js';
import { buildManifest, verifyInclusion, treeLevels } from './manifest.js';
import { summarize, emptyReview, judge } from './review.js';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  ok ${name}`); }
    else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}
function throws(fn, re) {
    try { fn(); return false; } catch (e) { return re.test(String(e.message)); }
}

const store = {
    'tool:ixbrl.name': 'iXBRL',
    'tool:ixbrl.category': 'inline financial tagging standard',
    'tool:ixbrl.inlineSupport': 'yes',
};
const subjects = [{
    id: 'ixbrl',
    title: 'iXBRL',
    meta: 'XBRL International, ongoing standard.',
    claim: '@[tool:ixbrl]{iXBRL} is %[category]{inline financial tagging standard}, and marks claims inline (%[inlineSupport]{yes}).',
    evidence: [
        { field: 'category', claimValue: 'inline financial tagging standard', basis: 'quote', sourceQuote: 'iXBRL embeds extra tags into the HTML standard', sourceLocator: 'what_is_ixbrl paragraph 3', sourceHref: 'raw/ixbrl.html' },
        { field: 'inlineSupport', claimValue: 'yes', basis: 'derived', note: 'Inline is the I in the name.' },
        { field: 'inferenceLayer', claimValue: 'no', basis: 'absence' },
    ],
}];
const snapshots = { ixbrl: 'What is iXBRL? iXBRL embeds   extra tags\ninto the HTML standard, and more.' };

console.log('\n=== review-page: the gate ===');
{
    const r = reviewPage({ store, subjects, snapshots, storeName: 'tools', subjectsWord: 'tools' });
    assert('verifies every claim', r.verified === 3 && r.total === 3, `${r.verified}/${r.total}`);
    assert('one review id per evidence entry', r.ids.length === 3);
    assert('page carries the readings', subjects[0].evidence.every((e) => r.html.includes(`data-review="${evidenceReviewId('ixbrl', e)}"`)));
    assert('quote survives whitespace differences', r.html.includes('iXBRL embeds extra tags'));
    assert('absence is named, not quoted', r.html.includes('rests on absence'));
    assert('absence hands the reviewer the whole source', r.html.includes('scan the whole source') && r.html.includes('What is iXBRL?'));
    assert('no source, no scan offer', !reviewPage({ store, subjects: [{ ...subjects[0], evidence: [subjects[0].evidence[2]] }] }).html.includes('see for yourself'));
    assert('the masthead names the store', r.html.includes('class="rv-doc"') && r.html.includes('>tools</span>'));

    const script = /<script>([\s\S]*?)<\/script>/.exec(r.html)[1];
    assert('embedded script parses', (() => { try { new Function(script); return true; } catch { return false; } })());
}

console.log('\n=== review-page: what refuses to build ===');
{
    assert('a claim the store does not hold', throws(() => reviewPage({
        store, snapshots,
        subjects: [{ ...subjects[0], claim: '@[tool:ixbrl]{iXBRL} is %[category]{something else}.' }],
    }), /ixbrl:/));
    assert('a quote not verbatim in the snapshot', throws(() => reviewPage({
        store,
        subjects: [{ ...subjects[0], evidence: [{ field: 'category', claimValue: 'x', basis: 'quote', sourceQuote: 'never said this' }] }],
        snapshots,
    }), /not found verbatim/));
    assert('a quote basis without a quote', throws(() => reviewPage({
        store,
        subjects: [{ ...subjects[0], evidence: [{ field: 'category', claimValue: 'x', basis: 'quote' }] }],
    }), /without a sourceQuote/));
    assert('an unknown basis', throws(() => reviewPage({
        store,
        subjects: [{ ...subjects[0], evidence: [{ field: 'category', claimValue: 'x', basis: 'vibes' }] }],
    }), /unknown basis/));
}

console.log('\n=== review-page: judgements die with the evidence ===');
{
    const before = evidenceReviewId('ixbrl', subjects[0].evidence[0]);
    const review = judge(emptyReview(), before, 'fair');
    const edited = { ...subjects[0].evidence[0], sourceQuote: 'iXBRL embeds extra tags into the HTML standard, and more' };
    const after = evidenceReviewId('ixbrl', edited);
    assert('editing the quote changes the id', before !== after);
    const r = reviewPage({ store, subjects: [{ ...subjects[0], evidence: [edited] }], snapshots });
    const s = summarize(review, r.ids);
    assert('the old judgement is orphaned', s.orphaned.includes(before) && s.judged === 0, JSON.stringify(s));
}

console.log('\n=== review-page: several quotes under one value ===');
{
    const multi = [{ ...subjects[0], evidence: [{
        field: 'category', claimValue: 'inline financial tagging standard', basis: 'quote',
        sourceQuotes: [
            { sourceQuote: 'iXBRL embeds extra tags', sourceLocator: 'p3' },
            { sourceQuote: 'into the HTML standard', sourceLocator: 'p3b' },
        ],
    }] }];
    const r = reviewPage({ store, subjects: multi, snapshots });
    assert('all quotes render with their locators', (r.html.match(/class="quote"/g) || []).length === 2 && r.html.includes('each verbatim in the'));
    assert('one bad quote in the set fails the build', throws(() => reviewPage({
        store, snapshots,
        subjects: [{ ...subjects[0], evidence: [{ field: 'category', claimValue: 'x', basis: 'quote', sourceQuotes: [{ sourceQuote: 'iXBRL embeds extra tags' }, { sourceQuote: 'never said this' }] }] }],
    }), /not found verbatim/));
    const a = evidenceReviewId('ixbrl', multi[0].evidence[0]);
    const b = evidenceReviewId('ixbrl', { ...multi[0].evidence[0], sourceQuotes: [multi[0].evidence[0].sourceQuotes[0]] });
    assert('the hash covers every quote', a !== b);
    const single = { field: 'f', claimValue: 'v', basis: 'quote', sourceQuote: 'q' };
    assert('single-quote hashes are unchanged by the feature', evidenceReviewId('x', single) === evidenceReviewId('x', { ...single, sourceQuotes: undefined }));
}

console.log('\n=== review-page: literal readings are triaged ===');
{
    const r = reviewPage({ store, subjects, snapshots });
    assert('a value that sits in its quote is marked literal', /data-evidence-field="category"[^>]*data-literal/.test(r.html) === false && r.html.includes("by: 'machine'"));
    const lit = [{ ...subjects[0], evidence: [{ field: 'category', claimValue: 'inline financial tagging standard', basis: 'quote', sourceQuote: 'iXBRL embeds extra tags into the HTML standard', sourceLocator: 'p3' },
        { field: 'inlineSupport', claimValue: 'yes', basis: 'derived' }] }];
    const store2 = { ...store, 'tool:ixbrl.category': 'inline financial tagging standard' };
    const r2 = reviewPage({ store: store2, subjects: lit, snapshots });
    assert('not literal when the value is absent from the quote', !/data-review="[^"]*" data-src="ixbrl" data-field="category"[^>]*data-literal/.test(r2.html));
    const lit2 = [{ ...subjects[0], evidence: [{ field: 'category', claimValue: 'extra tags', basis: 'quote', sourceQuote: 'iXBRL embeds extra tags into the HTML standard' }] }];
    const r3 = reviewPage({ store: { ...store, 'tool:ixbrl.category': 'extra tags' }, subjects: [{ ...lit2[0], claim: '@[tool:ixbrl]{iXBRL} is %[category]{extra tags}.' }], snapshots });
    assert('literal when the value is inside the quote', /data-field="category" data-literal/.test(r3.html));
}

console.log('\n=== review-page: committed review is baked in ===');
{
    const id = evidenceReviewId('ixbrl', subjects[0].evidence[0]);
    const committed = judge(emptyReview(), id, 'fair');
    const r = reviewPage({ store, subjects, snapshots, committedReview: committed });
    assert('committed judgements ship with the page', r.html.includes('PROVEML_REVIEW_COMMITTED') && r.html.includes(id));
    assert('committed JSON cannot break out of its script tag', !r.html.includes('</script><script>alert'));
}

console.log('\n=== review-page: the yes is keyed to the neighborhood ===');
{
    const src = 'Line one stays.\nLine two stays.\nThe fact: 42 sits here.\nLine four stays.\nLine five stays.';
    const st2 = { 'thing:x.name': 'X', 'thing:x.answer': '42' };
    const subj = () => [{ id: 'x', title: 'X', claim: '@[thing:x]{X} says %[answer]{42}.', evidence: [{ field: 'answer', claimValue: '42', basis: 'quote', sourceQuote: 'The fact: 42 sits here' }] }];
    const idOf = (h) => /data-review="([0-9a-f]+)" data-src="x" data-field="answer"/.exec(h)[1];
    const page = (text) => reviewPage({ store: st2, subjects: subj(), manifests: { x: buildManifest(text, { html: false }) } });
    const r1 = page(src);
    assert('same blocks, same key: the yes survives regeneration', idOf(r1.html) === idOf(page(src).html));
    assert('the quoted block changed: the yes dies', idOf(r1.html) !== idOf(page(src.replace('sits here.', 'sits here, truly.')).html));
    assert('an adjacent block changed: the yes dies too', idOf(r1.html) !== idOf(page(src.replace('Line two stays.', 'Line two changed.')).html));
    assert('a distant block changed: the yes survives', idOf(r1.html) === idOf(page(src.replace('Line five stays.', 'Line five changed.')).html));
    const r4 = reviewPage({ store: st2, subjects: subj(), snapshots: { x: src.replace(/\n/g, ' ') } });
    assert('without a manifest the key is quote-bound as before', idOf(r4.html) === evidenceReviewId('x', subj()[0].evidence[0]));
}

console.log('\n=== review-page: hover context and brand ===');
{
    const r = reviewPage({ store, subjects, snapshots });
    assert('quote carries its neighbourhood', /title="What is iXBRL\? <b>iXBRL embeds extra tags into the HTML standard<\/b>, and more\."/.test(r.html));
    assert('default lockup is proveml', r.html.includes('pml-name">proveml'));
    assert('no unasked provenance line', !r.html.includes(' on proveml.'));
    const b = reviewPage({ store, subjects, snapshots, brand: { mark: '(^_^)', name: 'vera' } });
    assert('brand fronts the lockup', b.html.includes('brand-mark">(^_^)') && b.html.includes('pml-name">vera'));
    assert('provenance moves to the statline', / on proveml\.<\/p>/.test(b.html));
    assert('no middle-dot chains anywhere', !r.html.includes('\u00B7'));
    assert('no pills on silent actions', !r.html.includes('rv-pill'));
    assert('the primary action is a rectangular button', r.html.includes('class="rv-btn rv-primary"') && !/rv-btn[^{]*border-radius:999px/.test(r.html));
    assert('view switch ships', r.html.includes('data-view="full"') && r.html.includes('aria-pressed="true"'));
    assert('literal evidence not collapsed unjudged', !r.html.includes('[data-literal]:not([data-judged]):not([data-expanded])'));
    assert('no snapshot, no tip', !reviewPage({ store, subjects: [{ ...subjects[0], evidence: [subjects[0].evidence[0]] }] }).html.includes('title="What is'));
}


console.log('review-page: the lockup is neutral unless a brand is given');
{
    const plain = reviewPage({ store, subjects, snapshots }).html;
    assert('default lockup names proveml, not a product', /<span class="pml-name">proveml<\/span>/.test(plain) && !/pml-name">vera</.test(plain));
    const branded = reviewPage({ store, subjects, snapshots, brand: { name: 'vera', mark: '(^_^)' } }).html;
    assert('a brand replaces the name and the mark', /<span class="brand-mark">\(\^_\^\)<\/span><span class="pml-name">vera<\/span>/.test(branded));
}


console.log('review-page: grades ride beside the reading and into the judgement');
{
    const graded = [{ ...subjects[0], evidence: subjects[0].evidence.map((e, i) => (i === 0 ? { ...e, grade: 'inferred' } : e)) }];
    const html = reviewPage({ store, subjects: graded, snapshots }).html;
    assert('the grade shows as a chip in the evidence head', /<span class="mk-slot ev-grade"[^>]*>inferred<\/span>/.test(html));
    assert('the reading carries the grade and what a yes makes of it', /data-grade="inferred" data-grade-on-yes="inferred:signed"/.test(html));
    assert('an ungraded reading carries nothing', !/data-field="inlineSupport"[^>]*data-grade=/.test(html));
    assert('the page script records grade and satisfies on a yes', html.includes("satisfies: el.dataset.gradeOnYes"));
    const custom = reviewPage({ store, subjects: graded, snapshots, gradeOnYes: { inferred: 'clerk-signed' } }).html;
    assert('the upgrade map is the caller\'s', /data-grade-on-yes="clerk-signed"/.test(custom));
}

// Visibility: a withheld source travels as ciphertext the reader's device opens; a sealed one as hashes.
{
    const { createDecipheriv } = await import('node:crypto');
    const heldText = 'What is iXBRL?\niXBRL embeds extra tags into the HTML standard, and more.\nThat is the whole of it.';
    const man = buildManifest(heldText, 'held');
    const key = Buffer.alloc(32, 7); const keyB64 = key.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const dec = (aad, ct, nonce) => { const b = (x) => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); const buf = b(ct); const d = createDecipheriv('aes-256-gcm', key, b(nonce)); d.setAAD(Buffer.from(aad)); d.setAuthTag(buf.subarray(buf.length - 16)); return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'); };
    const subj = [{ ...subjects[0], id: 'held', evidence: [subjects[0].evidence[0]] }];
    assert('withheld needs its key', throws(() => reviewPage({ store, subjects: subj, snapshots: { held: heldText }, manifests: { held: man }, visibility: { held: 'withheld' } }), /needs its content key/));
    const r = reviewPage({ store, subjects: subj, snapshots: { held: heldText }, manifests: { held: man }, visibility: { held: 'withheld' }, contentKeys: { held: keyB64 } });
    assert('withheld: the quote is not on the page in clear', !r.html.includes('iXBRL embeds extra tags into the HTML standard') && !r.html.includes('embeds   extra tags'));
    const q = r.html.match(/<p class="quote rv-locked" data-source="held" data-root="([^"]+)" data-i="(\d+)" data-hash="([^"]+)" data-qct="([^"]+)" data-qnonce="([^"]+)">/);
    assert('withheld: the quote travels encrypted with its block', !!q && q[1] === man.root);
    assert('withheld: the device decrypts the quote', !!q && dec(`${q[1]}:q:${q[2]}`, q[4], q[5]) === 'iXBRL embeds extra tags into the HTML standard');
    const snap = r.html.match(/<script type="application\/json" id="snap-held" data-enc="1">([\s\S]*?)<\/script>/);
    assert('withheld: the archive travels as an encrypted manifest', !!snap && JSON.parse(snap[1]).leaves.every((l) => l.ct && l.nonce && !l.text));
    assert('withheld: a leaf decrypts to the block', !!snap && dec(`${man.root}:1`, JSON.parse(snap[1]).leaves[1].ct, JSON.parse(snap[1]).leaves[1].nonce) === man.leaves[1].text);
    assert('withheld: the merkle view carries no text', r.html.includes('class="rv-locked-text" data-source="held"') && !r.html.includes('What is iXBRL?'));
    assert('withheld: the whole-source button waits for the key', r.html.includes('data-hl="" data-hl-locked'));
    const sealed = reviewPage({ store, subjects: subj, snapshots: { held: heldText }, manifests: { held: man }, visibility: { held: 'sealed' } });
    assert('sealed: only the hash travels', sealed.html.includes('class="quote rv-sealed"') && !sealed.html.includes('embeds extra') && !sealed.html.includes('id="snap-held"'));
    assert('sealed: no whole-source button', !sealed.html.includes('class="rv-link rv-see"'));
    assert('the verdict is unchanged by visibility', r.verified === reviewPage({ store, subjects: subj, snapshots: { held: heldText }, manifests: { held: man } }).verified);
}

// Who stands behind this: the answer first, sources weakest first, approvals live, a verify button.
{
    const man = buildManifest('What is iXBRL? iXBRL embeds extra tags into the HTML standard, and more.', { html: false });
    const subj = [{ ...subjects[0], evidence: [subjects[0].evidence[0]] }];
    const r = reviewPage({ store, subjects: subj, manifests: { ixbrl: man }, sourceTitles: { ixbrl: 'the iXBRL page' }, sourceGroups: [{ title: 'works it cites', ids: ['ixbrl'] }],
        signatures: { ixbrl: { level: 'witnessed', issuer: 'x', method: 'tls-transport+rfc3161', transport: { host: 'x' }, witness: { url: 'w', archive: 'a', at: 't' }, timestamp: { tsa: 'f' } } },
        approvals: { policy: { mustApprove: ['shane@example.org', 'ilse@example.org'] }, approvals: [{ by: 'ilse@example.org', root: 'r1', at: '2026-09-09T10:00:00Z' }] } });
    assert('the third tab is named for the reader', r.html.includes('>who stands behind this</button>'));
    assert('the answer comes first', r.html.includes('class="merkle bh" data-sub="behind"') && r.html.includes('<b data-k="ok">Backed</b> by 1 sources'));
    assert('a source carries its rungs as words', /class="m">copy, checked live, archived, timestamped</.test(r.html));
    assert('the policy is said in words', r.html.includes('<b>shane@example.org and ilse@example.org</b> must all approve'));
    assert('the approvals travel for the live comparison', r.html.includes('data-approvals="') && r.html.includes('ilse@example.org'));
    assert('a stranger has a verify button', r.html.includes('id="bh-verify"'));
    const weak = reviewPage({ store, subjects: subj, manifests: { ixbrl: man }, localSources: ['ixbrl'], runs: { ixbrl: { command: 'x', cwd: '.', repo: { commit: 'abc', uncommittedChanges: 0 }, startedAt: '2026-09-03T10:00:00Z', durationMs: 12, exitCode: 0, sameAsSnapshot: false, stdoutSha256: 'deadbeefdeadbeef', stderrTail: [] } } });
    assert('a source that differs on rerun comes first, in amber', weak.html.includes('<b data-k="let">1 to look at</b>') && weak.html.includes('class="let">rerun on 2026-09-03 gave different bytes'));
}

console.log(`\n${passed} passed, ${failed} failed\n`);

console.log('\n=== review-page: a manifested quote carries its proof ===');
{
    const man = buildManifest('What is iXBRL? iXBRL embeds extra tags into the HTML standard, and more.', { html: false });
    const r = reviewPage({ store, subjects, manifests: { ixbrl: man } });
    assert('locator names the block and root', r.html.includes('block 1 of 1, root <code class="h" title="' + man.root + '">' + man.root.slice(0, 12)));
    assert('the proof rides the return', r.proofs.length === 1 && r.proofs[0].subject === 'ixbrl' && r.proofs[0].field === 'category');
    assert('a stranger can verify it', verifyInclusion(man.root, man.leaves[r.proofs[0].leafIndex].text, r.proofs[0].proof));
    assert('a tampered root fails', !verifyInclusion(man.root.replace(/^./, man.root[0] === 'a' ? 'b' : 'a'), man.leaves[0].text, r.proofs[0].proof));
    assert('manifest stands in for the snapshot', r.html.includes('title="What is iXBRL?'));
    assert('a quote outside every leaf refuses to build', throws(() => reviewPage({
        store, manifests: { ixbrl: man },
        subjects: [{ ...subjects[0], evidence: [{ field: 'category', claimValue: 'x', basis: 'quote', sourceQuote: 'never said this' }] }],
    }), /quote not found verbatim/));
    const twoLeaf = buildManifest('iXBRL embeds extra tags\ninto the HTML standard', { html: false });
    assert('hovering explains the proof in words', r.html.includes('recompute the blue spine up to the root'));
    assert('a promoted node is marked carried', /mk-carried/.test(reviewPage({ store, subjects: [{ ...subjects[0], evidence: [] }], manifests: { ixbrl: buildManifest('x1\nx2\nx3\nx4\nx5\nx6', { html: false }) } }).html));
    assert('the tree is drawn', r.html.includes('mk-tree') && r.html.includes('mk-node-root'));
    assert('levels pair up CT-style', JSON.stringify(treeLevels(buildManifest('a\nb\nc\nd\ne\nf', { html: false })).map((l) => l.length)) === '[6,3,2,1]');
    const rr = reviewPage({ store, subjects, manifests: { ixbrl: man }, committedReview: { exported: 'x', judgements: { abcd1234: { verdict: 'fair', src: 'ixbrl', field: 'category', at: '2026-09-01T00:00:00Z' } } } });
    assert('the review folds into its own root', rr.html.includes('Approvals, going out') && rr.html.includes('PROVEML_REVIEW_COMMITTED') && rr.html.includes('ixbrl') && rr.html.includes('"field":"category"'));
    assert('the output is the first leaf', /data-output-root="[0-9a-f]{64}"/.test(rr.html) && rr.html.includes("['output ' + host.dataset.outputRoot]"));
    assert('the exported recipe matches the page', reviewRootOf(rr.roots && { abcd1234: { verdict: 'fair', src: 'ixbrl', field: 'category', at: '2026-09-01T00:00:00Z' } }, rr.roots.output).root === rr.roots.review);
    assert('roots ride the return for the credential', rr.roots && /^[0-9a-f]{64}$/.test(rr.roots.review) && /^[0-9a-f]{64}$/.test(rr.roots.output) && /^[0-9a-f]{64}$/.test(rr.roots.sources.ixbrl));
    assert('no review, still a root over the output alone', r.roots && /^[0-9a-f]{64}$/.test(r.roots.output) && r.roots.review === reviewRootOf({}, r.roots.output).root);
    const rr2 = reviewPage({ store: { ...store, 'tool:ixbrl.category': store['tool:ixbrl.category'] }, subjects: [{ ...subjects[0], claim: subjects[0].claim + ' Indeed.' }], manifests: { ixbrl: man }, committedReview: { exported: 'x', judgements: { abcd1234: { verdict: 'fair', src: 'ixbrl', field: 'category', at: '2026-09-01T00:00:00Z' } } } });
    const rootOf = (h) => /data-kind="review"[^]*?mk-root">([0-9a-f]+)</.exec(h)[1];
    assert('editing the output moves the review root', rootOf(rr.html) !== rootOf(rr2.html));
    assert('no judgements, no review tree', !r.html.includes('The review itself'));
    assert('merkle view ships with manifests', r.html.includes('data-view="merkle"') && r.html.includes('mk-leaf') && r.html.includes(man.root));
    assert('no merkle tab without manifests', !reviewPage({ store, subjects, snapshots }).html.includes('data-view="merkle"'));
    const rs = reviewPage({ store, subjects, manifests: { ixbrl: man }, signatures: { ixbrl: { issuer: 'did:web:example.org', method: 'sd-jwt-vc', verifiedAt: '2026-09-01' } } });
    assert('signed roots are named on the quote line', rs.html.includes('root signed by did:web:example.org'));
    assert('the proof carries the signer', rs.proofs[0].signedBy === 'did:web:example.org');
    assert('unwitnessed says so in the provenance view', r.html.includes('root unwitnessed'));
    assert('an attestation without a manifest refuses', throws(() => reviewPage({ store, subjects, snapshots, signatures: { ixbrl: { issuer: 'x' } } }), /signs nothing/));
    assert('a quote spanning two leaves refuses to build', throws(() => reviewPage({
        store, manifests: { ixbrl: twoLeaf },
        subjects: [{ ...subjects[0], evidence: [subjects[0].evidence[0]] }],
    }), /single leaf/));
}

process.exit(failed > 0 ? 1 : 0);


// === a verifier mismatch: refused by default, carried on request ===
{
    console.log('\n=== review-page: a mismatch is the most important thing to show ===');
    const store = { 'co:apple.name': 'Apple', 'co:apple.revenue': 391 };
    const subjects = [{ id: 's1', title: 't', claim: '@[co:apple]{Apple} made %[revenue]{420}.', evidence: [{ field: 'revenue', claimValue: '420', basis: 'derived', note: 'n' }] }];
    let refused = false; try { reviewPage({ store, subjects }); } catch (e) { refused = /should be 391/.test(e.message); }
    assert('refused without allowMismatch', refused);
    const r = reviewPage({ store, subjects, allowMismatch: true });
    assert('carried with allowMismatch, red and named', r.html.includes('data-mismatch="391"') && r.html.includes('proveml-mismatch') && r.html.includes('the verifier disagrees: the source says 391'));
    assert('the mismatch does not count as verified', r.verified === 1 && r.total === 2);
    assert('a yes on it is guarded', r.html.includes('rv-guard'));
}

test('a reading may carry its own question and basis label', () => {
    const { html } = reviewPage({
        store: { 'p:1.name': 'this paragraph', 'p:1.v1': '999' },
        subjects: [{ id: 'p1', title: '', claim: 'It says %[p:1.v1]{999} things.', evidence: [{ field: 'p:1.v1', claimValue: '999', basis: 'derived', note: 'nowhere', question: 'do you stand behind this as written?', basisLabel: 'not found in the files' }] }],
    });
    assert.ok(html.includes('do you stand behind this as written?'));
    assert.ok(html.includes('not found in the files'));
    assert.ok(!html.includes('did it read this right?'));
});
