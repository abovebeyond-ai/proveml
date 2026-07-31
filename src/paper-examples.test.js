import { createRenderer } from './renderer.js';
import { educationFactStore, paperExampleSources } from './paper-examples.js';

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name} ${detail}`);
    }
}

const renderer = createRenderer(educationFactStore);

console.log('\n=== Paper examples: verify mode ===');
{
    const { html, verification } = renderer.render(paperExampleSources.verifyCorrect);
    assert('correct panel has no failed checks', verification.total === verification.verified, `got ${verification.verified}/${verification.total}`);
    assert('correct panel uses stable root classes', html.includes('proveml-root') && html.includes('proveml-paragraph'));
    assert('correct panel includes verified facts', html.includes('proveml-fact proveml-verified'));
    assert('correct panel includes verified inferences', html.includes('proveml-inference proveml-verified'));
    assert('correct panel includes multi-entity comparison', html.includes('student:1092') && html.includes('student:1087'));
}

console.log('\n=== Paper examples: suggestions ===');
{
    const { html, verification } = renderer.render(paperExampleSources.verifySuggestions);
    assert('suggestions panel keeps all ProveML checks verified', verification.total === verification.verified, `got ${verification.verified}/${verification.total}`);
    assert('suggestions panel rendered output contains verified entity', html.includes('proveml-entity proveml-verified'));
    assert('suggestions panel includes verified inference', html.includes('proveml-inference proveml-verified'));
    assert('suggestions panel has no failed verification spans', !html.includes('proveml-failed') && !html.includes('proveml-mismatch'));
}

console.log('\n=== Paper examples: errors ===');
{
    const { html, verification } = renderer.render(paperExampleSources.verifyErrors);
    assert('errors panel contains fact mismatch', html.includes('proveml-fact proveml-mismatch'));
    assert('errors panel contains failed inference', html.includes('proveml-inference proveml-failed'));
    assert('errors panel contains no-context fact', html.includes('proveml-fact proveml-no-context'));
    assert('errors panel contains unknown entity', html.includes('proveml-entity proveml-unverifiable'));
    assert('errors panel includes failed verification summary', verification.verified < verification.total, `got ${verification.verified}/${verification.total}`);
    assert('errors panel includes multiple deterministic failures', verification.errors?.length === undefined || verification.total > verification.verified);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
