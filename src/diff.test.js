import { diffTurns, formatTurnDiff } from './diff.js';

let passed = 0, failed = 0;
const assert = (name, c, d = '') => c ? (passed++, console.log(`  ok ${name}`)) : (failed++, console.error(`  FAIL ${name} ${d}`));

const store = {
    'student:1.name': 'Amir',
    'student:1.passRate': 53,
    'offering:9.name': '5OL',
    'offering:9.avgRate': 71,
};

const TURN1 = '@[student:1]{Amir} has a pass rate of %[passRate]{53}%. His class @[offering:9]{5OL} averages %[avgRate]{71}%.';

console.log('\n=== diff: an untouched edit is clean ===');
{
    const d = diffTurns(TURN1, TURN1 + ' Nothing numeric here changed.', store);
    assert('no claims moved', d.removed.length === 0 && d.added.length === 0);
    assert('one leaf changed, and it is named', d.leaves.changed === 1 && d.leaves.changedTexts[0].includes('Nothing numeric'));
    assert('clean', d.clean === true && formatTurnDiff(d).startsWith('clean edit'));
}

console.log('\n=== diff: the silent skip is caught ===');
{
    // A partial edit cuts through the construct; the tokenizer skips it silently.
    const mangled = TURN1.replace('%[passRate]{53}%', '%[passRate]{53%');
    const d = diffTurns(TURN1, mangled, store);
    assert('the lost claim is among the removed (a broken brace can swallow more than one)', d.removed.some((r) => r.type === 'fact' && String(r.value) === '53') && d.removed.length >= 1);
    assert('not clean, and the log shouts', d.clean === false && formatTurnDiff(d).includes('REMOVED'));
}

console.log('\n=== diff: rebinding by edit shows as removed plus added ===');
{
    // The agent moves the class sentence ABOVE the pass-rate fact: carry-forward
    // rebinds the fact from the student to the offering.
    const reordered = '@[student:1]{Amir} is in @[offering:9]{5OL} (%[avgRate]{71}% average) and has a pass rate of %[passRate]{53}%.';
    const d = diffTurns(TURN1, reordered, store);
    const removedPaths = d.removed.map((r) => r.path || r.key);
    const addedPaths = d.added.map((r) => r.path || r.key);
    assert('the fact left its old path', removedPaths.some((p) => String(p).includes('student:1.passRate')));
    assert('and reappeared bound elsewhere', addedPaths.some((p) => String(p).includes('offering:9.passRate')));
    assert('not clean', d.clean === false);
}

console.log('\n=== diff: a number escaping its markup is flagged ===');
{
    const escaped = TURN1.replace('%[avgRate]{71}%', '71%');
    const d = diffTurns(TURN1, escaped, store);
    assert('claim removed and unmarked count rose', d.removed.some((r) => String(r.value) === '71') && d.next.unmarked > d.prev.unmarked);
    assert('the log counts the bare number', formatTurnDiff(d).includes('unmarked numbers +1'));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
