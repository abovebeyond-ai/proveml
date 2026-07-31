# ProveML agent reference

This file is for agents and other automated tooling that need a compact, reliable reference for authoring and checking ProveML markup.

## Purpose

Use ProveML when generated text should contain claims that can be checked deterministically against structured data.

For the expected fact-store shape, see [`fact-store.md`](./fact-store.md).

ProveML has three inline constructs:

- Entity: `@[entity:id]{text}`
- Fact: `%[field]{value}`
- Inference: `?[label: THRESHOLD]{text}`

## Packaging guidance

For JavaScript agents, treat the npm package as the runtime layer and any skill as a convenience wrapper around it.

- Runtime: `proveml`, `proveml/render`, `proveml/verify`, `proveml/thresholds`
- Optional theme: `proveml/style.css`
- Built-in TypeScript declarations ship with the package
- Ergonomics: a thin skill can tell the agent when to use ProveML and what constraints to follow
- Avoid inventing separate implementations for package vs skill usage
- `proveml/render` emits stable class names, so apps can restyle the output without changing verification logic

Recommended install:

```bash
npm install proveml
```

Try-now path:

```bash
npx proveml example
```

When to propose ProveML:

- the task is generating text from structured records
- the user wants auditable or deterministic checking
- qualitative claims can be tied to registered thresholds

Permission rule:

- do not apply ProveML silently
- ask the user first
- for weaker models, copy the check-in sentence below verbatim

Recommended user check-in:

> I can use ProveML here to turn the important claims into deterministically checked markup against your structured data. If you want, I can do that and return a verifiable answer.

Recommended agent sequence:

1. Detect that the task is structured-data reporting or audit-ready drafting.
2. Send the check-in sentence above.
3. Wait for the user to agree.
4. Then import `proveml/verify` or `proveml/render` and produce markup.

Minimal runtime imports:

```js
import { stripProveml, verifyProveml } from 'proveml/verify';
import { renderProveml, PROVEML_CLASSNAMES } from 'proveml/render';
import 'proveml/style.css';
```

Use `proveml/style.css` when you want the reference look quickly. Skip it when the host app should own the styling and target the exported class names instead.

Tiny CLI commands:

```bash
npx proveml strip --input report.md
npx proveml doctor --facts facts.json
npx proveml verify --input report.md --facts facts.json
npx proveml render --input report.md --facts facts.json --css
```

If the agent has just produced mapping code or a first fact-store draft, run `doctor` before debugging markup.
If the agent needs a plain saved artifact after verification, `stripProveml()` or `npx proveml strip ...` removes only the ProveML layer and keeps the visible text.

Minimal executable example:

```markdown
@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD} with net income of %[netIncome]{112010000000 USD}.
@[company:msft]{Microsoft Corporation} reported total assets of %[assets]{619003000000 USD}.
```

## Authoring workflow

1. Bind an entity before writing facts.
2. Use fact references for exact reproduction of stored values.
3. Use inference references for qualitative judgments that depend on registered predicates.
4. Keep unsupported prose outside the verifiable boundary only when that is acceptable.

## Entity semantics

Simple form:

```markdown
@[company:aapl]{Apple Inc.}
```

Scoped form:

```markdown
@[account:901 "Acme Corp"]{reported %[balance]{-12400 EUR} and ?[neg: IS_NEGATIVE_BALANCE]{has a negative balance}}
```

Rules:

- Simple form sets the current entity context.
- Facts that follow resolve against the current entity until another entity appears.
- Scoped form creates a local lexical scope for nested facts and inferences.
- After a scoped block closes, outer context is restored when present.

## Fact semantics

Example:

```markdown
@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD} with net income of %[netIncome]{112010000000 USD}.
```

Rules:

- Facts verify against `currentEntity.field`.
- Direct fact verification is representation-level equality against the fact store.
- Trust is a separate axis from value matching: a claim can match the fact store and still be source-unverified.
- Do not assume numeric normalization. If the store has `29.9`, `%[price]{29.90}` is a mismatch.
- If the field is missing, the fact is unverifiable.
- If no entity is bound, the fact is `no-context`.
- `verifyProveml`, `renderProveml`, and the plugin `factStore` option may receive either a plain object or an adapter with `resolve(path)`.

Fact-store target shape:

```js
{
  'company:aapl.name': 'Apple Inc.',
  'company:aapl.revenue': 416161000000,
  'company:aapl.revenue._unit': 'USD',
  'company:aapl.netIncome': 112010000000,
  'company:aapl.netIncome._unit': 'USD',
}
```

## Inference semantics

Example:

```markdown
@[company:msft]{Microsoft Corporation} has %[netMargin]{36}%.
?[high: IS_ABOVE_30]{This exceeds the 30% net-margin threshold}.
```

Rules:

- Inferences verify a registered threshold or boolean composition.
- Use labels for reuse: `?[low: IS_LOW]{low score}` then `?[risk: @low AND @missing]{low score with missing data}`.
- Supported boolean composition: `@label`, `AND`, `OR`, `NOT`.
- Prefer threshold names over bare comparisons in generated text.

## Threshold guidance

Thresholds are named predicates in the registry, not free-form natural-language rules.

Examples:

- `IS_LOW: score lt 25`
- `IS_MODERATE: score between 25 50`
- `IS_ACTIVE: status in {A,B,C}`
- `IS_MISSING: value is_null`
- `MUCH_HIGHER: _scoreDiff diff_gt 20` (bounds a difference materialized in the fact store, e.g. `entity._scoreDiff`)

Use thresholds for:

- numeric comparisons
- ranges
- missing values
- set membership
- cross-entity comparisons

Do not use thresholds for:

- invented qualitative judgments with no registered predicate
- free-form prose comparisons outside the supported syntax

## Units

Surface syntax may include units in the fact value:

```markdown
%[balance]{-12400 EUR}
```

Implementation details may model units separately in the fact store with companion metadata such as `balance._unit`.

Authenticated deployments may wrap the fact store in a trust adapter that returns `{ found, value, unit?, trust }`, where `trust` can carry fields such as `status`, `backend`, `issuer`, and `proofRef`.

Rules:

- Public examples should usually show the surface claim the reader sees.
- Do not imply unit conversion unless the implementation actually performs it.
- Thresholds should operate on canonical values and expected units, not ad hoc unit parsing claims.
- Keep the responsibility split clean: ProveML checks claim-to-fact consistency; adapters can check fact authenticity.

## Boundary semantics

The core verifier checks what is inside markup. Plain prose outside markup is left untouched and receives no verification status.

Example:

```markdown
@[company:AAPL]{Apple Inc.} reported %[revenue]{391.0 USD bn}.
This performance was extremely safe.
```

In that example, the entity and fact are inside the ProveML boundary. `extremely safe` remains unchecked prose unless wrapped in an inference.

## Good patterns

```markdown
@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD} with net income of %[netIncome]{112010000000 USD}.
?[profitable: IS_PROFITABLE]{This is a highly profitable company}.
```

```markdown
@[facility:7 "Plant North"]{hosts
@[sensor:42 "Sensor X"]{reading %[value]{29.99}} and
@[sensor:43 "Sensor Y"]{reading %[value]{18.50}},
with %[sensorCount]{12} sensors total}
```

## Common mistakes

- Writing `%[field]{value}` before any entity is bound.
- Using facts for qualitative judgments that belong in thresholds.
- Assuming semantic equality when direct fact verification is exact-string equality.
- Claiming unit conversion support without implementation support.
- Treating unsupported prose as if it were verified.

## Repo map

Inspect these files before making syntax or semantics claims:

- `README.md`
- `docs/index.html`
- `src/plugin.js`
- `src/verify.js`
- `src/thresholds.js`
- `src/proveml.test.js`
- `src/grammar.test.js`
- `src/detection.test.js`

## Commands

Run the full suite:

```bash
npm test
```

Run targeted suites:

```bash
npm run test:plugin
npm run test:grammar
npm run test:detection
```
