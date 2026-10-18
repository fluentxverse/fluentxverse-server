# Tutor Certification Circuit

This circuit is the local Groth16 MVP for FluentXverse tutor certification.

It proves:

- written exam score is at least 90
- speaking exam score is at least 85
- profile approval flag is true
- interview pass flag is true
- the private tutor subject hash and nonce match the public credential commitment

The circuit intentionally does not submit to zkVerify. The backend local prover
generates:

- `input.json`
- `witness.wtns`
- `proof.json`
- `public.json`
- `verification_key.json`

Before public/testnet submission, replace the dependency-free arithmetic
commitment with a circuit-native hash such as Poseidon and add issuer signature
verification in-circuit.

Required local binaries:

```bash
circom --version
snarkjs --version
```

The backend endpoint `POST /proof/tutor-certification/generate-local` runs the
full local compile/setup/prove/verify pipeline for the authenticated tutor.
