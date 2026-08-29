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
    // Unresolvable, not false: rendered as unverifiable (amber), never verified
    assert('bare comparison rejected', html.includes('proveml-unverifiable') && !html.includes('proveml-inference proveml-verified'));
}

console.log('\n=== Inference: unknown threshold ===');
{
    const { html } = render('@[student:100]{Ylan} ?[x: FAKE_THRESHOLD]{test}.');
    // Table 3: an unregistered threshold is unverifiable (amber), not a mismatch
    assert('unknown threshold rejected', html.includes('proveml-unverifiable') && !html.includes('proveml-inference proveml-verified'));
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
    assert('missing label reference fails', html.includes('proveml-unverifiable') && !html.includes('proveml-inference proveml-verified'));
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

// ── Three-valued soundness regressions (found in the pre-publication audit) ──

console.log('\n=== Soundness: unknown propagates through label references ===');
{
    // NOT @a where a is an unregistered threshold must NOT verify: negating an
    // unresolvable condition is unresolvable, one indirection deep included.
    const r = verifyProveml('@[student:100]{Ylan} ?[a: TOTALLY_UNDEFINED]{x} ?[b: NOT @a]{y}.', factStore);
    const b = r.details.find(d => d.type === 'inference' && d.label === 'b');
    assert('NOT @unresolved-label does not verify', b.status !== 'verified', JSON.stringify(b));
    assert('NOT @unresolved-label is unverifiable, not mismatch', b.status === 'unverifiable', JSON.stringify(b));
}

console.log('\n=== Soundness: plugin agrees with verifier on unresolvable NOT ===');
{
    const { html } = render('@[student:100]{Ylan} ?[c: NOT TOTALLY_UNDEFINED]{z}.');
    assert('plugin: NOT unknown-threshold never renders verified',
        !html.includes('proveml-inference proveml-verified'), html);
    const { html: html2 } = render('@[student:100]{Ylan} ?[d: NOT @nonexistent]{z}.');
    assert('plugin: NOT missing-label never renders verified',
        !html2.includes('proveml-inference proveml-verified'), html2);
}

console.log('\n=== Soundness: eq/neq compare canonical strings, so categoricals work ===');
{
    // Table 1's own example: status eq "active" on a non-numeric field
    const store = { 'account:9.name': 'Acme', 'account:9.status': 'active' };
    const reg = { IS_ACTIVE: { field: 'status', op: 'eq', value: 'active', label: 'active' },
                  IS_INACTIVE: { field: 'status', op: 'neq', value: 'active', label: 'inactive' } };
    const r = verifyProveml('@[account:9]{Acme} ?[a: IS_ACTIVE]{active}.', store, { thresholds: reg });
    assert('eq on categorical value verifies', r.verified === 2, JSON.stringify(r.errors));
    const r2 = verifyProveml('@[account:9]{Acme} ?[i: IS_INACTIVE]{inactive}.', store, { thresholds: reg });
    assert('neq on categorical value fails cleanly', r2.errors.length === 1 && r2.details.some(d => d.type === 'inference' && d.status === 'failed'), JSON.stringify(r2.details));
}

console.log('\n=== Soundness: a scope restores the context in force when it opened ===');
{
    // A simple entity inside a top-level scope must not leak out of it
    const store = { 'facility:7.name': 'Plant North', 'sensor:42.name': 'Sensor X', 'sensor:42.value': 5, 'facility:7.value': 9 };
    const r = verifyProveml('@[facility:7 "Plant North"]{contains @[sensor:42]{Sensor X}} and later %[value]{5}.', store);
    const fact = r.details.find(d => d.type === 'fact');
    assert('fact after a closed top-level scope has no entity context',
        fact.status === 'no-context', JSON.stringify(fact));
}


console.log('\n=== Soundness: the plugin restores scope like the verifier ===');
{
    // Same document, same verdict: both entry points judge through core.js.
    const store = { 'facility:7.name': 'Plant North', 'sensor:42.name': 'Sensor X', 'sensor:42.value': 5, 'facility:7.value': 9 };
    const src = '@[facility:7 "Plant North"]{contains @[sensor:42]{Sensor X}} and later %[value]{5}.';
    const { v } = render(src, store);
    const fact = v.facts.find(f => f.field === 'value');
    assert('plugin: fact after a closed top-level scope has no entity context',
        fact?.status === 'no-context', JSON.stringify(fact));
    const src2 = '@[student:100 "Ylan Vercruysse"]{scored %[passRate]{5}%}. Then %[evaluated]{55}.';
    const r2 = verifyProveml(src2, factStore);
    const { v: v2 } = render(src2);
    assert('verifier and plugin agree on a fact after a top-level scope',
        r2.details[2].status === 'no-context' && v2.facts[1].status === 'no-context',
        JSON.stringify([r2.details[2].status, v2.facts[1].status]));
}

console.log('\n=== Markdown: code spans, fences and escapes are not constructs ===');
{
    const src = [
        'Use `%[passRate]{5}` like this. \\@[student:100]{Ylan Vercruysse} scores %[passRate]{5}%.',
        '',
        '```',
        '@[student:100]{Ylan Vercruysse} %[passRate]{5}',
        '```',
        '',
        '@[student:100]{Ylan Vercruysse} has %[absent]{62} absences.',
    ].join('\n');
    const r = verifyProveml(src, factStore);
    const { v } = render(src);
    assert('verifier skips code span, escape and fence', r.total === 3, `total ${r.total}: ${JSON.stringify(r.details.map(d => d.pos))}`);
    assert('plugin counts the same constructs', v.total === r.total, `plugin ${v.total} vs verifier ${r.total}`);
    assert('stripProveml keeps the code span verbatim', stripProveml(src).includes('`%[passRate]{5}`'));
    assert('an unmatched backtick is literal', verifyProveml('a ` b @[student:100]{Ylan Vercruysse}', factStore).total === 1);
    assert('tilde fence is skipped too', verifyProveml('~~~\n%[passRate]{5}\n~~~\n', factStore).total === 0);
}

console.log('\n=== annotate: claims inside a scoped entity stay visible ===');
{
    const md = '@[account:901 "Acme Corp"]{reported %[balance]{-12400 EUR} and %[balance]{-1 EUR}}.';
    const r = verifyProveml(md, factStore);
    const out = annotate(md, r, { color: false });
    assert('scoped content is what the reader sees', out.includes('reported -12400 EUR and -1 EUR.'), out);
    assert('the failed inner claim is labelled', out.includes('expected -12400 EUR'), out);
    assert('the summary counts all three claims', out.includes('2/3 claims verified'), out);
    const bad = '@[account:999 "Nobody"]{owes %[balance]{1 EUR}}.';
    const out2 = annotate(bad, verifyProveml(bad, factStore), { color: false });
    assert('a scoped entity that is not in the store gets a label line', out2.includes('account:999 not in store'), out2);
    // The visible text equals what stripProveml produces, for every paper example
    const { paperExampleSources } = await import('./paper-examples.js');
    for (const [name, src] of Object.entries(paperExampleSources)) {
        const first = annotate(src, verifyProveml(src, factStore), { color: false }).split('\n')[0].slice(2);
        assert(`annotate line 1 matches stripProveml for ${name}`, stripProveml(src).split('\n')[0] === first, first);
    }
}

console.log('\n=== Soundness: an explicit path may pick the entity, not the field ===');
{
    const r = verifyProveml('@[student:100]{Ylan Vercruysse} ?[x: IS_STRONG(student:100.absent)]{strong}', factStore);
    const d = r.details[1];
    assert('threshold redirected to another field is unverifiable', d.status === 'unverifiable' && /defined on passRate/.test(d.error), JSON.stringify(d));
    const ok = verifyProveml('?[x: IS_STRONG(student:200.passRate)]{strong}', { 'student:200.passRate': 80 });
    assert('explicit path on the declared field still evaluates', ok.details[0].status === 'failed' || ok.details[0].status === 'verified', JSON.stringify(ok.details[0]));
    assert('explicit path to the declared field verifies when true', ok.verified === 1, JSON.stringify(ok));
}

console.log('\n=== Registry: names must be addressable ===');
{
    const reg = { IS_ABOVE_30: { field: 'passRate', op: 'gt', value: 30 } };
    const r = verifyProveml('@[student:100]{Ylan Vercruysse} ?[x: IS_ABOVE_30]{above}', { 'student:100.name': 'Ylan Vercruysse', 'student:100.passRate': 45 }, { thresholds: reg });
    assert('a threshold name with digits evaluates', r.verified === 2, JSON.stringify(r.errors));
    let threw = null;
    try { verifyProveml('x', {}, { thresholds: { is_low: { field: 'a', op: 'lt', value: 1 } } }); } catch (e) { threw = e.message; }
    assert('a lowercase registry key throws instead of being silently unreachable', /not addressable/.test(threw || ''), threw);
    try { threw = null; verifyProveml('x', {}, { thresholds: { IS_LOW: { op: 'lt', value: 1 } } }); } catch (e) { threw = e.message; }
    assert('a threshold without a field throws', /must declare a field/.test(threw || ''), threw);
}

console.log('\n=== Built-in registry: README example verifies ===');
{
    const store = { 'company:aapl.name': 'Apple Inc.', 'company:aapl.netIncome': 112010000000, 'company:aapl.netIncome._unit': 'USD' };
    const r = verifyProveml('@[company:aapl]{Apple Inc.} ?[healthy: IS_PROFITABLE]{The margin is healthy}.', store);
    assert('IS_PROFITABLE is in the shipped vocabulary', r.verified === 2, JSON.stringify(r.errors));
}


console.log('\n=== Coverage: numbers outside any claim ===');
{
    const store = { 'student:100.name': 'Ylan', 'student:100.passRate': 5, 'student:100.absent': 62 };
    const md = '@[student:100]{Ylan} scores %[passRate]{5}% and missed 62 days in 2024; see item 3.\n1. first\n`code 99` @[student:100 "Ylan"]{has 7 pets}';
    const r = verifyProveml(md, store);
    assert('coverage reported without strict', r.coverage.marked === 1 && r.coverage.unmarked === 3 && r.coverage.rate === 0.25, JSON.stringify(r.coverage));
    assert('unmarked numbers carry offsets', r.unmarked.map(u => u.value).join(',') === '62,3,7', JSON.stringify(r.unmarked));
    assert('years, list markers and code are not counted', !r.unmarked.some(u => ['2024', '1', '99'].includes(u.value)));
    assert('without strict, unmarked numbers are not errors', r.errors.length === 0 && r.total === 3, JSON.stringify(r.errors));
    const s = verifyProveml(md, store, { strict: true });
    assert('strict: each unmarked number is a finding', s.errors.length === 3 && s.details.filter(d => d.type === 'unmarked').length === 3, JSON.stringify(s.errors));
    assert('strict: totals still count claims only', s.total === 3 && s.verified === 3);
    assert('strict: details stay in source order', s.details.every((d, i, a) => i === 0 || a[i - 1].pos <= d.pos));
    const out = annotate(md, s, { color: false });
    assert('annotate labels an unmarked number', out.includes('· not a claim'), out);
    assert('annotate summary reports coverage', out.includes('3/3 claims verified, 3 numbers outside any claim'), out);
    const clean = verifyProveml('@[student:100]{Ylan} scores %[passRate]{5}%.', store, { strict: true });
    assert('fully marked text has no coverage findings', clean.errors.length === 0 && clean.coverage.rate === 1, JSON.stringify(clean.coverage));
    assert('no numbers at all gives rate null', verifyProveml('@[student:100]{Ylan} is here.', store).coverage.rate === null);
}


console.log('\n=== Facts may name their own entity ===');
{
    const store = { 'student:20414.name': 'Amir Janssens', 'student:20414.passRate': 53, 'offering:10056.name': '5OL', 'offering:10056.passRate': 61 };
    const md = '@[student:20414]{Amir Janssens} of @[offering:10056]{5OL} has a pass rate of %[student:20414.passRate]{53}%; the class sits at %[passRate]{61}%.';
    const r = verifyProveml(md, store);
    assert('explicit-entity fact binds to the named entity, not the nearest', r.details[2].status === 'verified' && r.details[2].path === 'student:20414.passRate', JSON.stringify(r.details[2]));
    assert('the following plain fact still binds to the entity in force', r.details[3].status === 'verified' && r.details[3].path === 'offering:10056.passRate', JSON.stringify(r.details[3]));
    assert('explicit-entity fact needs no context', verifyProveml('%[student:20414.passRate]{53}', store).details[0].status === 'verified');
    assert('explicit-entity fact to an unknown field is field-not-found', verifyProveml('%[student:20414.absent]{3}', store).details[0].status === 'field-not-found');
    const { v } = render(md, store);
    assert('plugin agrees', v.facts[0].status === 'verified' && v.facts[0].path === 'student:20414.passRate' && v.facts[1].path === 'offering:10056.passRate', JSON.stringify(v.facts.map(f => f.path)));
    assert('stripProveml unchanged', stripProveml(md) === 'Amir Janssens of 5OL has a pass rate of 53%; the class sits at 61%.');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
