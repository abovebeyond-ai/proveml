import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

const tmp = mkdtempSync(join(tmpdir(), 'proveml-cli-'));
const factsPath = join(tmp, 'facts.json');
const inputPath = join(tmp, 'report.md');
const badFactsPath = join(tmp, 'bad-facts.json');

writeFileSync(factsPath, JSON.stringify({
    'student:100.name': 'Alice Vermeer',
    'student:100.passRate': 85,
    'student:100.evaluated': 42,
}, null, 2));

writeFileSync(inputPath, '@[student:100]{Alice Vermeer} reached %[passRate]{85}% across %[evaluated]{42} attainment levels.');

writeFileSync(badFactsPath, JSON.stringify({
    'student:7.name': 'Alice Vermeer',
    'student:8.name': 'Alice Vermeer',
    'student:100.passRate': 85,
    'student:100.passRate._unit': '%',
    'student:100.profile': { enrolled: true },
    'student:101.attendance._unit': '%',
    'student:102.score._display': 'grouped',
    'bad key': 10,
}, null, 2));

console.log('\n=== CLI: doctor ===');
{
    const out = execFileSync('node', ['src/cli.js', 'doctor', '--facts', factsPath, '--json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
    const data = JSON.parse(out);
    assert('doctor accepts valid fact store', data.ok === true);
    assert('doctor reports zero errors for valid fact store', data.errors.length === 0, `got ${data.errors.length}`);
    assert('doctor reports zero warnings for valid fact store', data.warnings.length === 0, `got ${data.warnings.length}`);
}

{
    const out = spawnSync('node', ['src/cli.js', 'doctor', '--facts', badFactsPath, '--json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
    const data = JSON.parse(out.stdout);
    assert('doctor exits non-zero on malformed fact store', out.status === 1, `got ${out.status}`);
    assert('doctor catches orphan unit metadata', data.errors.some(error => error.includes('attendance._unit')), JSON.stringify(data.errors));
    assert('doctor catches orphan display metadata', data.errors.some(error => error.includes('score._display')), JSON.stringify(data.errors));
    assert('doctor catches object values', data.errors.some(error => error.includes('values must be scalars')), JSON.stringify(data.errors));
    assert('doctor warns about missing entity name', data.warnings.some(warning => warning.includes('student:100')), JSON.stringify(data.warnings));
    assert('doctor warns about a name shared by two records', data.warnings.some(warning => warning.includes('student:7, student:8') && warning.includes('ambiguous')), JSON.stringify(data.warnings));
}

console.log('\n=== CLI: strip ===');
{
    const out = execFileSync('node', ['src/cli.js', 'strip', '--input', inputPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
    assert('strip removes ProveML syntax but keeps visible text', out.trim() === 'Alice Vermeer reached 85% across 42 attainment levels.', `got ${JSON.stringify(out.trim())}`);
}

console.log('\n=== CLI: verify ===');
{
    const out = execFileSync('node', ['src/cli.js', 'verify', '--input', inputPath, '--facts', factsPath, '--json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
    const data = JSON.parse(out);
    assert('verify reports all claims verified', data.verified === data.total, `got ${data.verified}/${data.total}`);
    assert('verify returns details', Array.isArray(data.details) && data.details.length > 0);
}

console.log('\n=== CLI: render ===');
{
    const out = execFileSync('node', ['src/cli.js', 'render', '--input', inputPath, '--facts', factsPath, '--proof-paths'], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
    assert('render includes root wrapper', out.includes('proveml-root'));
    assert('render includes proof paths', out.includes('proveml-proof'));
}

console.log('\n=== CLI: example ===');
{
    const out = execFileSync('node', ['src/cli.js', 'example', '--json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
    const data = JSON.parse(out);
    assert('example returns markup', typeof data.markup === 'string' && data.markup.includes('@['));
    assert('example returns fact store', typeof data.factStore === 'object' && data.factStore['class:204.name'] === '3MA');
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
