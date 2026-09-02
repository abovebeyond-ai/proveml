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
    assert('absence hands the reviewer the whole source', r.html.includes('see for yourself') && r.html.includes('What is iXBRL?'));
    assert('no source, no scan offer', !reviewPage({ store, subjects: [{ ...subjects[0], evidence: [subjects[0].evidence[2]] }] }).html.includes('see for yourself'));
    assert('statline names the store', r.html.includes('store tools, 1 tools'));

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
    assert('a value that sits in its quote is marked literal', /data-evidence-field="category"[^>]*data-literal/.test(r.html) === false && r.html.includes('say yes to the plain ones'));
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
    assert('actions wear the pill button', r.html.includes('class="rv-btn"'));
    assert('view switch ships', r.html.includes('data-view="full"') && r.html.includes('aria-pressed="true"'));
    assert('literal evidence not collapsed unjudged', !r.html.includes('[data-literal]:not([data-judged]):not([data-expanded])'));
    assert('no snapshot, no tip', !reviewPage({ store, subjects: [{ ...subjects[0], evidence: [subjects[0].evidence[0]] }] }).html.includes('title="What is'));
}

console.log(`\n${passed} passed, ${failed} failed\n`);

console.log('\n=== review-page: a manifested quote carries its proof ===');
{
    const man = buildManifest('What is iXBRL? iXBRL embeds extra tags into the HTML standard, and more.', { html: false });
    const r = reviewPage({ store, subjects, manifests: { ixbrl: man } });
    assert('locator names the block and root', r.html.includes('block 1 of 1, root ' + man.root.slice(0, 10)));
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
    assert('the review folds into its own root', rr.html.includes('The review itself') && rr.html.includes('ixbrl.category: yes'));
    assert('the output is the first leaf', rr.html.includes('the output itself, all of it'));
    assert('the exported recipe matches the page', reviewRootOf(rr.roots && { abcd1234: { verdict: 'fair', src: 'ixbrl', field: 'category', at: '2026-09-01T00:00:00Z' } }, rr.roots.output).root === rr.roots.review);
    assert('roots ride the return for the credential', rr.roots && /^[0-9a-f]{64}$/.test(rr.roots.review) && /^[0-9a-f]{64}$/.test(rr.roots.output) && /^[0-9a-f]{64}$/.test(rr.roots.sources.ixbrl));
    assert('no review, no roots', r.roots === null);
    const rr2 = reviewPage({ store: { ...store, 'tool:ixbrl.category': store['tool:ixbrl.category'] }, subjects: [{ ...subjects[0], claim: subjects[0].claim + ' Indeed.' }], manifests: { ixbrl: man }, committedReview: { exported: 'x', judgements: { abcd1234: { verdict: 'fair', src: 'ixbrl', field: 'category', at: '2026-09-01T00:00:00Z' } } } });
    const rootOf = (h) => /data-kind="review"[^]*?mk-root">([0-9a-f]+)</.exec(h)[1];
    assert('editing the output moves the review root', rootOf(rr.html) !== rootOf(rr2.html));
    assert('no judgements, no review tree', !r.html.includes('The review itself'));
    assert('merkle view ships with manifests', r.html.includes('data-view="merkle"') && r.html.includes('mk-leaf') && r.html.includes(man.root));
    assert('no merkle tab without manifests', !reviewPage({ store, subjects, snapshots }).html.includes('data-view="merkle"'));
    const rs = reviewPage({ store, subjects, manifests: { ixbrl: man }, signatures: { ixbrl: { issuer: 'did:web:example.org', method: 'sd-jwt-vc', verifiedAt: '2026-09-01' } } });
    assert('signed roots are named on the quote line', rs.html.includes('root signed by did:web:example.org'));
    assert('the proof carries the signer', rs.proofs[0].signedBy === 'did:web:example.org');
    assert('unsigned says so in the merkle view', r.html.includes('root unsigned'));
    assert('an attestation without a manifest refuses', throws(() => reviewPage({ store, subjects, snapshots, signatures: { ixbrl: { issuer: 'x' } } }), /signs nothing/));
    assert('a quote spanning two leaves refuses to build', throws(() => reviewPage({
        store, manifests: { ixbrl: twoLeaf },
        subjects: [{ ...subjects[0], evidence: [subjects[0].evidence[0]] }],
    }), /single leaf/));
}

process.exit(failed > 0 ? 1 : 0);
