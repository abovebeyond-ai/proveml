import { promptFor, PROMPT_RULES } from './prompt.js';
import { verifyProveml } from './verify.js';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

console.log('\n=== prompt: generated from the store and the registry ===');
{
    const store = { 'student:1.name': 'Amir', 'student:1.passRate': 53, 'student:1.absent': 0, 'offering:5.name': '5OL', 'offering:5.studentCount': 8, 'account:9.name': 'Acme', 'account:9.balance': -12400, 'account:9.balance._unit': 'EUR', 'account:9.balance._display': 'currency:EUR:0' };
    const reg = { IS_LOW_PASS: { field: 'passRate', op: 'lt', value: 25, label: 'critically low' }, IS_NEGATIVE: { field: 'balance', op: 'lt', value: 0, unit: 'EUR', label: 'in the red' } };
    const p = promptFor({ store, thresholds: reg, role: 'You write pupil summaries.' });
    assert('starts with the role', p.startsWith('You write pupil summaries.'));
    assert('lists every rule', PROMPT_RULES.every(r => p.includes(r)));
    assert('lists the store\'s types and fields with units', p.includes('- student: passRate, absent') && p.includes('- account: balance (EUR)'));
    assert('does not list companion keys as fields', !p.includes('_display') && !p.includes('_unit'));
    assert('lists the registry with bound and label', p.includes('- IS_LOW_PASS: passRate lt 25  ("critically low")') && p.includes('- IS_NEGATIVE: balance lt 0 EUR  ("in the red")'));
    assert('derives a worked example from the store', p.includes('EXAMPLE:\n@[student:1]{Amir} has a passRate of %[passRate]{53}.'));
    assert('mentions the explicit-record form', p.includes('%[type:id.field]{value}'));
    assert('no DATA block unless asked', !p.includes('\nDATA:'));
    const withData = promptFor({ store, thresholds: reg, data: true });
    assert('DATA block lists the store without display rules', withData.includes('account:9.balance = -12400') && withData.includes('account:9.balance._unit = EUR') && !withData.includes('_display'));
    const empty = promptFor({});
    assert('an empty registry says so instead of listing nothing', empty.includes('REGISTRY: none'));
    // The example the prompt gives must itself verify against the store.
    const ex = p.slice(p.indexOf('EXAMPLE:\n') + 9).split('\n')[0];
    const v = verifyProveml(ex, store, { thresholds: reg, strict: true });
    assert('the worked example verifies with no findings', v.errors.length === 0 && v.verified === v.total, JSON.stringify(v.errors));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
