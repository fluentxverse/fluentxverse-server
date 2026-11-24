# Level 4, Chapter 2: New Paths, Unexpected Feelings

Current language target: **Level 4, TOEIC 225-545** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

Adapted from the user's eight-episode reference. Continue Level 4 Chapter 1 after a few
weeks, preserving the breakup and the unaccepted Bristol opportunity. Do not
reintroduce the previously removed physical-intimacy incident.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | An Offer from Home | Speaking | Compare options without prematurely accepting |
| 2 | A Walk with Nao | Listening | Understand a short invitation and camera advice |
| 3 | Emma's Fresh Start | Reading | Separate achievements, revision requests and approval |
| 4 | Claire's Brilliant Idea | Speaking | Propose a market and share jobs |
| 5 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 1-4 |
| 6 | The Great Pastry Disaster | Speaking | Explain a mistake and sequence a new attempt |
| 7 | Something More Than Friendship | Speaking | Express appreciation and confirm coffee |
| 8 | A Decision About Bristol | Reading | Distinguish an offer, deadlines and final plans |
| 9 | A Brighter Tomorrow | Speaking | Celebrate the market and confirm a dinner date |
| 10 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 6-9 |

## Continuity and Teaching Standards

Leo considers Bristol, enjoys a photo walk with Nao, and eventually chooses Kyoto
for his own skills, community and long-term ambition. His own bakery is a hope,
not a rented shop or confirmed opening. The approved market runs Saturday 10-1;
pastry testing and the Bristol decision precede it. Tuesday coffee has been
accepted. Friday's offer-reply deadline is separate from tray collection after
five; trays return Monday before noon. Next Wednesday's seasonal-recipe meeting
does not grant permission for a new shop.

Emma's Osaka work progresses; Ren's feedback stays professional. The reading
challenge adds a new address/photo revision and a Friday 2 p.m. deadline after
the Apply passage's earlier Thursday version. Client approval still precedes
printing. Emma is not made to attend the planning meeting or market. She sends
congratulations and completed-design photos remotely.

Leo and Nao's developing romance is conveyed through appreciation and clear
invitations, not physical intimacy. The final dinner date is accepted, with the
restaurant to be confirmed. A second market is suggested but not booked.
The next story is Level 4 Chapter 3; Chapters 4-5 await the user's outlines.
This was originally supplied as the Chapter 7 outline.

Keep short, scaffolded B1-B2 text within the established material format:
six bilingual vocabulary items, Part II discussion, basic Part III pronunciation,
two tips, keyed six-item Step A and four-item Step B exercises, actual-error
marking/notes, standard tutor guides, and fixed range/accuracy/fluency feedback.
Direct character roles and tutor-first dialogue; no compulsory monologues or
alternate-character/personal-disclosure boilerplate. Listening scripts remain
tutor-only. Reading missions supply fresh visible evidence. No images generated.

## Guarded Memgraph Save

```sh
bun scripts/apply-exploring-kyoto.ts --level=4 --chapter=2
```

Review `output/new-paths/lesson-*.json`, then use `--write --expected=...` with the
exact snapshot digest. The updater backs up existing records, rejects non-draft
replacements, guards concurrent changes, writes eight drafts and chapter metadata
transactionally, and verifies complete record read-back. Earlier chapters,
checkpoint records and student mistakes/notes are not changed. Lesson content is
saved in Memgraph, not Postgres.

Level 3 and Level 4 each have five chapters. Existing migrated draft IDs are kept
stable; new records use Level 4 IDs. Content saves do not deploy application code.

## Verification

`tests/newPaths.test.ts` covers the eight episodes, guide structure, Japanese
support, direct roles, short dialogues/private listening, exercise keys, fresh
reading evidence, continuity, checkpoint slots and unchanged prior content.
The related Chapter 1-7/validation/checkpoint suite passes 80 tests.
`scripts/tests/new-paths.cjs` checks 33 fixture-backed cases in the deployed
dashboard, tutor and student renderers, across desktop/mobile and both themes.
It blocks all API writes; screenshots are in `output/new-paths/screenshots/`.

An extended strict TypeScript check including this content builder reports zero
Level 4 Chapter 2 diagnostics. It still reports eight pre-existing diagnostics in Chapter
1's `exhibition-arc.ts`, `lesson-6-listening.ts`, `lesson-7-reading.ts` and
`new-beginning.ts`; the broader content type check is not fully clean.
