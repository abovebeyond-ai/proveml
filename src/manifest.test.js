import {
    buildManifest, canonicalSegments, inclusionProof, verifyInclusion,
    findQuote, quoteEvidence, leafHash, MANIFEST_VERSION,
} from './manifest.js';

let passed = 0, failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  ok ${name}`); }
    else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}
function throws(fn, re) {
    try { fn(); return false; } catch (e) { return re.test(String(e.message)); }
}

const HTML = `
<html><head><style>p{color:red}</style><script>evil()</script></head><body>
<h1>What is iXBRL?</h1>
<p>iXBRL, or Inline XBRL, is an   open standard.</p>
<p>It embeds extra &#8220;tags&#8221; into the HTML standard.</p>
<ul><li>First point</li><li>Second   point</li></ul>
</body></html>`;

console.log('\n=== manifest: canonical segmentation is the contract ===');
{
    const segs = canonicalSegments(HTML);
    assert('blocks become leaves, scripts and styles do not', segs.length === 5 && segs[0] === 'What is iXBRL?' && !segs.join(' ').includes('evil'));
    assert('entities decode and whitespace squashes', segs[2] === 'It embeds extra “tags” into the HTML standard.' && segs[1].includes('an open standard'));
    assert('list items are their own leaves', segs[3] === 'First point' && segs[4] === 'Second point');
}

console.log('\n=== manifest: the tree ===');
{
    const m = buildManifest(HTML, { source: 'https://example.org/ixbrl', capturedAt: '2026-09-01' });
    assert('versioned contract travels with it', m.v === MANIFEST_VERSION && m.canonicalization === 'proveml-c14n-1' && m.segmentation === 'block-1');
    assert('deterministic root', m.root === buildManifest(HTML).root);
    assert('provenance is not hashed into the tree', buildManifest(HTML, { capturedAt: '2027-01-01' }).root === m.root);
    const tampered = HTML.replace('open standard', 'open standard!');
    assert('one changed character changes the root', buildManifest(tampered).root !== m.root);
    assert('empty source refuses', throws(() => buildManifest('<p> </p>'), /no content survives/));

    for (const n of [1, 2, 3, 5]) {
        const doc = Array.from({ length: n }, (_, i) => `<p>leaf number ${i}</p>`).join('');
        const mm = buildManifest(doc);
        const ok = mm.leaves.every((l) => verifyInclusion(mm.root, l.text, inclusionProof(mm, l.i)));
        assert(`every proof verifies at ${n} leaves (odd promotion included)`, ok);
    }

    const p = inclusionProof(m, 2);
    assert('a proof fails against the wrong text', !verifyInclusion(m.root, 'not the leaf', p));
    assert('a proof fails against a tampered root', !verifyInclusion(buildManifest(tampered).root, m.leaves[2].text, p));
    assert('unknown contract refuses', throws(() => inclusionProof({ ...m, canonicalization: 'other' }, 0), /unknown manifest contract/));
}

console.log('\n=== manifest: quotes become leaf evidence ===');
{
    const m = buildManifest(HTML);
    const hit = findQuote(m, 'embeds   extra “tags”');
    assert('whitespace-insensitive hit with a computable locator', hit && hit.index === 2 && hit.offset === 3);
    assert('absent quote is null', findQuote(m, 'never said this') === null);
    assert('a quote spanning two leaves is null, not guessed', findQuote(m, 'First point Second point') === null);

    const ev = quoteEvidence(m, 'an open standard');
    assert('evidence bundle carries leaf, root and proof', ev.leafIndex === 1 && ev.root === m.root && ev.leafHash === leafHash(m.leaves[1].text));
    assert('the bundle verifies standalone', verifyInclusion(ev.root, m.leaves[ev.leafIndex].text, ev.proof));
    assert('a missing quote throws at the gate', throws(() => quoteEvidence(m, 'nope'), /not found verbatim/));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
