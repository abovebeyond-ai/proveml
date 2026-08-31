import { reviewPage, evidenceReviewId } from './review-page.js';
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

console.log('\n=== review-page: committed review is baked in ===');
{
    const id = evidenceReviewId('ixbrl', subjects[0].evidence[0]);
    const committed = judge(emptyReview(), id, 'fair');
    const r = reviewPage({ store, subjects, snapshots, committedReview: committed });
    assert('committed judgements ship with the page', r.html.includes('PROVEML_REVIEW_COMMITTED') && r.html.includes(id));
    assert('committed JSON cannot break out of its script tag', !r.html.includes('</script><script>alert'));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
