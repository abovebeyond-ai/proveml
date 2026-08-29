#!/usr/bin/env node

import markdownIt from 'markdown-it';
import provemlPlugin from './plugin.js';

const factStore = {
  'student:100.name': 'Ylan Vercruysse',
  'student:100.passRate': 5,
  'student:100.passed': 2,
  'student:100.evaluated': 55,
  'student:100.total': 60,
  'student:100.absent': 47,
  'student:200.name': 'Khaled Albayyouk',
  'student:200.passRate': 80,
  'student:200.passed': 40,
  'student:200.evaluated': 50,
  'student:200.total': 52,
  'student:200.absent': 2,
  'offering:50.name': '4BS',
  'offering:50.studentCount': 18,
  'offering:50.passRate': 59,
  'offering:50.evalRate': 73,
};

function render(source) {
  const md = markdownIt({ html: false });
  md.use(provemlPlugin, { factStore });
  const env = {};
  md.render(source, env);
  return env.proveml;
}

let passed = 0, failed = 0, total = 0;
function test(name, input, expectedDetections) {
  total++;
  const v = render(input);
  // Anything that is not verified counts as a detection. The status strings
  // are the verifier's vocabulary (core.js); inferences land in v.facts.
  const detected = v.entities.filter(e => e.status !== 'verified').length
    + v.facts.filter(f => f.status !== 'verified').length;

  if (detected >= expectedDetections) {
    passed++;
    console.log(`  ✓ ${name} — detected ${detected} error(s)`);
  } else {
    failed++;
    console.log(`  ✗ ${name} — expected ${expectedDetections} detections, got ${detected}`);
  }
}

console.log('\n=== CATEGORY 1: Wrong Values ===\n');
test('Wrong passRate', '@[student:100]{Ylan Vercruysse} scoort %[passRate]{999}%.', 1);
test('Wrong studentCount', '@[offering:50]{4BS} telt %[studentCount]{999} leerlingen.', 1);
test('Off by one passRate', '@[student:100]{Ylan Vercruysse} scoort %[passRate]{6}%.', 1);
test('Wrong evaluated count', '@[student:100]{Ylan Vercruysse} heeft %[evaluated]{65} eindtermen afgenomen.', 1);
test('Swapped values between fields', '@[student:100]{Ylan Vercruysse} heeft %[passed]{60} van %[total]{2} eindtermen behaald.', 2);

console.log('\n=== CATEGORY 2: Wrong Entity ===\n');
test('Student A name with Student B id', '@[student:200]{Ylan Vercruysse} scoort %[passRate]{80}%.', 1);
test('Non-existent student id', '@[student:99999]{Fake Student} scoort %[passRate]{50}%.', 2);
test('Non-existent offering id', '@[offering:99999]{Fake Class} telt %[studentCount]{10} leerlingen.', 2);

console.log('\n=== CATEGORY 3: No Entity Context ===\n');
test('Bare fact without entity', 'De score is %[passRate]{50}%.', 1);
test('Multiple bare facts', 'Er zijn %[studentCount]{10} leerlingen met %[passRate]{75}% slaagpercentage.', 2);

console.log('\n=== CATEGORY 4: Wrong Threshold Inference ===\n');
test('IS_STRONG on weak student', '@[student:100]{Ylan Vercruysse} scoort %[passRate]{5}%. ?[strong: IS_STRONG]{Dit is een sterk resultaat}.', 1);
test('IS_LOW_PASS on strong student', '@[student:200]{Khaled Albayyouk} scoort %[passRate]{80}%. ?[low: IS_LOW_PASS]{Kritisch laag}.', 1);
test('Unknown threshold', '@[student:100]{Ylan Vercruysse} ?[x: INVENTED_THRESHOLD]{test}.', 1);
test('Bare comparison (rejected by design)', '@[student:100]{Ylan Vercruysse} ?[x: passRate > 3]{test}.', 1);

console.log('\n=== CATEGORY 5: Cross-Entity Attribution ===\n');
test('Student A passRate in Student B context', '@[student:200]{Khaled Albayyouk} scoort %[passRate]{5}%.', 1);
test('Offering passRate attributed to student', '@[student:100]{Ylan Vercruysse} scoort %[studentCount]{18}%.', 1);

console.log('\n=== CATEGORY 6: Subtle Errors ===\n');
test('Correct facts + one wrong fact mixed in', '@[student:100]{Ylan Vercruysse} scoort %[passRate]{5}% op %[evaluated]{55} eindtermen, waarvan %[passed]{999} behaald.', 1);
test('Correct entity name but slightly wrong', '@[student:100]{Ylan Vercruysse } scoort %[passRate]{5}%.', 1);
test('Right numbers, wrong entity order', '@[student:100]{Ylan Vercruysse} scoort %[passRate]{80}% en @[student:200]{Khaled Albayyouk} scoort %[passRate]{5}%.', 2);
test('Inference referencing unknown label', '@[student:100]{Ylan Vercruysse} ?[b: @nonexistent]{combinatie}.', 1);

console.log('\n' + '='.repeat(60));
console.log('DETECTION RATE RESULTS');
console.log('='.repeat(60));
console.log(`\nTotal tests: ${total}`);
console.log(`Errors detected: ${passed}`);
console.log(`Errors missed: ${failed}`);
console.log(`Detection rate: ${total > 0 ? Math.round(passed / total * 100) : 0}%`);
process.exit(failed > 0 ? 1 : 0);
