/**
 * SD-JWT Employment Credential — ProveML Trust Adapter Example
 *
 * Demonstrates how a selectively disclosed SD-JWT credential maps into
 * a ProveML trust adapter. The credential is mocked (no real JWT library
 * needed); the point is the adapter contract and the two-axis rendering:
 *
 *   matchStatus  — does the claim match the disclosed value?
 *   trustStatus  — is the credential verified, expired, or revoked?
 *
 * Run:  node examples/sd-jwt-employment.js
 * Opens: examples/sd-jwt-employment-demo.html
 */

import { renderProveml, PROVEML_CSS, attachHover } from '../src/render-html.js';
import { stripProveml } from '../src/verify.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ---------------------------------------------------------------------------
// 1. Mock SD-JWT credential (what a wallet would hold)
// ---------------------------------------------------------------------------

const credential = {
    iss: 'https://hr.acme.eu',
    issuerName: 'Acme NV — HR Department',
    sub: 'urn:uuid:alice-de-smet-2847',
    iat: '2024-09-01T00:00:00Z',
    exp: '2026-09-01T00:00:00Z',

    // All claims in the JWT; selective disclosure chooses which to reveal
    claims: {
        name:         'Alice De Smet',
        employer:     'Acme NV',
        role:         'Staff Engineer',
        department:   'Platform',
        startDate:    '2023-03-15',
        employeeId:   'EMP-2847',
        location:     'Ghent',
    },

    // Simulated SD-JWT state
    signatureValid: true,
    disclosed: ['name', 'employer', 'role', 'department', 'startDate', 'employeeId', 'location'],
};

// A second credential: expired
const expiredCredential = {
    ...credential,
    iss: 'https://hr.oldcorp.eu',
    issuerName: 'OldCorp — HR',
    sub: 'urn:uuid:bob-janssens-1102',
    exp: '2025-01-01T00:00:00Z',
    claims: {
        name:       'Bob Janssens',
        employer:   'OldCorp BV',
        role:       'Junior Developer',
        department: 'Backend',
        startDate:  '2021-06-01',
        employeeId: 'OC-1102',
        location:   'Antwerp',
    },
    signatureValid: true,
};

// ---------------------------------------------------------------------------
// 2. SD-JWT trust adapter
// ---------------------------------------------------------------------------

function sdJwtAdapter(entityId, cred) {
    const now = new Date();
    const expiry = new Date(cred.exp);
    const isExpired = now > expiry;

    // Build a flat claim index: person:<id>.<field> -> value
    const claimIndex = {};
    for (const field of cred.disclosed) {
        claimIndex[`person:${entityId}.${field}`] = cred.claims[field];
    }
    // Also index the name field
    claimIndex[`person:${entityId}.name`] = cred.claims.name;

    const trustBase = {
        backend: 'sd-jwt',
        issuer: cred.issuerName,
        proofRef: `sha256:${simpleHash(JSON.stringify(cred))}`,
        checkedAt: now.toISOString(),
    };

    return {
        resolve(path) {
            const value = claimIndex[path];
            if (value === undefined) return { found: false };

            let status;
            if (!cred.signatureValid) status = 'error';
            else if (isExpired) status = 'expired';
            else status = 'verified';

            return {
                found: true,
                value,
                trust: { ...trustBase, status },
            };
        }
    };
}

// Combine multiple adapters (one per credential / entity)
function compositeAdapter(...adapters) {
    return {
        resolve(path) {
            for (const adapter of adapters) {
                const result = adapter.resolve(path);
                if (result.found) return result;
            }
            return { found: false };
        }
    };
}

function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// 3. ProveML markup — employment summary
// ---------------------------------------------------------------------------

const verifiedMarkup = `@[person:alice "Alice De Smet"]{is employed at %[employer]{Acme NV} as a %[role]{Staff Engineer} in the %[department]{Platform} department. She joined on %[startDate]{2023-03-15} and is based in %[location]{Ghent} (employee %[employeeId]{EMP-2847}).}`;

const expiredMarkup = `@[person:bob "Bob Janssens"]{was employed at %[employer]{OldCorp BV} as a %[role]{Junior Developer} in the %[department]{Backend} department, starting %[startDate]{2021-06-01} (employee %[employeeId]{OC-1102}).}`;

const mismatchMarkup = `@[person:alice "Alice De Smet"]{is employed at %[employer]{Acme NV} as a %[role]{Senior Engineer} in the %[department]{Platform} department.}`;

// ---------------------------------------------------------------------------
// 4. Build adapters and render
// ---------------------------------------------------------------------------

const aliceAdapter = sdJwtAdapter('alice', credential);
const bobAdapter = sdJwtAdapter('bob', expiredCredential);
const combined = compositeAdapter(aliceAdapter, bobAdapter);

const scenarios = [
    {
        id: 'verified',
        title: 'Verified credential',
        subtitle: 'All claims match the disclosed SD-JWT. Credential is valid and not expired.',
        markup: verifiedMarkup,
        adapter: aliceAdapter,
        showProofPaths: false,
    },
    {
        id: 'verified-audit',
        title: 'Audit mode',
        subtitle: 'Same verified credential, with proof paths and trust metadata visible inline.',
        markup: verifiedMarkup,
        adapter: aliceAdapter,
        showProofPaths: true,
    },
    {
        id: 'expired',
        title: 'Expired credential',
        subtitle: 'Claims match, but the SD-JWT has expired. Match is green; trust shows expired.',
        markup: expiredMarkup,
        adapter: bobAdapter,
        showProofPaths: false,
    },
    {
        id: 'mismatch',
        title: 'Value mismatch',
        subtitle: 'The markup says "Senior Engineer" but the credential says "Staff Engineer". Trust is verified, but the claim does not match.',
        markup: mismatchMarkup,
        adapter: aliceAdapter,
        showProofPaths: false,
    },
];

// ---------------------------------------------------------------------------
// 5. Generate self-contained HTML
// ---------------------------------------------------------------------------

function renderScenario(s) {
    const result = renderProveml(s.markup, s.adapter, { showProofPaths: s.showProofPaths });
    const plain = stripProveml(s.markup);
    const v = result.verification;
    const statusTag = v.verified === v.total
        ? `<span class="badge badge-ok">${v.verified}/${v.total} verified</span>`
        : `<span class="badge badge-warn">${v.verified}/${v.total} verified</span>`;

    return `
    <div class="scenario" id="${s.id}">
      <h3>${s.title} ${statusTag}</h3>
      <p class="scenario-sub">${s.subtitle}</p>
      <div class="side-by-side">
        <div class="panel">
          <div class="panel-label">Plain text</div>
          <div class="panel-body plain-text">${plain}</div>
        </div>
        <div class="panel">
          <div class="panel-label">ProveML + SD-JWT trust</div>
          <div class="panel-body proveml-output">${result.html}</div>
        </div>
      </div>
    </div>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ProveML + SD-JWT Employment Demo</title>
  <style>
    ${PROVEML_CSS}

    /* --- Trust icon treatment --- */
    .proveml-trust-verified::after {
      content: '\\1F512';
      font-size: 0.7em;
      margin-left: 2px;
      vertical-align: super;
    }
    .proveml-trust-expired::after {
      content: '\\26A0';
      font-size: 0.7em;
      margin-left: 2px;
      vertical-align: super;
    }
    .proveml-trust-revoked::after {
      content: '\\1F6AB';
      font-size: 0.7em;
      margin-left: 2px;
      vertical-align: super;
    }
    .proveml-trust-error::after {
      content: '\\2716';
      font-size: 0.7em;
      margin-left: 2px;
      vertical-align: super;
    }

    /* --- Page layout --- */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #f9fafb;
      padding: 2rem;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
    .page-sub { color: #6b7280; margin-bottom: 2rem; font-size: 0.95rem; }
    h3 { font-size: 1.1rem; margin-bottom: 0.15rem; display: flex; align-items: center; gap: 8px; }
    .scenario { margin-bottom: 2.5rem; }
    .scenario-sub { color: #6b7280; font-size: 0.85rem; margin-bottom: 0.75rem; }

    .side-by-side { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 640px) { .side-by-side { grid-template-columns: 1fr; } }

    .panel {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #fff;
      overflow: hidden;
    }
    .panel-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #9ca3af;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid #f3f4f6;
      background: #fafafa;
    }
    .panel-body { padding: 0.75rem; font-size: 0.92rem; }
    .plain-text { color: #6b7280; }

    .badge {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-ok { background: #d1fae5; color: #065f46; }
    .badge-warn { background: #fef3c7; color: #92400e; }

    .legend {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      font-size: 0.8rem;
      color: #6b7280;
      margin-bottom: 2rem;
      padding: 0.75rem 1rem;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-swatch {
      display: inline-block;
      width: 18px;
      border-bottom: 2px dotted;
      margin-right: 2px;
    }
    .legend-swatch.entity { border-bottom-style: solid; border-color: #0d9488; }
    .legend-swatch.fact { border-color: #0d9488; }
    .legend-swatch.mismatch { border-color: #dc2626; }

    .adapter-box {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-bottom: 2rem;
      font-size: 0.82rem;
      color: #4b5563;
    }
    .adapter-box code {
      background: #f3f4f6;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <h1>ProveML + SD-JWT Employment Credential</h1>
  <p class="page-sub">Selective disclosure meets claim-level verification. The AI writes prose; ProveML checks each claim against the disclosed credential.</p>

  <div class="legend">
    <span class="legend-item"><span class="legend-swatch entity"></span> Entity (verified name)</span>
    <span class="legend-item"><span class="legend-swatch fact"></span> Fact (matches credential)</span>
    <span class="legend-item"><span class="legend-swatch mismatch"></span> Mismatch (wrong value)</span>
    <span class="legend-item">\u{1F512} Source authenticated</span>
    <span class="legend-item">\u{26A0} Credential expired</span>
  </div>

  <div class="adapter-box">
    <strong>Trust adapter:</strong> <code>sd-jwt</code> &mdash;
    Each disclosed claim resolves via <code>adapter.resolve(path)</code> and returns
    <code>{ value, trust: { status, backend: 'sd-jwt', issuer, proofRef } }</code>.
    ProveML checks match and trust independently.
  </div>

  ${scenarios.map(renderScenario).join('\n')}

  <script>
    // Attach entity-highlight hover behavior
    document.querySelectorAll('.proveml-root').forEach(root => {
      root.addEventListener('mouseover', (e) => {
        const el = e.target.closest('[data-entity]');
        if (!el) return;
        const path = el.dataset.entity;
        root.querySelectorAll('.proveml-entity-highlight').forEach(x => x.classList.remove('proveml-entity-highlight'));
        root.querySelectorAll('[data-entity="' + path + '"]').forEach(x => x.classList.add('proveml-entity-highlight'));
      });
      root.addEventListener('mouseout', (e) => {
        if (e.target.closest('[data-entity]')) {
          root.querySelectorAll('.proveml-entity-highlight').forEach(x => x.classList.remove('proveml-entity-highlight'));
        }
      });
    });
  </script>
</body>
</html>`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, 'sd-jwt-employment-demo.html');
writeFileSync(outPath, html);
console.log(`Demo written to ${outPath}`);
console.log('Open it in a browser to see plain vs. ProveML side-by-side.');
