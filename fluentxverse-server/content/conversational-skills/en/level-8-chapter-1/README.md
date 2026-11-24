# Level 8, Chapter 1: Behind the Smiles

Eight directly authored lessons introducing The Things We Don’t Say in Aokawa,
a fictional Tokyo neighbourhood. The owner specifies **TOEIC 785–940** as both
the Level 8 authoring range and visible lesson badge. That replaces the source's
C1–C2 subtitle and the old computed INTERMEDIATE badge for this course/level.
No external model APIs, application AI credits, new artwork or romance used.

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | Everyone Has a Story | Speaking | Explain purpose and voluntary participation |
| 2 | The Perfect Life | Listening | Preserve qualifications in a curated-image account |
| 3 | Alone in a Crowded City | Reading | Interpret a barrier without assuming an outcome |
| 4 | Too Busy to Live | Speaking | Distinguish perceived pressure from explicit policy |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | The Unspoken Diagnosis | Speaking | Respect confidentiality and separate permissions |
| 7 | Living for Someone Else | Speaking | Discuss autonomy and competing responsibilities |
| 8 | A Life Without Children | Reading | Represent a choice without inventing a motive |
| 9 | The First Real Conversation | Speaking | Consider criticism and respond to a private approach |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Owner Pointers and Language

- English only, four Step A expressions, clear English meanings and italic
  contextual examples highlighting the expression. No vocabulary cards.
- Objective first, then situation. Plain Apply situations and separate questions.
  Direct roles, natural tutor-first openings and ten short alternating model turns.
- **Only Step B has pronunciation.** No Part III. Part II leads directly to
  Step B. Two phrases practise linking or meaning groups through complete
  examples and exact bold stress. No IPA, reading-cue or accent commentary.
- Two distinct tutor-only listening messages and fresh visible reading mission
  notes. Six/four keyed exercises, Useful Language, standard guides and fixed
  English feedback. Notes and actual errors support dynamic checkpoints.
- Qualified claims, implications and competing perspectives suit the new range.
  Introductions are 60–67 words, models 145–179, listening 97/81 and reading
  111–131. All fit the new Level 8 budgets. No test-score guarantee is implied.

## Evidence and Publication Boundaries

The new cast is independent of Level 7. Emi has ten years in journalism; Riku
organises community activities, Leila produces and Daisuke owns the café. Hana's
profession and the friends' unprovided nationalities are not invented. Coffee
is modest, humorous support rather than a major sponsorship contract.

Ayaka's possible fifty-photo selection is an example, not a rule for every post
or evidence of fabrication. Comparison predates social media in her account.
Mr. Nakahara has lived in Aokawa almost forty years, not been retired that long.
His interest in the gathering does not establish attendance or resolved loneliness.

Tomoko's official day is eight hours; her longer actual total is unspecified.
Recognition for late work is perceived, with no explicit manager order reported.
She enjoys her career while questioning its demands. Daisuke's fourteen-hour
café day is a separate ironic observation, not Tomoko's measured workday.

The source's Ms. Ono is presented as **the guest** in learner-facing material.
Her name and workplace remain confidential. A past depression diagnosis and
improvement after professional help are her reports, not medical advice or a
universal outcome. She describes fear and dismissive comments, not direct
discrimination. Hana joins with permission; no medical qualification is supplied.
Recording, Hana's presence and publication are separate choices. The guest asks
for time, then declines publication in the final episode. Her interview is excluded.

Shun, twenty-six, wants teaching instead of the family hardware store. Repeated
family discussions have not resolved the tension with his parents' retirement
plans. No financial solution, job offer or final career choice is invented.
Sayuri, thirty-eight, chooses not to parent while enjoying nieces and nephews.
Relatives' predictions are not future facts. No medical, partner or hidden motive
is added, and Daisuke's generational perspective is attributed to him.

Friday's launch is at 7 p.m. Selected Ayaka and Shun conversations have permission;
that does not establish permission for every other interview. Feedback is mixed,
including a fair financial-freedom criticism. The anonymous email offers neither
a known identity nor public permission. Emi plans to clarify that disclosure can
stay private and listen if the sender wishes; no reply or new publication has
already occurred. The chapter ends open for the next conversation.

Sensitive topics stay inside assigned fictional roles. Learners are not required
to disclose personal diagnoses, family conflict or reproductive choices.

## Verification and Persistence

```sh
bun scripts/apply-exploring-kyoto.ts --level=8 --chapter=1
bun test ./fluentxverse-server/tests/smiles.test.ts ./fluentxverse-server/tests/encore.test.ts ./fluentxverse-server/tests/fame.test.ts ./fluentxverse-server/tests/contract.test.ts ./fluentxverse-server/tests/algorithm.test.ts ./fluentxverse-server/tests/spotlight.test.ts ./fluentxverse-server/tests/naturalPronunciation.test.ts ./fluentxverse-server/tests/checkpointLesson.test.ts ./fluentxverse-server/tests/conversationalCurriculum.test.ts
node scripts/tests/new-paths.cjs --level=8 --chapter=1
```

All 81 targeted tests and 33 renderer cases passed. Inspected representative
desktop/mobile screenshots, including the score badge and pronunciation stress.
The dashboard build passed; full server typecheck retains 159 existing diagnostics,
with none in the new chapter or changed badge/policy code.

Saved and verified November 15, 2026: eight drafts, chapter metadata, level topic,
private backup and full-record read-back through the guarded Memgraph writer.
Existing identities, artwork, states, fixed English feedback and learner data
are preserved. Checkpoints 5/10 remain dynamic; saved reviews are not regenerated.
No lesson publication or Git push. Local Level 8 language/checkpoint policy is
separate from the narrowly scoped runtime score-badge update.

The server badge-only overlay was prepared against the running image and tested
with all level/course combinations. It was applied after configuration/source
guards and a zero-active-connection check; container health and the computed
Level 8 score badge passed verification. Other courses' badge mapping stays
unchanged. The dashboard selector change and future-checkpoint policy remain
local; they were not included in this narrow server release.
