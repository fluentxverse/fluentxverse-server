# Archived Application Contracts

Archived on October 19, 2026. Historical source only, not an audited release.

This preserves AnonymousReviewRegistry, LessonPassLedger, TutorScreeningValidator,
their deployment tools and tests, and the original application adapters. Paths in
`MANIFEST.json` are relative to the monorepo root; each archived file has a SHA256
digest. `move` means retired from its original source path. `copy` means the
original version is preserved here while an active adapter may have changed.

The ERC-8004 registries, Engine deployment tooling, and PayoutAuthorization
prototype are preserved separately in GMR Engine at
`_archive/fluentxverse-custom-contracts-20261019/`.

Do not execute deployment or persistence scripts from this archive. Imports and
relative paths describe their original location. Study or restore a complete
version in an isolated worktree with disposable databases, explicit approvals,
reviewed proving artifacts, and a separate deployment plan.

Archiving does not delete deployed contracts, transfer funds, revoke credentials,
convert entitlements, erase proof journals, or change ownership. Old proofs must
not be relabeled as bridge-only proofs. The active review adapter relies on
application acceptance rules plus finalized receipts from the official Horizen
zkVerify bridge. It does not provide independently enforced on-chain acceptance,
duplicate prevention, revocation, or completeness.

See [retirement scope](../../docs/custom-contract-retirement.md).
