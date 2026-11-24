# Level 4, Chapter 3: A Little Closer

Current language target: **Level 4, TOEIC 225-545** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

Adapted from the user's eight-episode reference, continuing the Level 4 Chapter 2
dinner invitation and preserving the Level 4 Chapter 1 breakup. This was originally
supplied as the Chapter 8 outline.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | The First Real Date | Speaking | Confirm a booking, compliment and explain nervousness |
| 2 | A Second Chance in Osaka | Listening | Understand expectations and a confirmed visit |
| 3 | A Familiar Face in Gion | Reading | Distinguish surprise, introductions and agreement |
| 4 | The Most Awkward Coffee Ever | Speaking | Small talk, follow-up questions and topic changes |
| 5 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 1-4 |
| 6 | An Honest Conversation | Speaking | Ask about feelings and give specific reassurance |
| 7 | A Surprise Invitation | Speaking | Offer help and confirm an event arrangement |
| 8 | Old Friends, New Beginnings | Reading | Interpret apologies and clear up assumptions |
| 9 | A Little Closer | Speaking | Celebrate, thank and distinguish hopes from plans |
| 10 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 6-9 |

## Continuity

The first dinner is the Saturday-after-market date accepted in Level 4 Chapter 2: six
o'clock, with Leo arriving at 5:45. The restaurant is now booked. Emma and Ren
mutually revisit their professional-only arrangement after time rebuilding trust;
dating is a new choice, not a rewrite of the breakup or a concealed work dinner.
No physical-intimacy scene is added.

The following Saturday's Gion visit is confirmed at two outside a fictional cafe
with a green awning. The surprise encounter follows, with all four agreeing to
coffee from 4:05 to 4:25. Goodwill does not imply the old couple reunites. Nao and
Leo discuss mixed feelings honestly after coffee.

The second market is invited the following week: Saturday 10-1, setup Friday 2-4,
six framed photographs, Ren possible and then confirmed. Emma's Saturday photo
talk is 11:30 by the front window. A caption saying Bristol is corrected to Kyoto.
The new reading challenge also distinguishes checking the photo order from
avoiding a friend, so emotional meaning and practical follow-through are both
assessed.

After the successful second market, Claire commits to monthly events but has not
fixed the next date. Leo and Nao's Fukuoka visit remains an idea: check days off
next week, no tickets, travel dates or move. Emma and Leo exchange peaceful good
wishes without rekindling their relationship. Level 4 Chapters 4-5 await user outlines.

## Teaching and Persistence

Short scaffolded B1-B2 text within the established material format. Direct character
roles and tutor-first dialogue, not compulsory monologues or alternate-character
and personal-information boilerplate. Six bilingual vocabulary items, discussion,
basic pronunciation, two tips, six keyed Step A and four keyed Step B exercises,
standard tutor-guide structure, and fixed range/accuracy/fluency feedback.
Existing marking and actual-mistake note handling remain in place. Listening
transcripts stay tutor-only; reading missions supply fresh visible evidence.
No images generated.

```sh
bun scripts/apply-exploring-kyoto.ts --level=4 --chapter=3
```

Review `output/a-little-closer/lesson-*.json`, then save with `--write --expected=...`
using the exact reviewed snapshot digest. Existing backup, draft-only replacement,
concurrency guard, transactional Memgraph save and full record verification are
retained. Earlier chapters, checkpoint records and student notes/marks are not
changed. No lesson content is stored in Postgres.

Content saves do not deploy application code. Both Level 3 and Level 4 have five
chapters. Existing draft IDs and historical backups are kept stable after moving;
new records use Level 4 IDs.

## Verification

`tests/littleCloser.test.ts` checks story slots, direct roles, continuity, Japanese
support, fixed guides/rubric, short dialogues/private listening, complete exercise
keys, fresh reading evidence and untouched earlier content/checkpoint slots. The
related authoring/validation/checkpoint suite passes 88 tests.

```sh
node scripts/tests/new-paths.cjs --level=4 --chapter=3
```

This checks 33 fixture-backed cases in the deployed dashboard, tutor and student
renderers across desktop/mobile and both themes. All API writes are blocked.
Screenshots are in `output/a-little-closer/screenshots/`.

Extended strict TypeScript checking reports zero Level 4 Chapter 3 diagnostics, with eight
pre-existing diagnostics in the Chapter 1 authoring helpers. The broader content
type check is therefore not fully clean.
