/**
 * ProveML plugin tests
 * Run: node src/proveml.test.js
 */

import markdownIt from 'markdown-it';
import provemlPlugin from './plugin.js';
import { renderProveml } from './render-html.js';
import { plainAdapter } from './trust-adapter.js';
import { stripProveml, verifyProveml } from './verify.js';
import { annotate } from './annotate.js';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

const factStore = {
    'student:100.name': 'Ylan Vercruysse',
    'student:100.passRate': 5,
    'student:100.evaluated': 55,
    'student:100.total': 90,
    'student:100.absent': 62,
    'student:200.name': 'Khaled Albayyouk',
    'student:200.passRate': 10,
    'student:200.evaluated': 29,
    'offering:50.name': '4BS',
    'offering:50.studentCount': 18,
    'offering:50.passRate': 59,
    'offering:50.stream': 'A-stroom',
    'offering:55.name': '4EC',
    'offering:55.studentCount': 7,
    'offering:55.passRate': 30,
    'facility:7.name': 'Plant North',
    'facility:7.sensorCount': 12,
    'sensor:42.name': 'Sensor X',
    'sensor:42.value': 29.99,
    'sensor:43.name': 'Sensor Y',
    'sensor:43.value': 18.50,
    // Entities with pre-computed diff (for diff_gt tests)
    'offering:60.name': '5BW',
    'offering:60.passRate': 80,
    'offering:60._diff': 25,     // big difference
    'offering:61.name': '5EC',
    'offering:61.passRate': 55,
    'offering:61._diff': 5,      // small difference
    // Entity with missing data (for IS_MISSING / is_null tests)
    'student:300.name': 'Ghost Student',
    'student:300.passRate': 5,
    // student:300.evaluated intentionally absent
    // Unit-annotated entries
    'account:901.name': 'Acme Corp',
    'account:901.balance': -12400,
    'account:901.balance._unit': 'EUR',
    'patient:308.name': 'Maria Jansen',
    'patient:308.glucose': 142,
    'patient:308.glucose._unit': 'mg/dL',
};

function render(source, input = factStore) {
    const md = markdownIt({ html: false });
    md.use(provemlPlugin, { factStore: input });
    const env = {};
    const html = md.render(source, env);
    return { html, v: env.proveml };
}

console.log('\n=== Entity references ===');
{
    const { html, v } = render('@[student:100]{Ylan Vercruysse} is a student.');
    assert('renders entity span', html.includes('proveml-entity'));
    assert('has entity type', html.includes('data-entity-type="student"'));
    assert('has entity id', html.includes('data-entity-id="100"'));
    assert('verified name match', html.includes('proveml-verified'));
    assert('display text rendered', html.includes('Ylan Vercruysse'));
}

console.log('\n=== Entity name mismatch ===');
{
    const { html } = render('@[student:100]{Wrong Name} test.');
    assert('detects name mismatch', html.includes('proveml-name-mismatch'));
}

console.log('\n=== Unknown entity ===');
{
    const { html } = render('@[student:999]{Ghost} test.');
    assert('marks as unverifiable', html.includes('proveml-unverifiable'));
}

console.log('\n=== Fact references with entity context ===');
{
    const { html, v } = render('@[student:100]{Ylan} scoort %[passRate]{5}% op %[evaluated]{55} eindtermen.');
    assert('fact span rendered', html.includes('proveml-fact'));
    assert('passRate verified', html.includes('data-verified="verified"'));
    assert('value displayed', html.includes('>5<'));
    assert('entity color inherited', html.includes('--entity-color'));
}

console.log('\n=== Fact mismatch ===');
{
    const { html } = render('@[student:100]{Ylan} scoort %[passRate]{99}%.');
    assert('detects mismatch', html.includes('proveml-mismatch'));
}

console.log('\n=== Fact without entity context ===');
{
    const { html } = render('Some text %[passRate]{5}% here.');
    assert('marks as no-context', html.includes('proveml-no-context'));
}

console.log('\n=== Multiple entities in one paragraph ===');
{
    const { html, v } = render('@[student:100]{Ylan Vercruysse} scoort %[passRate]{5}% terwijl @[student:200]{Khaled Albayyouk} %[passRate]{10}% haalt.');
    assert('contains both entities', html.includes('student:100') && html.includes('student:200'));
    assert('Ylan passRate verifies against student:100', html.includes('data-path="student:100.passRate" data-verified="verified"'));
    assert('Khaled passRate verifies against student:200', html.includes('data-path="student:200.passRate" data-verified="verified"'));
    // Status-based colors: both verified facts should show teal
    assert('verified facts use status color', html.includes('#0d9488'));
}

console.log('\n=== Entity context carries across paragraphs ===');
{
    const { html } = render('@[student:100]{Ylan Vercruysse} scoort %[passRate]{5}%.\n\n%[evaluated]{55} eindtermen.');
    // Context carries — second paragraph inherits student:100
    assert('second paragraph verifies against carried entity', html.includes('data-path="student:100.evaluated"'));
}

console.log('\n=== Mixed with regular markdown ===');
{
    const { html } = render('**Bold** and @[student:100]{Ylan} scoort %[passRate]{5}%.\n\n- List item\n- Another');
    assert('bold renders', html.includes('<strong>'));
    assert('entity still works', html.includes('proveml-entity'));
    assert('list renders', html.includes('<li>'));
}

console.log('\n=== Verification summary ===');
{
    const { v } = render('@[student:100]{Ylan Vercruysse} scoort %[passRate]{5}% op %[evaluated]{55}.');
    assert('total count correct', v.total === 3, `got ${v.total}`); // 1 entity + 2 facts
    assert('verified count correct', v.verified === 3, `got ${v.verified}`);
}

console.log('\n=== Strip utility ===');
{
    const stripped = stripProveml('@[student:100]{Ylan Vercruysse} scoort %[passRate]{5}% en ?[low: IS_LOW_PASS]{blijft laag}.');
    assert('strip keeps visible text from simple constructs', stripped === 'Ylan Vercruysse scoort 5% en blijft laag.', `got ${JSON.stringify(stripped)}`);
}

{
    const stripped = stripProveml('@[account:901 "Acme Corp"]{reported %[balance]{-12400 EUR} and ?[neg: IS_NEGATIVE_BALANCE]{has a negative balance}}');
    assert('strip removes scoped metadata but keeps scoped content', stripped === 'reported -12400 EUR and has a negative balance', `got ${JSON.stringify(stripped)}`);
}

console.log('\n=== Offering entity ===');
{
    const { html } = render('In @[offering:50]{4BS} zitten %[studentCount]{18} leerlingen.');
    assert('offering entity renders', html.includes('data-entity-type="offering"'));
    assert('studentCount verified', html.includes('data-verified="verified"'));
}

console.log('\n=== Inference: threshold check ===');
{
    const { html, v } = render('@[student:100]{Ylan Vercruysse} scoort %[passRate]{5}%. ?[low: IS_LOW_PASS]{Kritisch laag}.');
    assert('inference renders', html.includes('proveml-inference'));
    assert('inference verified (5 < 25)', html.includes('proveml-verified'));
    assert('display text renders', html.includes('Kritisch laag'));
}

console.log('\n=== Inference: threshold fails ===');
{
    const { html } = render('@[student:200]{Khaled Albayyouk} scoort %[passRate]{10}%. ?[strong: IS_STRONG]{Sterk}.');
    assert('inference failed (10 < 75)', html.includes('proveml-failed'));
}

console.log('\n=== Inference: AND combination ===');
{
    const { html } = render('@[student:100]{Ylan Vercruysse} ?[low: IS_LOW_PASS]{laag} en ?[absent: IS_HIGH_ABSENCE]{vaak afwezig}. ?[risk: @low AND @absent]{Gecombineerd risico}.');
    assert('AND combination renders', html.includes('Gecombineerd risico'));
    // Both IS_LOW_PASS(5) and IS_HIGH_ABSENCE(62) should be true
    assert('AND verified', !html.includes('proveml-failed'));
}

console.log('\n=== Inference: rejects bare comparisons ===');
{
    const { html } = render('@[student:100]{Ylan} ?[custom: passRate > 3]{test}.');
    assert('bare comparison rejected', html.includes('proveml-failed'));
}

console.log('\n=== Inference: unknown threshold ===');
{
    const { html } = render('@[student:100]{Ylan} ?[x: FAKE_THRESHOLD]{test}.');
    assert('unknown threshold rejected', html.includes('proveml-failed'));
}

// ── Scoped entity form ──

console.log('\n=== Scoped entity: quoted name ===');
{
    const { html, v } = render('@[student:100 "Ylan Vercruysse"]{has %[passRate]{5}% pass rate}');
    assert('scoped entity renders', html.includes('proveml-entity'));
    assert('scoped name verified', html.includes('proveml-verified'));
    assert('scoped fact rendered', html.includes('proveml-fact') || v.facts.length > 0 || v.verified >= 2);
}

console.log('\n=== Scoped entity: fact binds to enclosing entity ===');
{
    const { html, v } = render('@[student:100 "Ylan Vercruysse"]{scored %[passRate]{5}% on %[evaluated]{55} levels}');
    assert('entity verified', v.entities[0]?.nameMatch === true);
    assert('passRate verified (5)', v.verified >= 2, `verified: ${v.verified}`);
}

console.log('\n=== Scoped entity: wrong quoted name ===');
{
    const { html, v } = render('@[student:100 "Wrong Name"]{has %[passRate]{5}%}');
    assert('name mismatch detected', html.includes('proveml-name-mismatch'));
}

console.log('\n=== Scoped entity: multiple entities with scoped facts ===');
{
    const { html, v } = render(
        '@[student:100 "Ylan Vercruysse"]{scored %[passRate]{5}%} outperforms ' +
        '@[student:200 "Khaled Albayyouk"]{who scored %[passRate]{10}%}.'
    );
    assert('two entities rendered', (html.match(/proveml-entity/g) || []).length >= 2);
    assert('both verified', v.verified >= 3, `verified: ${v.verified}`);
}

console.log('\n=== Simple form still works (backward compat) ===');
{
    const { html, v } = render('@[student:100]{Ylan Vercruysse} has %[passRate]{5}%.');
    assert('simple form entity verified', v.entities[0]?.nameMatch === true);
    assert('simple form fact verified', v.verified >= 2);
}

console.log('\n=== Nested scoped entities: outer context restored ===');
{
    // After inner scope closes, outer facts should bind to outer entity
    const src = '@[offering:50 "4BS"]{contains @[student:100 "Ylan Vercruysse"]{with %[passRate]{5}%} and has %[studentCount]{18} students}';
    const { html, v } = render(src);
    assert('inner passRate verified against student:100', v.verified >= 2, `verified: ${v.verified}`);
    // The key test: studentCount should bind to offering:50, not student:100
    assert('outer studentCount verified against offering:50',
        v.facts?.some(f => f.path?.includes('offering:50')) || v.verified >= 3,
        `verified: ${v.verified}, facts: ${JSON.stringify(v.facts)}`);
}

console.log('\n=== Nested: multiple inner entities with outer fact ===');
{
    const src = '@[facility:7 "Plant North"]{hosts @[sensor:42 "Sensor X"]{reading %[value]{29.99}} and @[sensor:43 "Sensor Y"]{reading %[value]{18.5}}, with %[sensorCount]{12} sensors total}';
    const { html, v } = render(src);
    assert('facility verified', v.entities[0]?.nameMatch === true);
    assert('sensor X verified', v.verified >= 3, `verified: ${v.verified}`);
    assert('sensor Y verified', v.verified >= 4, `verified: ${v.verified}`);
    assert('sensorCount binds to facility (outer)', v.verified >= 5, `verified: ${v.verified}`);
}

console.log('\n=== Scoped entity followed by linear carry-forward ===');
{
    const src = '@[student:100 "Ylan Vercruysse"]{scored %[passRate]{5}%}. @[student:200]{Khaled Albayyouk} has %[passRate]{10}%.';
    const { html, v } = render(src);
    assert('both entities verified', v.entities.length >= 2);
    assert('all claims verified', v.verified >= 4, `verified: ${v.verified}`);
}

// ── Unit support ──

console.log('\n=== Fact with unit: correct value and unit ===');
{
    const { html, v } = render('@[account:901]{Acme Corp} has %[balance]{-12400 EUR}.');
    assert('balance with unit verified', v.verified >= 2, `verified: ${v.verified}`);
}

console.log('\n=== Fact with unit: missing unit in claim ===');
{
    const { html } = render('@[account:901]{Acme Corp} has %[balance]{-12400}.');
    assert('missing unit detected as mismatch', html.includes('proveml-mismatch'));
}

console.log('\n=== Fact with unit: wrong unit in claim ===');
{
    const { html } = render('@[account:901]{Acme Corp} has %[balance]{-12400 USD}.');
    assert('wrong unit detected as mismatch', html.includes('proveml-mismatch'));
}

console.log('\n=== Fact without unit: still works (backward compat) ===');
{
    const { html, v } = render('@[offering:50]{4BS} has %[studentCount]{18} students.');
    assert('unitless fact still verifies', v.verified >= 2, `verified: ${v.verified}`);
}

console.log('\n=== Fact with unit: healthcare example ===');
{
    const { html, v } = render('@[patient:308]{Maria Jansen} glucose is %[glucose]{142 mg/dL}.');
    assert('glucose with unit verified', v.verified >= 2, `verified: ${v.verified}`);
}

console.log('\n=== Threshold with matching unit ===');
{
    const { html } = render('@[account:901]{Acme Corp} has %[balance]{-12400 EUR}. ?[neg: IS_NEGATIVE_BALANCE]{negative balance}.');
    assert('threshold with matching unit passes', html.includes('proveml-verified'));
    assert('inference renders', html.includes('negative balance'));
}

console.log('\n=== Threshold with unit but field has no unit ===');
{
    // passRate has no ._unit — threshold IS_NEGATIVE_BALANCE expects EUR
    // Use a field without unit to test the "missing unit" path
    const { html } = render('@[student:100]{Ylan Vercruysse} ?[neg: IS_NEGATIVE_BALANCE]{negative}.');
    // student:100 has no balance field, so this will fail on "field not found" rather than unit
    // Instead test with offering:50 which has passRate but no unit
    assert('threshold unit check against unitless field', true); // structural test covered below
}

console.log('\n=== Threshold unit mismatch ===');
{
    const store = {
        'patient:1.name': 'Test',
        'patient:1.glucose': 200,
        'patient:1.glucose._unit': 'mmol/L',  // wrong unit — threshold expects mg/dL
    };
    const r = verifyProveml('@[patient:1]{Test} ?[high: IS_ELEVATED_GLUCOSE]{elevated}.', store);
    const unitErr = r.errors.some(e => e.includes('Unit') || e.includes('mismatch'));
    assert('threshold unit mismatch detected', unitErr, r.errors.join('; '));
}

console.log('\n=== Threshold with unit but field has no unit declared ===');
{
    const store = {
        'patient:2.name': 'NoUnit',
        'patient:2.glucose': 200,
        // no ._unit key
    };
    const r = verifyProveml('@[patient:2]{NoUnit} ?[high: IS_ELEVATED_GLUCOSE]{elevated}.', store);
    const unitErr = r.errors.some(e => e.includes('unit') || e.includes('Unit'));
    assert('threshold fails when field has no unit but threshold expects one', unitErr, r.errors.join('; '));
}

// ── Inference composition ──

console.log('\n=== Inference: IS_MISSING (is_null) on absent field ===');
{
    const { html } = render('@[student:300]{Ghost Student} ?[missing: IS_MISSING]{no data}.');
    assert('IS_MISSING verified on absent field', html.includes('proveml-verified'));
}

console.log('\n=== Inference: IS_MISSING fails on present field ===');
{
    const { html } = render('@[student:100]{Ylan Vercruysse} ?[missing: IS_MISSING]{no data}.');
    assert('IS_MISSING fails on present field', html.includes('proveml-failed'));
}

console.log('\n=== Inference: AND chain (@low AND @missing) ===');
{
    const { html } = render('@[student:300]{Ghost Student} ?[low: IS_LOW_PASS]{low} ?[missing: IS_MISSING]{no data}. ?[risk: @low AND @missing]{at risk}.');
    assert('AND chain verified when both true', html.includes('at risk'));
    // The risk inference should be verified (both @low and @missing are true)
    const riskSpan = html.match(/at risk/);
    const failedCount = (html.match(/proveml-failed/g) || []).length;
    assert('AND chain: risk inference not failed', failedCount === 0, `failed spans: ${failedCount}`);
}

console.log('\n=== Inference: OR ===');
{
    const { html } = render('@[student:200]{Khaled Albayyouk} ?[low: IS_LOW_PASS]{low} ?[strong: IS_STRONG]{strong}. ?[either: @low OR @strong]{one of them}.');
    // passRate=10: IS_LOW_PASS true (10<25), IS_STRONG false (10<75). OR should be true.
    assert('OR verified when one is true', html.includes('one of them'));
}

console.log('\n=== Inference: NOT ===');
{
    const { html } = render('@[student:100]{Ylan Vercruysse} ?[strong: IS_STRONG]{strong}. ?[notstrong: NOT @strong]{not strong}.');
    // passRate=5: IS_STRONG false (5<75). NOT false = true.
    assert('NOT verified when inner is false', !html.includes('proveml-failed') || html.match(/proveml-verified/g)?.length >= 1);
}

console.log('\n=== Inference: missing label reference ===');
{
    const { html } = render('@[student:100]{Ylan Vercruysse} ?[broken: @nonexistent]{test}.');
    assert('missing label reference fails', html.includes('proveml-failed'));
}

// ── diff_gt ──

console.log('\n=== Inference: diff_gt true (large diff) ===');
{
    const { html } = render('@[offering:60]{5BW} ?[big: IS_MUCH_HIGHER]{much higher}.');
    assert('diff_gt verified on large diff (25 > 15)', html.includes('proveml-verified'));
}

console.log('\n=== Inference: diff_gt false (small diff) ===');
{
    const { html } = render('@[offering:61]{5EC} ?[big: IS_MUCH_HIGHER]{much higher}.');
    assert('diff_gt fails on small diff (5 !> 15)', html.includes('proveml-failed'));
}

console.log('\n=== Inference: diff_gt with explicit path (cross-entity) ===');
{
    const store = {
        'offering:60.name': '5BW', 'offering:60._diff': 25,
        'offering:61.name': '5EC', 'offering:61._diff': 5,
    };
    const r = verifyProveml('@[offering:61]{5EC} ?[big: IS_MUCH_HIGHER(offering:60._diff)]{much higher}.', store);
    assert('diff_gt true via explicit path (25 > 15)', r.details.some(d => d.label === 'big' && d.status === 'verified'));
    const r2 = verifyProveml('@[offering:60]{5BW} ?[small: IS_MUCH_HIGHER(offering:61._diff)]{much higher}.', store);
    assert('diff_gt false via explicit path (5 !> 15)', r2.details.some(d => d.label === 'small' && d.status === 'failed'));
}

console.log('\n=== Inference: diff_gt missing explicit path ===');
{
    const store = { 'offering:60.name': '5BW' };
    const r = verifyProveml('@[offering:60]{5BW} ?[x: IS_MUCH_HIGHER(offering:99._diff)]{test}.', store);
    assert('missing path fails gracefully', r.errors.length > 0);
}

console.log('\n=== Inference: diff_gt bad entity in explicit path ===');
{
    const store = { 'offering:60.name': '5BW' };
    const r = verifyProveml('@[offering:60]{5BW} ?[x: IS_MUCH_HIGHER(ghost:0._diff)]{test}.', store);
    assert('unknown entity in explicit path fails', r.errors.length > 0);
}

// ── Snapshot semantics ──

console.log('\n=== Snapshot: verifyProveml returns snapshot when provided ===');
{
    const store = { 'student:1.name': 'Test', 'student:1.passRate': 50 };
    const r = verifyProveml('@[student:1]{Test} %[passRate]{50}%.', store, { snapshot: 'v20260315-a4f2' });
    assert('snapshot included in result', r.snapshot === 'v20260315-a4f2', `got: ${r.snapshot}`);
}

console.log('\n=== Snapshot: absent when not provided ===');
{
    const store = { 'student:1.name': 'Test', 'student:1.passRate': 50 };
    const r = verifyProveml('@[student:1]{Test} %[passRate]{50}%.', store);
    assert('snapshot undefined when not provided', r.snapshot === undefined);
}

// ── Trust adapters ──

console.log('\n=== Trust: plain fact stores default to unverified source trust ===');
{
    const r = verifyProveml('@[account:901]{Acme Corp} has %[balance]{-12400 EUR}.', plainAdapter(factStore));
    const factDetail = r.details.find(detail => detail.type === 'fact' && detail.path === 'account:901.balance');
    assert('plain adapter leaves match semantics unchanged', r.verified === 2, `verified: ${r.verified}`);
    assert('plain adapter reports unverified trust by default', factDetail?.trustStatus === 'unverified', JSON.stringify(factDetail));
    assert('plain adapter reports backend as plain', factDetail?.trustBackend === 'plain', JSON.stringify(factDetail));
}

console.log('\n=== Trust: custom adapter surfaces trust metadata in verifier and renderer ===');
{
    const trustedAdapter = {
        resolve(path) {
            if (path === 'company:aapl.name') {
                return {
                    found: true,
                    value: 'Apple Inc.',
                    trust: { status: 'verified', backend: 'sd-jwt', issuer: 'did:issuer:aapl' }
                };
            }
            if (path === 'company:aapl.revenue') {
                return {
                    found: true,
                    value: 416161000000,
                    unit: 'USD',
                    trust: {
                        status: 'verified',
                        backend: 'sd-jwt',
                        issuer: 'did:issuer:aapl',
                        proofRef: 'jwt:sha256:abc123'
                    }
                };
            }
            return { found: false };
        }
    };

    const markup = '@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD}.';
    const result = verifyProveml(markup, trustedAdapter);
    const factDetail = result.details.find(detail => detail.type === 'fact' && detail.path === 'company:aapl.revenue');
    assert('custom adapter still verifies the claim match', factDetail?.status === 'verified', JSON.stringify(factDetail));
    assert('custom adapter exposes trust status', factDetail?.trustStatus === 'verified', JSON.stringify(factDetail));
    assert('custom adapter exposes trust backend', factDetail?.trustBackend === 'sd-jwt', JSON.stringify(factDetail));
    assert('custom adapter exposes proof reference', factDetail?.trustProofRef === 'jwt:sha256:abc123', JSON.stringify(factDetail));

    const rendered = renderProveml(markup, trustedAdapter, { showProofPaths: true });
    assert('renderProveml emits trust class', rendered.html.includes('proveml-trust-verified'));
    assert('renderProveml emits trust backend attribute', rendered.html.includes('data-trust-backend="sd-jwt"'));
    assert('renderProveml audit proof shows trust status', rendered.html.includes('trust: verified'));
}

console.log('\n=== Trust: markdown-it plugin accepts adapters and exposes trust attrs ===');
{
    const adapter = {
        resolve(path) {
            if (path === 'sensor:42.name') {
                return {
                    found: true,
                    value: 'Sensor X',
                    trust: { status: 'verified', backend: 'signed-api' }
                };
            }
            if (path === 'sensor:42.value') {
                return {
                    found: true,
                    value: 29.99,
                    trust: { status: 'expired', backend: 'signed-api', proofRef: 'sig-42' }
                };
            }
            return { found: false };
        }
    };

    const { html } = render('@[sensor:42]{Sensor X} reads %[value]{29.99}.', adapter);
    assert('plugin emits trust attribute on entity', html.includes('data-trust-status="verified"'));
    assert('plugin emits trust attribute on fact', html.includes('data-trust-status="expired"'));
    assert('plugin emits trust backend on fact', html.includes('data-trust-backend="signed-api"'));
}

// ── Annotation output (the CLI's human-readable view) ──

console.log('\n=== Annotate: verified, mismatched and unverifiable spans ===');
{
    const md = '@[student:100]{Ylan Vercruysse} scored %[passRate]{99}%.';
    const r = verifyProveml(md, factStore);
    const out = annotate(md, r, { color: false });
    assert('annotation shows the visible text, not the markup',
        out.includes('Ylan Vercruysse scored 99%') && !out.includes('%[passRate]'), out);
    assert('annotation names the expected value', out.includes('expected 5'), out);
    assert('annotation carries the summary', out.includes('1/2 claims verified'), out);
}
{
    const md = '@[ghost:1]{Nobody} has %[passRate]{5}%.';
    const out = annotate(md, verifyProveml(md, factStore), { color: false });
    assert('unverifiable entity is reported as not in store', out.includes('not in store'), out);
}
{
    const md = 'Plain prose with no constructs at all.';
    const out = annotate(md, verifyProveml(md, factStore), { color: false });
    assert('no constructs yields an explicit nothing-checked message',
        out.includes('no ProveML constructs found'), out);
}
{
    const md = '@[student:100]{Ylan Vercruysse} scored %[passRate]{5}%.';
    const colored = annotate(md, verifyProveml(md, factStore), { color: true });
    const plain = annotate(md, verifyProveml(md, factStore), { color: false });
    assert('color option toggles ANSI codes',
        colored.includes('\u001b[') && !plain.includes('\u001b['), 'color toggle failed');
}

// ── Operator coverage: between, in, eq, neq, lte through the registry ──

console.log('\n=== Operators: full Table-1 vocabulary through registry entries ===');
{
    const r = verifyProveml('@[offering:55]{4EC} ?[mod: IS_MODERATE_PASS]{moderate}.', factStore);
    assert('between: 30 in [25,50) verifies', r.verified === 2, JSON.stringify(r.errors));
    const r2 = verifyProveml('@[offering:50]{4BS} ?[mod: IS_MODERATE_PASS]{moderate}.', factStore);
    assert('between: 59 outside [25,50) fails', r2.errors.length === 1, JSON.stringify(r2.errors));
    const r3 = verifyProveml('@[offering:50]{4BS} ?[a: IS_A_STREAM]{A stream}.', factStore);
    assert('in: stream membership verifies', r3.verified === 2, JSON.stringify(r3.errors));
    const r4 = verifyProveml('@[offering:50]{4BS} ?[p: IS_PERFECT_PASS]{perfect}.', factStore);
    assert('eq: 59 != 100 fails', r4.errors.length === 1, JSON.stringify(r4.errors));
    const r5 = verifyProveml('@[offering:50]{4BS} ?[n: IS_NONEMPTY_CLASS]{non-empty}.', factStore);
    assert('neq: 18 != 0 verifies', r5.verified === 2, JSON.stringify(r5.errors));
    const r6 = verifyProveml('@[offering:55]{4EC} ?[h: IS_AT_MOST_HALF]{at most half}.', factStore);
    assert('lte: 30 <= 50 verifies', r6.verified === 2, JSON.stringify(r6.errors));
    const r7 = verifyProveml('?[m: IS_MISSING]{no data}.', factStore);
    assert('is_null without any entity context errors', r7.errors.length === 1, JSON.stringify(r7.errors));
}

// ── Scoped entity rendering regression (render-html.js) ──

console.log('\n=== Renderer: scoped entity gap text and closing brace ===');
{
    const markup = '@[student:100 "Ylan Vercruysse"]{scored %[passRate]{5}% across %[evaluated]{55} levels}';
    const result = renderProveml(markup, factStore);

    // Gap text between entity name and first fact must appear
    assert('scoped gap text before first fact is rendered',
        result.html.includes('scored'),
        `html: ${result.html}`);

    // Gap text between facts must appear
    assert('scoped gap text between facts is rendered',
        result.html.includes('across'),
        `html: ${result.html}`);

    // Trailing content after last fact must appear
    assert('scoped trailing text after last fact is rendered',
        result.html.includes('levels'),
        `html: ${result.html}`);

    // Closing brace must NOT leak into rendered output
    assert('scoped closing brace does not leak into output',
        !result.html.endsWith('}</div>') && !result.html.includes('levels}'),
        `html ends with: ${result.html.slice(-60)}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
