# ProveML

An AI writes: *"Revenue was $416 billion and the margin is healthy."*

Both halves can be wrong, and nothing in the sentence tells you which. ProveML
lets the model mark its claims so a machine can check them:

```markdown
@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD}.
?[healthy: IS_PROFITABLE]{The margin is healthy}.
```

Every marked claim is checked against your data by lookup and comparison —
**no model in the verification loop**. What the data cannot support is visible
as such, instead of reading like everything else.

## See it in 10 seconds

```bash
npx proveml demo
```

```
  Apple Inc. reported revenue of 416161000000 USD
  ──────────                     ────────────────
  Alphabet reported revenue of 350018000000 USD.
  ╌╌╌╌╌╌╌╌                     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  ? company:goog not in store

  5/7 claims verified
```

Then check your own:

```bash
npx proveml verify --input report.md --facts facts.json
```

## The three constructs

| Construct | Means | Checked by |
|---|---|---|
| `@[type:id]{Name}` | this text refers to that record | name equality against `type:id.name` |
| `%[field]{value}` | this value is that field | string equality against `type:id.field` |
| `%[type:id.field]{value}` | same, naming the record itself | for sentences where the subject is not the nearest entity |
| `?[label: THRESHOLD]{text}` | this judgment holds | arithmetic against a registered threshold |

Anything outside a construct is ordinary prose and is never claimed to be
checked — the boundary is the point.

## Why a threshold registry

`%[...]` covers numbers, but reports also say *"critically low"* and
*"healthy"*. Those are claims too, and a model will happily invent them.
So qualitative wording must name a threshold that a domain expert defined
outside the generation:

```js
IS_LOW_PASS: { field: 'passRate', op: 'lt', value: 25, label: 'critically low' }
```

The model may use `?[low: IS_LOW_PASS]{critically low}` and nothing else. It
cannot invent the magnitude, the direction, or the cutoff.

## Coverage: what is not a claim

A verification rate counts only what is inside markup, so a report that marks
up one number and leaves nine in plain prose would score 100%. The verifier
therefore also reports **coverage**: every standalone number in the prose that
no construct covers.

```
  Ylan scores 5% and missed 62 days.
  ────        ─           ┄┄
                          · not a claim

  2/2 claims verified, 1 number outside any claim
```

`verifyProveml` always returns `coverage` and `unmarked`; with `{ strict: true }`
(CLI: `--strict`) each unmarked number is a finding. Years, list markers and
numbers inside code are not counted.

## What it does not do

- It verifies **consistency with your data**, not truth. Wrong data, wrong verified claims.
- It checks what is **inside** markup. Prose outside is unchecked, by design.
- Values must match exactly: `18.5`, not `18.50` and not "about 18".
- Derived values (differences, counts) need to exist in the store to be claimable.
- An entity verifies when the name the reader sees equals the name at the id the model chose; nothing checks that the id is the right record. So the verifier reports whether that name is unique in the store (`subjectUnique`), `doctor` warns on duplicate names, and `--strict` makes an ambiguous subject a finding.
- If the store carries a unit (`revenue._unit`), the claim must carry it too: `%[revenue]{416161000000 USD}`.
- `THRESHOLD(path)` may point at another entity, never at another field: `IS_STRONG(student:100.absent)` is unverifiable, because the registry decides which field a judgment is about.
- Constructs inside fenced code blocks, code spans, or preceded by a backslash are not claims. The verifier and the markdown-it plugin agree on this; both judge through the same core.
- Threshold names are uppercase letters, digits and underscores starting with a letter (`IS_ABOVE_30`). A registry key outside that shape throws at load instead of sitting there unreachable.

## Fact-store format

If your data is already structured, the ProveML target format is intentionally small:

```js
{
  'company:aapl.name': 'Apple Inc.',
  'company:aapl.revenue': 416161000000,
  'company:aapl.revenue._unit': 'USD',
  'company:aapl.netIncome': 112010000000,
  'company:aapl.netIncome._unit': 'USD',
  'company:aapl.eps': 7.49,
  'company:aapl.eps._unit': 'USD/shares',
}
```

Use one small mapping step to flatten your source data into stable paths like `entityType:entityId.field`. See the full guide in [`docs/fact-store.md`](docs/fact-store.md).

## Install

Most adopters only need the package itself:

```bash
npm install proveml
```

If you specifically want the `markdown-it` plugin, add `markdown-it` too:

```bash
npm install proveml markdown-it
```

For a zero-install trial path:

```bash
npx proveml example
```

```bash
npx proveml doctor --facts facts.json
```

```bash
npx proveml verify --input report.md --facts facts.json
```

## Development setup

This repo is currently set up primarily as a reference implementation repo.

```bash
git clone https://github.com/ShaneDeconinck/proveml.git
cd proveml
npm install
npm test
```

`markdown-it` is a peer dependency for consumers and a dev dependency here so the test suite runs out of the box.

## Usage

### markdown-it plugin

```js
import markdownIt from 'markdown-it';
import provemlPlugin from 'proveml';

const factStore = {
  'company:aapl.name': 'Apple Inc.',
  'company:aapl.revenue': 416161000000,
  'company:aapl.revenue._unit': 'USD',
  'company:aapl.netIncome': 112010000000,
  'company:aapl.netIncome._unit': 'USD',
};

const md = markdownIt();
md.use(provemlPlugin, { factStore });

const env = {};
const html = md.render(
  '@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD} with net income of %[netIncome]{112010000000 USD}.',
  env
);

console.log(html);
console.log(env.proveml);
```

### standalone verifier

```js
import { stripProveml, verifyProveml } from 'proveml/verify';

const result = verifyProveml(
  '@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD} with net income of %[netIncome]{112010000000 USD}.',
  {
    'company:aapl.name': 'Apple Inc.',
    'company:aapl.revenue': 416161000000,
    'company:aapl.revenue._unit': 'USD',
    'company:aapl.netIncome': 112010000000,
    'company:aapl.netIncome._unit': 'USD',
  },
  { snapshot: 'sec-edgar-fy2024' }
);

console.log(result.total);     // 2
console.log(result.verified);  // 2
console.log(result.snapshot);  // sec-edgar-fy2024
console.log(stripProveml('@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD}.'));
// Apple Inc. reported revenue of 416161000000 USD.
```

The second argument can be either:

- a plain fact-store object
- an adapter with `resolve(path) -> { found, value, unit?, trust? }`

When trust metadata is present, verification details gain additive fields such as `trustStatus`, `trustBackend`, `trustIssuer`, and `trustProofRef`.

### optional trust adapters

```js
import { verifyProveml } from 'proveml/verify';

const adapter = {
  resolve(path) {
    if (path === 'company:aapl.name') {
      return {
        found: true,
        value: 'Apple Inc.',
        trust: { status: 'verified', backend: 'sd-jwt', issuer: 'did:example:issuer-7' }
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
          issuer: 'did:example:issuer-7',
          proofRef: 'jwt:sha256:abc123'
        }
      };
    }
    return { found: false };
  }
};

const result = verifyProveml(
  '@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD}.',
  adapter
);

console.log(result.details[1].status);       // verified
console.log(result.details[1].trustStatus);  // verified
console.log(result.details[1].trustBackend); // sd-jwt
```

Use this when you want ProveML to stay responsible for claim-to-fact matching while a separate trust layer authenticates where the facts came from.

### tiny CLI

```bash
npx proveml strip --input report.md > plain.md
npx proveml doctor --facts facts.json
npx proveml verify --input report.md --facts facts.json
npx proveml render --input report.md --facts facts.json --css > report.html
npx proveml example --json
```

The CLI is intentionally small:

- `strip` removes only the ProveML syntax and keeps the visible text
- `doctor` checks fact-store shape before you start debugging markup
- `verify` checks ProveML markup against a fact store
- `render` returns embeddable HTML
- `example` prints a copyable built-in example for quick trials

Use `strip` when you want plain persisted text after verification. Deciding what content should or should not be persisted at all remains application policy rather than ProveML policy.

### embeddable HTML renderer

```js
import { renderProveml, attachHover, PROVEML_CLASSNAMES } from 'proveml/render';
import 'proveml/style.css';

const factStore = {
  'company:aapl.name': 'Apple Inc.',
  'company:aapl.revenue': 416161000000,
  'company:aapl.revenue._unit': 'USD',
  'company:aapl.netIncome': 112010000000,
  'company:aapl.netIncome._unit': 'USD',
};

const { html, verification } = renderProveml(
  '@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD} with net income of %[netIncome]{112010000000 USD}.',
  factStore,
  { showProofPaths: true }
);

document.getElementById('output').innerHTML = html;
attachHover(document.getElementById('output'));

console.log(verification.verified, verification.total);
console.log(PROVEML_CLASSNAMES.fact); // "proveml-fact"
```

Use the plugin when you want full `markdown-it` integration. Use `proveml/render` when you want one small renderer that can be embedded directly in ordinary HTML.

If trust metadata is present and `showProofPaths` is enabled, the audit proof output includes both the fact path and the trust status/backend.

Styling is optional:

- `proveml/render` emits stable semantic class names such as `proveml-entity`, `proveml-fact`, and `proveml-inference`
- `proveml/render` also emits `data-trust-*` attributes and trust classes such as `proveml-trust-verified` when adapters provide source-authentication metadata
- `proveml/style.css` is the reference theme, not a required UI layer
- you can override the look with ordinary CSS variables such as `--proveml-entity-color`, `--proveml-danger-color`, and `--proveml-paragraph-gap`
- if you need zero-build embedding, `proveml/render` also exports `PROVEML_CSS`

## Package + skill

The core runtime is the npm package. For agent tooling, the smoothest setup is usually to keep `proveml` as the single JavaScript implementation and put a thin skill wrapper on top of it. That gives agents an ergonomic entry point without creating a second implementation surface.

Use this pattern when:

- a JavaScript agent is drafting text from structured records
- important claims should be deterministically checked before release
- qualitative language should come from registered thresholds rather than free prose

Before applying ProveML, ask the user first. For weaker models, prefer the exact wording below.

Recommended agent check-in:

> I can use ProveML here to turn the important claims into deterministically checked markup against your structured data. If you want, I can do that and return a verifiable answer.

Default agent flow:

1. Notice that the task involves structured records or audit-ready claims.
2. Send the check-in sentence above.
3. Wait for the user's approval.
4. Then use `proveml` as the runtime and optionally a thin skill wrapper for ergonomics.

Recommended JS-first setup:

```bash
npm install proveml
```

```js
import { verifyProveml } from 'proveml/verify';
import { renderProveml } from 'proveml/render';
import { plainAdapter } from 'proveml/trust-adapter';
```

That combination is the intended adoption path:

- npm package for the real runtime
- `npx proveml ...` for quick trials
- `llms.txt` for discovery
- a thin skill for agent ergonomics
- optional reference CSS when you want default rendering styles quickly

Minimal executable example:

```markdown
@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD} with net income of %[netIncome]{112010000000 USD}.
@[company:msft]{Microsoft Corporation} reported total assets of %[assets]{619003000000 USD}.
```

## Tests

The main test command runs four suites:

- plugin verification behavior
- grammar conformance
- paper-example regression
- detection-rate regression

Run them with:

```bash
npm test
```

Or individually:

```bash
npm run test:plugin
npm run test:grammar
npm run test:examples
npm run test:detection
```

## Companion research repo

The paper, reference-audit workflow, benchmarks, datasets, and experiment outputs have been split into a companion `proveml-research` repository so this package repo can stay small and focused.

## Documentation

- [`docs/index.html`](docs/index.html) — human-friendly docs
- [`docs/agent-reference.md`](docs/agent-reference.md) — reference for LLM agents
- [`docs/fact-store.md`](docs/fact-store.md) — fact-store guide
- [`llms.txt`](llms.txt) — agent discovery file
- Paper, benchmarks and experiments: [proveml-research](https://github.com/ShaneDeconinck/proveml-research)
