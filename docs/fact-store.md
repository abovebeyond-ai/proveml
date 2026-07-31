# ProveML fact-store guide

ProveML keeps the verification contract intentionally small. It does not require a database, vector store, or domain-specific importer. It expects a flat JavaScript object whose keys are stable fact paths.

That flat object is still the default and recommended starting point. If you later need authenticated sources, you can wrap the same paths in an adapter with `resolve(path)` and optional trust metadata without changing your markup.

## Canonical shape

The target format is:

```js
{
  'entityType:entityId.name': 'Display Name',
  'entityType:entityId.field': value,
  'entityType:entityId.otherField': value
}
```

Examples:

```js
{
  'company:aapl.name': 'Apple Inc.',
  'company:aapl.revenue': 416161000000,
  'company:aapl.revenue._unit': 'USD',
  'company:aapl.netIncome': 112010000000,
  'company:aapl.netIncome._unit': 'USD',
  'company:msft.name': 'Microsoft Corporation',
  'company:msft.assets': 619003000000,
  'company:msft.assets._unit': 'USD',
}
```

Optional unit metadata uses the same path with a `._unit` suffix:

```js
{
  'account:901.balance': -12400,
  'account:901.balance._unit': 'EUR'
}
```

## Naming rules

- Use `entityType:entityId` as the stable subject prefix.
- Keep field names simple and predictable.
- Use the same field name everywhere a threshold should apply.
- Store canonical values exactly as you want `%[field]{...}` to match them.
- Use `._unit` only as metadata; the public claim still uses `%[field]{value unit}`.

## Why flat keys?

ProveML resolves direct claims against addressable paths such as:

- `company:aapl.revenue`
- `company:msft.assets`
- `account:901.balance`

This keeps verification cheap and deterministic:

- key lookup
- exact value comparison
- registered predicate evaluation

No extra model call is needed in the verification loop.

## From nested JSON

Many source systems already return nested objects. The goal is not to preserve the whole source tree; the goal is to expose the fields you want ProveML to verify.

Input:

```js
const source = {
  company: {
    ticker: 'aapl',
    name: 'Apple Inc.',
    revenue: 416161000000,
    netIncome: 112010000000,
    eps: 7.49,
  }
};
```

Target:

```js
const factStore = {
  'company:aapl.name': source.company.name,
  'company:aapl.revenue': source.company.revenue,
  'company:aapl.revenue._unit': 'USD',
  'company:aapl.netIncome': source.company.netIncome,
  'company:aapl.netIncome._unit': 'USD',
  'company:aapl.eps': source.company.eps,
  'company:aapl.eps._unit': 'USD/shares',
};
```

## From row-based data

CSV rows, SQL result sets, and API lists usually map cleanly too.

Input:

```js
const row = {
  ticker: 'aapl',
  company_name: 'Apple Inc.',
  revenue: 416161000000,
  net_income: 112010000000,
  eps: 7.49,
};
```

Target:

```js
const factStore = {
  [`company:${row.ticker}.name`]: row.company_name,
  [`company:${row.ticker}.revenue`]: row.revenue,
  [`company:${row.ticker}.revenue._unit`]: 'USD',
  [`company:${row.ticker}.netIncome`]: row.net_income,
  [`company:${row.ticker}.netIncome._unit`]: 'USD',
  [`company:${row.ticker}.eps`]: row.eps,
  [`company:${row.ticker}.eps._unit`]: 'USD/shares',
};
```

## Recommended workflow

For most teams, the smoothest pattern is:

1. Keep your source data in its natural format.
2. Add one small mapping step that produces the ProveML fact store.
3. Run `npx proveml doctor --facts facts.json` to catch obvious shape issues early.
4. Verify generated ProveML text against that flat store.

This mapping step is usually small enough to write by hand or generate with an LLM and then inspect.

## Optional trust adapters

If your data comes from credentials, signed APIs, or other authenticated sources, keep the ProveML path shape the same and add an adapter layer:

```js
const adapter = {
  resolve(path) {
    const record = signedSource.lookup(path);
    if (!record) return { found: false };
    return {
      found: true,
      value: record.value,
      unit: record.unit,
      trust: {
        status: 'verified',
        backend: 'signed-api',
        proofRef: record.signatureId
      }
    };
  }
};
```

That keeps the separation of concerns clean:

- ProveML verifies that a claim matches `entity:id.field`
- the adapter verifies that the underlying fact is authentic

## Quick validation

Once you have a first draft of the fact store, run:

```bash
npx proveml doctor --facts facts.json
```

The `doctor` command stays intentionally lightweight. It checks:

- key shape such as `entityType:entityId.field`
- unit metadata like `field._unit`
- missing `.name` fields
- object or array values that should have been flattened first

## What ProveML should not become

ProveML is not trying to be:

- a universal ETL framework
- a schema registry for every domain
- a large set of domain-specific flatteners

That would make the package heavier and harder to trust.

## Good use of AI here

AI is often useful for generating the mapping code itself.

Good prompt:

> Here is my source JSON shape. Generate a small JavaScript function that maps it into a ProveML fact store with keys like `company:aapl.revenue` and `company:aapl.netIncome`.

That is a good use of AI because the result is:

- short
- inspectable
- ordinary code
- easy to test

## Practical advice

- Start with one entity type and 2 to 5 fields.
- Get one end-to-end verified example working first.
- Add thresholds only after the direct facts are stable.
- Keep the fact store boring and explicit.

If the data is already structured, getting into ProveML format should usually be easy.
