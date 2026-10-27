# Retired Legacy Proof Circuit

This V1 proof path is retired. Its initial Groth16 setup key had no circuit-specific phase-two contribution and accepted fabricated proofs without a private witness.

The API cannot generate or submit these proofs, regardless of environment flags. Authenticated legacy mutation endpoints return HTTP 410. Historical records and transactions are preserved but are not valid certification or attendance evidence. Public status reads report retirement, expiry or revocation rather than verification.

Do not reuse the old WASM, R1CS, zkey or verification key. The tutor circuit source now bounds scores to 0..100, but a source correction does not repair existing keys or artifacts.

Original source snapshots are in `archives/legacy-proofs-20261020` at the repository root. Tutor application approval, lesson booking and earnings remain separate from proof verification. New tutor screening uses `tutor-screening-v2` and remains disabled until independently reviewed proving artifacts and setup records are approved.
