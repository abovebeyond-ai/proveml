# Security

ProveML is a verifier. A bug that lets an unproven claim read as proven is a security
issue, not a cosmetic one.

Report it privately to shane@abovebeyond.ai rather than in a public issue. You will get
an answer within five working days, and credit in the release notes if you want it.

In scope: anything that makes `verifyProveml` return a verified status for a claim the
fact store does not support, anything that lets a review root verify after a judgement
or a source changed, and canonicalisation inputs that hash differently from how they
read (see the Trojan Source handling in `proveml-c14n-2`).

Out of scope: the truth of the fact store itself. ProveML checks that text matches the
record, not that the record is right.
