/**
 * The adversarial battery: attacks the loop must survive.
 *
 * Each test is an attack with a name, not a feature check. Some fooled us
 * once (the binding rule, the silent skip); some are the obvious next moves
 * of a careless agent or a hostile author. The rule for this file: an attack
 * either fails loudly at a gate, or shows up in the turn diff — silence is
 * the only unacceptable outcome. New attack class = new test here first.
 */
import { verifyProveml } from './verify.js';
import { diffTurns } from './diff.js';
import { buildManifest, findQuote, inclusionProof, verifyInclusion } from './manifest.js';
import { reviewId, emptyReview, judge, summarize } from './review.js';
import { reviewPage } from './review-page.js';

let passed = 0, failed = 0;
const assert = (name, c, d = '') => c ? (passed++, console.log(`  ok ${name}`)) : (failed++, console.error(`  FAIL ${name} ${d}`));

const store = {
    'student:1.name': 'Amir', 'student:1.passRate': 53,
    'offering:9.name': '5OL', 'offering:9.avgRate': 71, 'offering:9.passRate': 53,
};
const thresholds = { IS_LOW: { field: 'passRate', op: 'lt', value: 60, label: 'low', source: 'test' } };
const DOC = '@[student:1]{Amir} has a pass rate of %[passRate]{53}%. His class @[offering:9]{5OL} averages %[avgRate]{71}%.';

console.log('\n=== attack: rebinding by edit, with a coincidentally valid target ===');
{
    // offering:9 ALSO has passRate 53: after the reorder the rebound claim
    // still verifies, so verification alone is blind. The diff is not.
    const reordered = '@[student:1]{Amir} is in @[offering:9]{5OL} (%[avgRate]{71}% average) and has a pass rate of %[passRate]{53}%.';
    const v = verifyProveml(reordered, store);
    assert('verification alone is fooled (all green)', v.verified === v.total);
    const d = diffTurns(DOC, reordered, store);
    assert('the diff sees the fact change owners', d.removed.some((r) => String(r.path).includes('student:1.passRate')) && d.added.some((r) => String(r.path).includes('offering:9.passRate')));
    assert('and refuses to call the edit clean', d.clean === false);
}

console.log('\n=== attack: cutting a construct so the tokenizer skips it ===');
{
    for (const [cut, mangled] of [
        ['brace', DOC.replace('{53}', '{53')],
        ['bracket', DOC.replace('[passRate]', '[passRate')],
        ['marker split', DOC.replace('%[passRate]', '% [passRate]')],
    ]) {
        const d = diffTurns(DOC, mangled, store);
        assert(`cut at ${cut}: claims vanish but the diff reports removals`, d.removed.length > 0 && d.clean === false);
    }
}

console.log('\n=== attack: smuggling a number out of markup, dressed as verified ===');
{
    const smuggled = DOC.replace('%[avgRate]{71}%', 'a verified ✓ 71%');
    const v = verifyProveml(smuggled, store);
    assert('decoration asserts nothing: the fake checkmark adds zero verified claims', v.verified === v.total && v.total === 3);
    assert('but the bare number is counted against coverage', v.coverage.unmarked >= 1);
    const d = diffTurns(DOC, smuggled, store);
    assert('and the diff names the removal plus the new unmarked number', d.removed.length === 1 && d.next.unmarked > d.prev.unmarked && d.clean === false);
}

console.log('\n=== attack: deleting a scope opener strands the facts ===');
{
    const orphaned = 'The pass rate is %[passRate]{53}%.';
    const v = verifyProveml(orphaned, store);
    assert('a fact without context fails, never guesses', v.verified === 0 && v.errors.length === 1 && /context/i.test(v.errors[0]));
}

console.log('\n=== attack: inventing a reassuring threshold ===');
{
    const inf = (v) => v.details.find((d) => d.type === 'inference');
    const v1 = verifyProveml('@[student:1]{Amir} is ?[ok: TOTALLY_FINE]{doing fine}.', store, { thresholds });
    assert('an unregistered threshold cannot verify', inf(v1).status !== 'verified' && v1.verified < v1.total);
    const v2 = verifyProveml('@[student:1]{Amir} is ?[ok: NOT TOTALLY_FINE]{not in trouble}.', store, { thresholds });
    assert('negating the unknown does not launder it (three-valued)', inf(v2).status !== 'verified' && v2.verified < v2.total);
}

console.log('\n=== attack: splicing a quote across passages ===');
{
    const m = buildManifest('<p>The tool is safe.</p><p>For nobody was it audited.</p>');
    assert('a spliced quote finds no single leaf', findQuote(m, 'The tool is safe. For nobody') === null);
    const proof = inclusionProof(m, 0);
    assert('a proof from one manifest fails against another root', !verifyInclusion(buildManifest('<p>Other doc.</p>').root, m.leaves[0].text, proof));
}

console.log('\n=== attack: keeping the checkmark while changing what was checked ===');
{
    const id = reviewId('src', 'field', 'value', 'quote v1');
    const review = judge(emptyReview(), id, 'fair');
    const after = summarize(review, [reviewId('src', 'field', 'value', 'quote v2')]);
    assert('the old judgement is orphaned, not inherited', after.judged === 0 && after.orphaned.includes(id));
}

console.log('\n=== attack: the same pixels, different bytes ===');
{
    const nfc = 'Caf\u00E9 prices rose.';
    const nfd = 'Cafe\u0301 prices rose.';
    assert('an NFD re-encoding keeps the root (c14n-2)', buildManifest(nfc, { html: false }).root === buildManifest(nfd, { html: false }).root);
    assert('c14n-1 had this hole, pinned as history', buildManifest(nfc, { html: false, contract: 'proveml-c14n-1' }).root !== buildManifest(nfd, { html: false, contract: 'proveml-c14n-1' }).root);
    assert('zero-width smuggling is flattened', buildManifest('pay 1\u200B00 euro', { html: false }).root === buildManifest('pay 100 euro', { html: false }).root);
}

console.log('\n=== attack: Trojan Source, the display disagrees with the bytes ===');
{
    let threw = null;
    try { buildManifest('total \u202E001\u202C euro', { html: false }); } catch (e) { threw = e.message; }
    assert('bidi controls are refused, loudly and by name', /Trojan Source/.test(threw || ''));
    assert('old c14n-1 manifests still verify', (() => {
        const m = buildManifest('plain line', { html: false, contract: 'proveml-c14n-1' });
        return verifyInclusion(m.root, m.leaves[0].text, inclusionProof(m, 0));
    })());
    assert('an unknown contract is refused', (() => {
        try { buildManifest('x', { html: false, contract: 'c14n-x' }); return false; } catch { return true; }
    })());
}

console.log('\n=== attack: the same pixels, different bytes ===');
{
    const nfc = 'Caf\u00E9 prices rose.';
    const nfd = 'Cafe\u0301 prices rose.';
    assert('an NFD re-encoding keeps the root (c14n-2)', buildManifest(nfc, { html: false }).root === buildManifest(nfd, { html: false }).root);
    assert('c14n-1 had this hole, pinned as history', buildManifest(nfc, { html: false, contract: 'proveml-c14n-1' }).root !== buildManifest(nfd, { html: false, contract: 'proveml-c14n-1' }).root);
    assert('zero-width smuggling is flattened', buildManifest('pay 1\u200B00 euro', { html: false }).root === buildManifest('pay 100 euro', { html: false }).root);
}

console.log('\n=== attack: Trojan Source, the display disagrees with the bytes ===');
{
    let threw = null;
    try { buildManifest('total \u202E001\u202C euro', { html: false }); } catch (e) { threw = e.message; }
    assert('bidi controls are refused, loudly and by name', /Trojan Source/.test(threw || ''));
    assert('old c14n-1 manifests still verify', (() => {
        const m = buildManifest('plain line', { html: false, contract: 'proveml-c14n-1' });
        return verifyInclusion(m.root, m.leaves[0].text, inclusionProof(m, 0));
    })());
    assert('an unknown contract is refused', (() => {
        try { buildManifest('x', { html: false, contract: 'c14n-x' }); return false; } catch { return true; }
    })());
}

console.log('\n=== attack: invert the frame, keep the quoted bytes ===');
{
    const st = { 'r:x.name': 'The report', 'r:x.rev': '42M' };
    const subj = [{ id: 'x', title: 'X', claim: '@[r:x]{The report} cites revenue of %[rev]{42M}.', evidence: [{ field: 'rev', claimValue: '42M', basis: 'quote', sourceQuote: 'Revenue: 42M' }] }];
    const audited = buildManifest('Figures below are audited.\nRevenue: 42M.\nEnd of report.', { html: false });
    const projected = buildManifest('Figures below are projections.\nRevenue: 42M.\nEnd of report.', { html: false });
    const idOf = (h) => /data-review="([0-9a-f]+)"/.exec(h)[1];
    assert('the quoted block is byte-identical across the two frames', audited.leaves[1].hash === projected.leaves[1].hash);
    assert('the yes dies anyway: the neighborhood is in the key', idOf(reviewPage({ store: st, subjects: subj, manifests: { x: audited } }).html) !== idOf(reviewPage({ store: st, subjects: subj, manifests: { x: projected } }).html));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
