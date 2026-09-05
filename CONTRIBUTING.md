# Contributing to ProveML

ProveML is small on purpose: a markup, a deterministic verifier, a review page. The
best contributions keep it that way.

## What helps most

- **A failing test.** If the verifier accepts a claim it should refuse, or refuses one it
  should accept, a test in `src/*.test.js` that shows it is worth more than a fix
  without one.
- **An independent verifier.** The Python re-verification in `proveml-demos` shares no
  code with this package and agrees on the same roots. A third language would be a
  gift.
- **Adapters.** A trust adapter that reads a record from a source we do not read yet
  (a credential format, a ledger, a registry), with a test that pins what it proves.
- **Words.** Where the README or the docs made you guess, say so in an issue.

## Ground rules

- Every check terminates and every check answers. A change that makes the verifier
  guess, retry with a model, or "probably" pass is out of scope, however useful.
- No model in the verification loop. Models propose; the verifier compares.
- Canonicalisation is versioned (`proveml-c14n-2`). A change to it is a new contract
  version, never an edit to an existing one.
- Tests run with `npm test` and must stay green; add one for what you change.
- Commit messages say why, not only what.

## Process

Open a pull request against `main`. Small and focused beats large and complete. By
contributing you agree that your contribution is licensed under the Apache License 2.0,
like the rest of the project.

## Where things live

- `src/`: the package. `verify.js` is the judge, `review-page.js` is Vera's review page; the `vera` skill is the other half.
- `docs/`: human docs, the agent reference, the fact-store guide, and the deck.
- `skills/`: the Claude Code skills, `vera` and `proveml-review`.
- `proveml-demos`: live demos and the independent Python verifier.
- `proveml-research`: the paper, benchmarks and experiments.
