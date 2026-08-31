---
name: proveml-review
description: "Run the ProveML loop on a report: build a fact store with evidence, write claims as ProveML markup, verify until the build is green, then spawn the review page so a human signs the one link no machine can check. Use when producing or auditing a report whose claims must be backed by evidence."
---

# ProveML review

Every report is a chain: source, a store of facts, claim, text. The verifier
guards the right half: a claim that does not equal the store kills the build.
This skill runs the whole chain, including the left half, the one link no
machine can close: whether a store value is a fair reading of its source.

The flow is agent-first. You do every step below yourself, except one click:
the human judgement. For that step you spawn the review page and wait.

## The authority rule

The claim may choose the question. It may never choose the answer.

Drafting decides which fields the store needs; iterate freely there. The
source decides the values. When a source does not support the value a
sentence wanted, the store gets the true value and the sentence changes,
never the other way round. The review page is where a human checks that this
ran in the right direction.

## The loop

1. **Draft.** Write the report as ProveML markup: `@[type:id]{name}` for
   entities, `%[field]{value}` for facts, `?[LABEL: COND]{text}` for
   judgements. Get the store's exact vocabulary first:
   `npx proveml prompt --facts store.json` prints the system prompt for it.

2. **Verify, fix, verify.** `npx proveml verify --input report.md --facts
   store.json` names every claim that does not hold. An unverifiable claim is
   a shopping list entry: either the store needs that fact, or the sentence
   should not be written. Iterate until exit 0. Add `--strict` so unmarked
   numbers become findings too.

3. **Record evidence.** For every store value, an entry in the evidence file:

   ```json
   { "field": "category", "claimValue": "inline financial tagging standard",
     "basis": "quote", "sourceQuote": "…verbatim from the source…",
     "sourceLocator": "what_is_ixbrl paragraph 3", "sourceHref": "raw/ixbrl.html" }
   ```

   `basis` is `quote`, `derived`, or `absence`. Archive a snapshot of each
   source; with `--snapshots dir`, a quote that is not verbatim in its
   snapshot fails the build. Never trim a quote to make a value fit: that is
   the exact move the human gate exists to catch.

4. **Spawn the gate and wait.**

   ```
   npx proveml review --facts store.json --evidence subjects.json \
     --snapshots raw/ --await --out review.json --signed-by "<reviewer>"
   ```

   This serves the page, opens the browser, and blocks. The human judges each
   reading (fair or flag) and presses "sign review". Exit 0 means everything
   judged, nothing flagged; exit 1 means flags or unjudged readings remain.
   Do not work around a non-zero exit: it is the human saying no.

5. **Act on flags.** A flag means the store value or its evidence is wrong.
   Fix it, then rerun from step 2. Every judgement is keyed by a hash of what
   it judged, so your fix kills exactly the judgements it invalidated; the
   rebuilt page reopens only those. Judgements you did not touch survive.

6. **Commit the sign-off.** `review.json` goes next to the store. Pass it
   back as `--committed review.json` on later runs: committed judgements ship
   with the page, and the next review is only the diff.

## Signing adapters

How a sign-off is attested is pluggable. `--signer signer.mjs` points at a
module whose default export is `async (review) => review`; it may add a name,
a key signature, a verifiable credential, a ledger anchor. A signer attests,
it never changes verdicts. Without one, the review records `signedBy` and
`signedAt` and attests nothing more.

## Done

Build green, zero unjudged, zero flags, review committed. Done un-happens by
itself the moment any evidence changes: that is the point.
