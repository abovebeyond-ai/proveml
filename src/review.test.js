import { reviewId, emptyReview, judge, summarize, REVIEW_CSS, REVIEW_JS } from './review.js';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  ok ${name}`); }
    else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}

console.log('\n=== review: judgements keyed by content ===');
{
    const a = reviewId('ixbrl', 'inlineSupport', 'yes', 'quote text');
    assert('id is stable', a === reviewId('ixbrl', 'inlineSupport', 'yes', 'quote text'));
    assert('id changes with any part', a !== reviewId('ixbrl', 'inlineSupport', 'no', 'quote text') && a !== reviewId('ixbrl', 'inlineSupport', 'yes', 'quote text.'));

    const r = emptyReview();
    judge(r, a, 'fair', { src: 'ixbrl' });
    assert('a judgement records verdict, time and extras', r.judgements[a].verdict === 'fair' && r.judgements[a].src === 'ixbrl' && /\d{4}-/.test(r.judgements[a].at));
    const s1 = summarize(r, [a, 'other-id']);
    assert('summary counts judged and unjudged', s1.total === 2 && s1.judged === 1 && s1.unjudged.includes('other-id'), JSON.stringify(s1));

    const b = reviewId('ixbrl', 'inlineSupport', 'yes', 'quote text, revised');
    const s2 = summarize(r, [b]);
    assert('a judgement dies with its content', s2.judged === 0 && s2.orphaned.includes(a), JSON.stringify(s2));

    judge(r, a, 'flag');
    assert('re-judging replaces', r.judgements[a].verdict === 'flag');
    assert('flag is counted', summarize(r, [a]).flagged === 1);
    judge(r, a, null);
    assert('a null verdict withdraws', !(a in r.judgements));

    assert('the widget ships as strings', REVIEW_CSS.includes('data-review') && REVIEW_JS.includes('PROVEML_REVIEW_COMMITTED') && REVIEW_JS.includes('localStorage'));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
