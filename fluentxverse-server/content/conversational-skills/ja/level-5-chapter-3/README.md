# Level 5, Chapter 3: The Missing Proposal

Eight text-only episodes adapted from the supplied corporate-mystery outline.
The story stays at Eastbridge Creative in Tokyo with Mika, Ethan, Soo-jin and
Daichi, joined by information security specialist Ms. Sato and Director Kuroda.
No unprovided Chapter 2 events or future resolution are invented.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | The Client's Complaint | Speaking | Acknowledge a concern and ask what needs checking |
| 2 | An Internal Investigation | Listening | Understand file-handling instructions and a meeting message |
| 3 | Under Suspicion | Reading | Explain actions using a meeting record and fresh email check note |
| 4 | The Rumor Mill | Speaking | Express a worry and respond calmly to a rumor |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1-4 |
| 6 | The Same Old Numbers | Speaking | Compare the old error and ask about dates |
| 7 | A Difficult Accusation | Speaking | Clarify a question without blaming a coworker |
| 8 | The Emergency Meeting | Reading | Explain a two-part response plan and fresh task assignments |
| 9 | The Hidden Connection | Speaking | Ask about the sharing link and raise a concern with Kuroda |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6-9 |

## Language and Layout

The course owner's **TOEIC 225-545 authoring target** overrides the reference's
B2-C1 label. This is neither a CEFR conversion nor a test-score guarantee.
Short complete sentences, common workplace phrases, Japanese support and five
Useful Language frames keep the story accessible. Introductions are 40-52 words;
the ten-turn speaking models are 69-79 words. Both private listening scripts
are under 70 words. Reading passages are under 145 words.

Each lesson has six vocabulary items, Part II discussion, basic pronunciation,
two tips, six keyed Step A items and four keyed Step B items. The shared builder
keeps the same guide sequence and fixed Range/Accuracy/Fluency rubric. Actual
mistakes and tutor notes remain available to the checkpoint system. Speaking is
a tutor-first dialogue with direct named roles, not a required monologue.
There is no romance, generated artwork or alternate-character disclaimer.

## Evidence and Continuity

Similar old figures and the same calculation error are clues, not proof of who
shared the proposal. Opening a file does not prove outside sharing. The
reference's corrected internal email is explained in the interview and fresh
email check note; it is not treated as the source of the leak. No Chapter 2
email incident is asserted in the chapter-opening recap.

The new proposal and client reply do not replace the investigation. The hotel
may pause contract talks; neither a final pause nor a retained contract is
announced. Fresh Friday tasks assign numbers to Daichi, design to Soo-jin and
the reply to Mika/Ethan, with manager review at three before client sending.

The final external link used an account with extra access shortly after a senior
management review. Its user is unknown. Kuroda's warning creates the cliffhanger,
not a confession or evidence of guilt. The chapter does not invent a culprit,
a final investigation result, a successful reporting route or a future outcome.

## Persistence and Verification

```sh
bun scripts/apply-exploring-kyoto.ts --level=5 --chapter=3
```

Review `output/the-missing-proposal/lesson-*.json`, then supply the exact fresh
snapshot digest with `--write --expected=...`. Persistence uses Memgraph, a
transactional concurrency guard, a private backup and full-record read-back.
The eight new records are drafts. Slots 5/10 are not static records; existing
checkpoints, notes, marks, earlier chapters and fixed feedback are not rewritten.

Content and regression coverage is in `tests/missingProposal.test.ts`.
The fixture-backed browser harness blocks API writes:

```sh
bun test ./fluentxverse-server/tests/missingProposal.test.ts
node scripts/tests/new-paths.cjs --level=5 --chapter=3
```

Ten chapter tests and all 33 browser cases passed across dashboard, tutor and
student views, desktop/mobile and light/dark themes. Screenshots are in
`output/the-missing-proposal/screenshots/`. A content save is not publication,
application deployment or a Git push.
