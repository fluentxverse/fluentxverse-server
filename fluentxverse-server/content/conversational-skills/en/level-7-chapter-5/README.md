# Level 7, Chapter 5: One Last Encore

The final eight directly authored lessons of Beyond the Spotlight, based on the
owner's Chapter 5 outline. **TOEIC 550–780** remains the Level 7 authoring range,
overriding the reference's C1–C2 subtitle. English only, no new artwork, no
romantic subplot and no external model APIs or application AI-credit use.

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | The Biggest Stage Yet | Speaking | Clarify responsibilities and preparation |
| 2 | The Setlist Debate | Listening | Explain an accepted creative compromise |
| 3 | A Message from the Past | Reading | Recall support and express specific gratitude |
| 4 | Behind the Final Rehearsal | Speaking | Confirm shared instructions and correct a mismatch |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | The Night Before | Speaking | Express mixed feelings and professional values |
| 7 | When the Lights Go Out | Speaking | Compare immediate options and confirm an approved alternative |
| 8 | One Last Encore | Reading | Explain performance sequence and offer brief thanks |
| 9 | Beyond the Spotlight | Speaking | Reflect on shared growth and welcome a newcomer |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Current Pointers

- English only and four Step A expressions, with English meanings and italic
  contextual examples highlighting the expression. No vocabulary cards.
- Objective first, then situation. Plain Apply situations, separate structured
  questions, direct character roles and natural tutor-first openings.
- Short speaking models with ten alternating turns. The festival material uses
  conversational remarks, not a required speech or extended monologue.
- **Only Step B has pronunciation.** No Learn Part III. Part II transitions
  directly to Step B. Two relevant phrases teach linking or meaning groups,
  with full examples and exact bold stress. No IPA, reading-cue or accent
  commentary in lesson content.
- Two short listening messages remain tutor-only. Reading missions have fresh
  visible notes. Six/four keyed exercises, Useful Language, optional topics,
  standard guides and fixed English feedback remain. Learner notes and actual
  mistakes remain the evidence for dynamic checkpoints.

Introductions fit the 90-word limit; all speaking models are below 180 words,
both listening messages below 110, and all reading sources/notes below 220.
Goals are at most 14 words. Narration and models use manageable sentences.

## Continuity and the Ending

Six weeks before the fictional festival, a main-stage appearance is confirmed.
Large live and online audiences are expected without exact counts or a named
streaming platform. The festival has a video team; Luis coordinates with it.

Chapter 4 only established consideration of Quiet Streets. Here, the team
negotiates actual inclusion as an emotional turning point followed by Kai's
most energetic song. That following song is not named. Do not identify it as
Paper Skyline automatically or anticipate the later technical change.

Mr. Ishikawa is an early venue's owner. The first audience is corrected from
twelve to **thirteen including him**, not fourteen. He requests no repayment;
he asks Kai to give someone a similar chance someday. The visit does not yet
establish a new artist meeting or completed mentoring programme.

At the final rehearsal, an old cue sheet produces bright red lighting instead
of soft blue. Updating the documents produces a successful repeat. That event
is separate from the actual festival's playback fault. Maya still asks for
contingency planning without predicting the specific later failure.

The night-before call puts the festival in perspective. Kai's early lyric page
records his wish to be heard. One performance could open doors without deciding
his whole future. No medical diagnosis, prescribed sleep strategy or guaranteed
audience result is supplied.

At the festival, **one audio playback system** has a fault. The title does not
establish a blackout. The programme is behind and repair takes time. The musical
director confirms the necessary microphones and instruments work, the festival
manager approves the acoustic Quiet Streets opening, and Maya checks Kai's
comfort. He walks onstage as the lights dim normally.

The audience listens quietly, then applauds. The technical team restores
playback before Kai continues the planned performance, ending with Paper
Skyline. A manager signal permits a short encore: a **brief acoustic reprise
of Paper Skyline**, with audience participation. No new encore title, complete
middle setlist, exact extra time or unapproved extension is invented.

Several months later, both new singles reach larger audiences than expected.
The outline does not name them or give sales, chart ranks or a guarantee of
future success. The Apex relationship respects creative involvement, while
Spotlight Works remains independent and expands artist development to a few
musicians. Maya receives an opportunity to lead creative production; acceptance
or a completed promotion is not confirmed.

An unnamed woman with years of songwriting arrives for an artist development
meeting. Kai recognises her doubts and encourages pride in creative work,
passing support forward. She enters the recording room and begins to play.
No age, signed deal or promised fame is added. The story ends here, with
gratitude and a continuing creative purpose, rather than a new crisis or sequel
cliffhanger. Kai's career is not described as ending or becoming perfect.

## Verification and Persistence

```sh
bun scripts/apply-exploring-kyoto.ts --level=7 --chapter=5
bun test ./fluentxverse-server/tests/encore.test.ts ./fluentxverse-server/tests/fame.test.ts ./fluentxverse-server/tests/contract.test.ts ./fluentxverse-server/tests/algorithm.test.ts ./fluentxverse-server/tests/spotlight.test.ts ./fluentxverse-server/tests/naturalPronunciation.test.ts ./fluentxverse-server/tests/checkpointLesson.test.ts ./fluentxverse-server/tests/conversationalCurriculum.test.ts
node scripts/tests/new-paths.cjs --level=7 --chapter=5
```

Review `output/one-last-encore/lesson-*.json` before supplying the fresh snapshot
digest with `--write --expected=...`. The existing Memgraph writer uses a private
backup, concurrency protection and full-record read-back. Existing identities,
artwork, publication states, fixed English feedback and learner properties are
preserved. Checkpoints 5/10 stay dynamic; saved reviews, notes and marks are not
regenerated. Draft saving is separate from publication, server-policy deployment
and Git push.

Saved and verified November 15, 2026: eight new drafts and chapter metadata,
private backup and full-record read-back. All 69 targeted tests and 33 renderer
cases passed; final tutor-role wording was rechecked in three views. Inspected
representative desktop/mobile screenshots. Full server typecheck retains the
existing 159 diagnostics elsewhere, with none in this chapter or its tests.
Nothing published, deployed or pushed. Beyond the Spotlight's story is complete.
