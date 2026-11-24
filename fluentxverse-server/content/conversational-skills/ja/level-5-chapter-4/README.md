# Level 5, Chapter 4: Difficult Choices

Eight text-only episodes adapted from the supplied corporate-mystery outline.
The chapter continues directly from Chapter 3’s account/link clue and Kuroda’s
warning. It keeps the Eastbridge Creative cast and unresolved investigation.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | A Warning from Above | Speaking | Report an instruction and ask for careful advice |
| 2 | Numbers Don’t Lie | Listening | Understand changed forecasts and missing support |
| 3 | The Pressure to Deliver | Reading | Explain the deadline and conditions for accurate work |
| 4 | A Conversation Behind Closed Doors | Speaking | Discuss a concern and suggest factual records |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | An Unexpected Request | Speaking | Clarify conflicting instructions and request written confirmation |
| 7 | The Missing Approval | Speaking | Report a missing review record and uncertainty |
| 8 | Divided Loyalties | Reading | Explain reporting responsibilities during a disagreement |
| 9 | The Evidence Nobody Expected | Speaking | Report the account/email/company clues without deciding guilt |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Owner Pointers

Follow [AUTHORING_CORRECTIONS.md](../AUTHORING_CORRECTIONS.md) and the shared
TOEIC 225–545 authoring policy. The reference’s B2–C1 label does not set the
language difficulty. The lesson objective precedes the situation; situation
fields are plain English with separate Japanese support and structured
comprehension questions. Speaking uses direct named roles and natural,
tutor-first conversations. No required monologues, role disclaimers or romance.

Introductions are 46–53 words and ten-turn speaking models are 73–83 words.
Both tutor-only listening scripts are below 60 words. Reading sources and
fresh challenge notes are below 100 words. Six vocabulary items, basic /f/–/v/
pronunciation, two tips, six/four keyed exercises, five Useful Language frames,
standard tutor guides and the fixed feedback rubric remain. Record actual
mistakes and tutor notes; do not invent weaknesses for checkpoints.

## Evidence and Continuity

The forecast increase is **almost** twenty percent. Forecasts describe future
estimates, not earned money. Daichi has not found supporting research; this is
not proof that none exists. Kuroda’s approval does not identify the person who
changed the figures. The title “The Missing Approval” is retained from the
reference, but the content explicitly says the **review record** is missing
and the approval is present.

Soo-jin’s memory of last year is a concern, not an established previous fraud.
Kuroda gives Mika a removal request, not written confirmation of compliance.
She keeps the files unchanged. He only agrees to discuss the request with the
appropriate department. Sato requests the document without deciding the cause
of the missing record. Agreement to another financial review is not completion
of that review, and the five-working-day deadline is not given an invented date.

Ethan starts to reconsider Mika’s reporting decision; he does not fully resolve
his worries. In the final episode, the link used Kuroda’s account, but the user
is unknown. Downloads precede the old forecasts’ appearance in Northstar’s
proposal. Ethan’s envelope contains a three-week-old email instructing an
independent outside review. The consultant’s domain belongs to a company
Northstar acquired last year. Ethan says he did not know the connection.

The email documents a possible route, not verified delivery to Northstar,
Kuroda’s intent, a confession or a final decision about Ethan’s responsibility.
Possible deception, unauthorised account use and the hotel contract remain open.
No future chapter, culprit, punishment or final investigation result is invented.

## Persistence and Verification

```sh
bun scripts/apply-exploring-kyoto.ts --level=5 --chapter=4
bun test ./fluentxverse-server/tests/difficultChoices.test.ts
node scripts/tests/new-paths.cjs --level=5 --chapter=4
```

Review the generated `output/difficult-choices/lesson-*.json` files before the
guarded writer’s `--write --expected=...` step. It takes an exact snapshot,
creates a private backup, checks for concurrent edits, saves transactionally to
Memgraph and verifies every saved field. Checkpoints 5/10, student evidence,
earlier chapters and fixed feedback are not rewritten. Draft persistence is
separate from publication, application deployment and Git push.

Coverage includes eleven chapter tests and 33 dashboard/tutor/student browser
cases on desktop/mobile in light/dark themes. Generated screenshots and logs
are under `output/difficult-choices/` and are operational evidence, not source.
