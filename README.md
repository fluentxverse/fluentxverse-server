# FluentXVerse Server

The active Bun/Elysia application API for FluentXVerse's student, tutor, and administrator applications. It owns marketplace authorization, tutoring operations, screening evidence, and supporting media workflows.

## Responsibilities

- Student social-auth session exchange and tutor/admin authentication.
- Tutor profiles, applications, assessment records, and interview decisions.
- Availability, booking reservations, cancellation/refund coordination, attendance, and lesson workflows.
- Tutor USD rate configuration and compensation records derived from eligible completed lessons.
- Cloudflare RealtimeKit room authorization, recording controls, encrypted local recording storage, and administrator playback access logs.
- Application-side privacy policies and evidence preparation for integrations with GMR Engine.

## Architecture and Data Ownership

| Component | Responsibility |
| --- | --- |
| Bun, Elysia, TypeScript | HTTP API and background application jobs |
| Socket.IO | Realtime application events and signaling |
| Memgraph | Primary business graph, including compensation/earnings records |
| PostgreSQL | Logs and supporting operational/session/recording metadata |
| SeaweedFS | Application media and encrypted archived recordings |
| GMR Engine / GMR Vault | Managed wallets, private-key custody/signing, chain transactions, and verification-network credentials |

GMR Engine is a separate service, not included in this export. Web3 signing and settlement belong there, not in the FluentXVerse application backend or browser. The cache implementation and all infrastructure configuration require operational review; a Redis service declaration alone does not establish durable session revocation.

Source is in `fluentxverse-server/`. `contracts/` and `zk/review-tally/` retain supporting contract/proof source used by optional workflows. Generated setup/proving files are intentionally excluded.

## Local Development

Use Bun, Node.js 22+, and TypeScript-compatible tooling. From the repository root:

```bash
npm run setup
cp fluentxverse-server/.env.example fluentxverse-server/.env
npm run typecheck
```

Configure isolated Memgraph, PostgreSQL, storage, and the required secrets before starting. Set development-only origins and API public URLs explicitly. The production-style start command is:

```bash
npm start
```

The supplied app `dev` script disables Node TLS certificate validation for historical local development. Do not use it for production or trust-boundary testing. For a development watch process without that override:

```bash
cd fluentxverse-server
bun --watch src/index.ts
```

API/socket defaults are 8765/8767. `npm run typecheck` is a source check, not a live service test. The app's integration tests need their isolated fixtures; some scripts reference sibling applications and require the monorepo. The aggregate Compose file also references sibling frontends, so use the monorepo for full-stack Compose orchestration rather than assuming this export boots the entire platform.

## Privacy and Deployment Status

Keep student identities, exact assessment results, recordings, and private rates off public chains. Proofs establish constrained statements about authorized records, not the truth of teaching activity or model accuracy. Screening activation, proving-artifact review, issuer trust, revocation, and settlement gates remain necessary. Local development trusted setups are not production ceremonies. Ordinary payments expose their public amount and recipient; shielded settlement must not be claimed before it exists and is reviewed.

Do not enable proof or financial mutation jobs simply to make a demo appear live. Use environment examples only as configuration inventories, not production-ready presets. Provision reviewed artifacts and secrets outside Git, keep databases private, verify backups/restore, and run lesson/recording acceptance checks before rollout. This export has no deployment workflow and does not change the active API.

## Repository Provenance

This repository is an app-focused export of [the FluentXVerse monorepo](https://github.com/fluentxverse/fluentxverse-monorepo). The monorepo remains the source of truth; submit cross-application changes there. Existing directory names are retained so shared imports remain valid. The historical student/tutor folder suffix does not indicate a Preact app: both active web clients use SolidJS.

Exported source commit: [`0b10bf263db4`](https://github.com/fluentxverse/fluentxverse-monorepo/tree/0b10bf263db4d9bb599a15f17b41d6911f30b91e). See [SOURCE.json](SOURCE.json) for the exact scope. Local uncommitted edits, environment files, runtime data, curriculum backups, and generated proving artifacts are not published. Original Git history is not copied.

Cross-app parity tests and full deployment orchestration remain in the monorepo. The checks in this repository do not establish production acceptance, security audit completion, or proof-system review. No production deployment is triggered by this export.

## Security and Licensing

Never commit API tokens, seed phrases, private keys, student records, recordings, or real assessment evidence. Use synthetic fixtures in tests. Report security issues privately to support@fluentxverse.com rather than opening an issue containing sensitive data.

 third-party dependencies retain their own licenses.
