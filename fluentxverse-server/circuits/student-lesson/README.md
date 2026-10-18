# Student lesson attendance proof

## What is proved

A student can claim a Groth16 proof for a booked lesson after the scheduled end time when the assigned tutor marked the student present. The server checks that the booking belongs to the authenticated student, has not been cancelled, and has tutor-reported `attendanceStudent = present`. The same server signs the resulting credential with a dedicated EdDSA-Poseidon issuer key, builds the witness, verifies the proof locally, and (when configured) submits it to zkVerify Volta.

The circuit proves knowledge of a private booking hash, student hash, nonce, and issuer signature. It constrains attendance and lesson-ended flags to 1, checks the Poseidon commitment, and verifies the issuer signature over the booking hash, flags, commitment, and public credential type. Public inputs are the commitment, credential-type field value, and issuer public key. Student identity and booking ID are not published in the proof's public signals. Claims for the same booking are deterministic with an unchanged issuer secret, so public commitments can be correlated if shared twice.

The flags are *issuer attestations*. This does **not** cryptographically prove a student stayed in the call for the whole lesson, independently verify the tutor's report, or make the database/time source trustless. External verifiers must pin the genuine issuer public key and verification key; checking an arbitrary proof with a self-supplied issuer key is not an authenticity check. Public credential lookup exposes status and transaction metadata, not the booking/student ID or the complete proof bytes.

## API and UI

- `GET /proof/student-lessons/me` returns proof/eligibility states for the authenticated student.
- `POST /proof/student-lessons/:bookingId/claim` checks booking ownership and eligibility, generates and locally verifies a proof, and submits to zkVerify if enabled with a seed configured. Repeated claims of submitted/verified credentials return their current stored status.
- `GET /proof/student-lessons/public/:commitment` returns public metadata without authentication. A `verified` status means the zkVerify transaction finalized according to the SDK; it is not a separate on-chain verifier integration.
- The student schedule offers Claim proof on eligible past lessons, Retry proof after failure, and a public status link. Ticket-based booking and refunds are unchanged.

## Deployment

Set `STUDENT_LESSON_ISSUER_SECRET` to a long random secret in the server environment. This is required when `NODE_ENV=production`; do not reuse the zkVerify wallet seed. Back it up securely: losing or rotating it changes the issuer key and deterministic commitments. `ZKVERIFY_SEED_PHRASE`, `ZKVERIFY_ENABLED` and `ZKVERIFY_DOMAIN_ID` control Volta submission. With no wallet seed or `ZKVERIFY_ENABLED=false`, the result remains `local_proof_generated` and can be submitted via Claim later. The wallet needs Volta funds for fees; each transaction costs funds.

`circuits/student-lesson/build` stores the wasm, ptau, zkey, and verification key. `zk-artifacts/student-lesson` contains per-booking private inputs, witnesses, proofs and public signals. Both paths are ignored by git; Docker Compose mounts named persistent volumes. Restrict access and back up the zkey and verification key together. Startup auto-generates a local single-contributor Powers of Tau and a fresh phase-2 key on a missing build volume. This is suitable for development, **not** a production multi-party trusted setup. Before production or independent third-party verification, perform an audited multi-party setup, distribute/pin the resulting verification key and issuer public key, and provision immutable artifacts rather than letting a fresh deployment generate keys. Cross-instance locking and chain reconciliation after a timed-out submission are not implemented; run one proof worker and inspect ambiguous transactions before retrying to avoid paying twice.

## Local verification

From `fluentxverse-server`, compile:

```sh
mkdir -p circuits/student-lesson/build
circom circuits/student-lesson/lesson_attendance.circom --r1cs --wasm -o circuits/student-lesson/build -l ../node_modules/circomlib/circuits
bun circuits/student-lesson/test-proof.ts
```

The test generates a valid witness and rejects both an absent-attendance witness and a forged signature. After generating the zkey and verification key (for example via a configured, eligible local claim), `bun circuits/student-lesson/test-proof.ts --prove` additionally proves and verifies with Groth16. This fixture does not use a real booking or submit a transaction.

For an API integration test, start a separate empty Memgraph instance and run `TEST_MEMGRAPH_URI=bolt://127.0.0.1:<test-port> bun tests/studentLessonProof.integration.ts`. The test refuses to run on a populated database, creates disposable booking fixtures, disables chain submission, and checks the claim API, eligibility, authorization, tutor attendance ownership, and public credential lookup. Shut down the disposable database afterward. This does not replace a real booking/Volta smoke test.
