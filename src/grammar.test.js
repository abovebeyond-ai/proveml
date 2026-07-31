#!/usr/bin/env node
/**
 * Grammar conformance tests
 *
 * Verifies tokenizer acceptance for ProveML surface syntax and
 * semantic rejection for conditions enforced during evaluation.
 *
 * Run: node src/grammar.test.js
 */

import { tokenizeProveml, verifyProveml } from './verify.js';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    const ok = typeof condition === 'function' ? condition() : condition;
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

// Minimal fact store for testing parse acceptance
const fs = {
    'student:100.name': 'Ylan',
    'student:100.passRate': 5,
    'student:100.evaluated': 55,
    'student:100.absent': 62,
    'student:100._unit': null,  // nullable unit
    'offering:50.name': '4BS',
    'offering:50.studentCount': 18,
    'offering:50.passRate': 59,
    'account:901.name': 'Acme Corp',
    'account:901.balance': -12400,
    'account:901.balance._unit': 'EUR',
};

function parse(src) {
    return verifyProveml(src, fs);
}

function syntaxCount(src) {
    return tokenizeProveml(src).filter(t => t.type !== 'entity_close').length;
}

function acceptsSyntax(src, expectedMin = 1) {
    return syntaxCount(src) >= expectedMin;
}

// ── Entity references ──

console.log('\n=== Grammar: entity_ref_simple ===');
assert('simple entity accepted', acceptsSyntax('@[student:100]{Ylan}'));
assert('entity with dash in id', acceptsSyntax('@[student:abc-123]{Ylan}'));
assert('entity with underscore in id', acceptsSyntax('@[student:abc_123]{Ylan}'));
assert('entity with digits-only id', acceptsSyntax('@[student:100]{Ylan}'));
assert('missing colon rejected', !acceptsSyntax('@[student100]{Ylan}'));
assert('missing brace rejected', !acceptsSyntax('@[student:100]Ylan'));

console.log('\n=== Grammar: entity_ref_scoped ===');
assert('scoped entity accepted', acceptsSyntax('@[student:100 "Ylan"]{has %[passRate]{5}%}'));
assert('scoped with nested fact', () => {
    return syntaxCount('@[student:100 "Ylan"]{scored %[passRate]{5}%}') >= 2;
});
assert('scoped with nested entity', () => {
    return syntaxCount('@[offering:50 "4BS"]{contains @[student:100]{Ylan} with %[studentCount]{18}}') >= 3;
});

// ── Fact references ──

console.log('\n=== Grammar: fact_ref ===');
assert('simple fact accepted', acceptsSyntax('@[student:100]{Ylan} %[passRate]{5}', 2));
assert('fact with unit in value', () => {
    const r = parse('@[account:901]{Acme Corp} %[balance]{-12400 EUR}');
    return r.verified >= 2;
});
assert('fact without entity context flagged', () => {
    const r = parse('%[passRate]{5}');
    return r.total === 1 && r.errors.length > 0;  // parsed but no context
});

// ── Inference references ──

console.log('\n=== Grammar: inference_ref ===');
assert('simple threshold accepted', acceptsSyntax('@[student:100]{Ylan} ?[low: IS_LOW_PASS]{low}', 2));
assert('threshold with explicit path', acceptsSyntax('@[student:100]{Ylan} ?[x: IS_LOW_PASS(student:100.passRate)]{low}', 2));
assert('label reference accepted', acceptsSyntax('@[student:100]{Ylan} ?[low: IS_LOW_PASS]{low} ?[ref: @low]{referenced}', 3));
assert('AND accepted', acceptsSyntax('@[student:100]{Ylan} ?[a: IS_LOW_PASS]{a} ?[b: IS_HIGH_ABSENCE]{b} ?[c: @a AND @b]{both}', 4));
assert('OR accepted', acceptsSyntax('@[student:100]{Ylan} ?[a: IS_LOW_PASS]{a} ?[b: IS_STRONG]{b} ?[c: @a OR @b]{either}', 4));
assert('NOT accepted', acceptsSyntax('@[student:100]{Ylan} ?[a: IS_STRONG]{a} ?[b: NOT @a]{not}', 3));

// ── Threshold names: tokenizer is permissive; evaluation enforces validity ──

console.log('\n=== Grammar: threshold_name validity is semantic ===');
assert('uppercase + underscore accepted', acceptsSyntax('@[student:100]{Ylan} ?[x: IS_LOW_PASS]{test}', 2));
assert('digits in threshold name tokenize but fail evaluation', () => {
    const r = parse('@[student:100]{Ylan} ?[x: RISK_2]{test}');
    return syntaxCount('@[student:100]{Ylan} ?[x: RISK_2]{test}') === 2 && r.errors.length > 0;
});

// ── Field segments: meta_field with underscore prefix ──

console.log('\n=== Grammar: field_segment / meta_field ===');
assert('meta field _unit is a valid field name', () => {
    // _unit is metadata, accessed via ._unit convention in fact store
    // The tokenizer itself doesn't parse field paths — it takes field names from %[field]{value}
    // So _unit as a field name should be parseable
    const r = parse('@[student:100]{Ylan} %[_unit]{null}');
    return r.total >= 2;  // parsed (may not verify, but was accepted as markup)
});

// ── Rejection cases ──

console.log('\n=== Grammar: rejection cases ===');
assert('bare comparison in condition rejected', () => {
    const r = parse('@[student:100]{Ylan} ?[x: passRate > 3]{test}');
    return r.errors.some(e => e.includes('vergelijking') || e.includes('comparison'));
});
assert('unknown threshold rejected', () => {
    const r = parse('@[student:100]{Ylan} ?[x: NONEXISTENT]{test}');
    return r.errors.length > 0;
});
assert('missing label reference rejected', () => {
    const r = parse('@[student:100]{Ylan} ?[x: @ghost]{test}');
    return r.errors.length > 0;
});

// ── Paper examples ──

console.log('\n=== Grammar: paper examples parse correctly ===');
assert('paper entity example', acceptsSyntax('@[student:100]{Ylan}'));
assert('paper fact example', acceptsSyntax('@[student:100]{Ylan} %[passRate]{5}', 2));
assert('paper scoped example', acceptsSyntax('@[student:100 "Ylan"]{scored %[passRate]{5}%}', 2));
assert('paper inference example', acceptsSyntax('@[student:100]{Ylan} ?[low: IS_LOW_PASS]{critically low}', 2));
assert('paper AND chain', acceptsSyntax(
    '@[student:100]{Ylan} ?[low: IS_LOW_PASS]{low} ?[absent: IS_HIGH_ABSENCE]{absent}. ?[risk: @low AND @absent]{at risk}.'
 ,4));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
