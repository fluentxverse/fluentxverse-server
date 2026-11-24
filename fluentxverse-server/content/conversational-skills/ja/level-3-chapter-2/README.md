# Level 3, Chapter 2: Exploring Kyoto

Current language target: **Level 3, TOEIC 10-220** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

User-supplied story reference: **Exploring Kyoto, 8 ESL Lessons, A2-B1 Level**.
This chapter continues Emma, Claire, Leo, and Nao's life at Kamo House after
Chapter 1. Emma and Leo's relationship develops through everyday travel situations.
Role assignments are direct: "You are Emma. Your tutor is Leo."

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | A Weekend Adventure | Speaking | Make suggestions and agree on a day-trip plan |
| 2 | The Wrong Train | Listening | Check tickets, platforms, and corrected station information |
| 3 | Lost in Gion | Reading | Read directions, landmarks, and a meeting message |
| 4 | A Taste of Kyoto | Speaking | Ask prices, order quantities, and check payment |
| 5 | Personalized Checkpoint | Review | Generated separately from Lessons 1-4 and student evidence |
| 6 | The Bamboo Forest | Speaking | Describe a place and request a photograph |
| 7 | Rain at Kiyomizu-dera | Speaking | Explain a weather problem and change plans |
| 8 | A Special Souvenir | Reading | Compare product cards and read gift-order conditions |
| 9 | An Evening by the River | Speaking | Invite, respond, and confirm future plans |
| 10 | Personalized Checkpoint | Review | Generated separately from Lessons 6-9 and student evidence |

The reference's episodes 5-8 map to lesson slots 6-9. Do not create static
lessons in slots 5 or 10; the existing checkpoint agent uses published source
groups and actual student evidence, with balanced review when evidence is sparse.
The eight authored materials are drafts in Memgraph, not PostgreSQL.

## Lesson Standard

- Six vocabulary items, Part II discussion, and Part III basic pronunciation.
- Two concise grammar/reading tips with Japanese examples.
- Ten alternating Apply lines for speaking; short tutor-only transcripts for listening.
- Reading passages distinct from Challenge 1, kept visible during the roleplay.
- Six Step A choices and four Step B questions with structured answer keys and marking guidance.
- Standard numbered tutor guides, tutor-first roleplays, useful language, and three optional discussion topics.
- The existing fixed range/accuracy/fluency rubric and six-step feedback guide.
- Use separately approved Chapter 2 artwork, not inherited Chapter 1 scene assets.

Places provide narrative context, not live navigation advice. Practice routes,
shop names, fares/prices, opening times, payment rules and product conditions
are fictional and labeled as such. No live platform numbers or train timetable
claims are made. Keep roleplay instructions concise and tied to the story.

## Authoring and Persistence

`build.ts` is the canonical chapter source and uses the established Chapter 1
schema/guide builder with a chapter-specific configuration. Existing Chapter 1
content and artwork are not modified.

From the repository root, run `bun scripts/apply-exploring-kyoto.ts` for a dry run.
Review the generated candidates under `output/exploring-kyoto/`. The explicit
write requires the dry run's `--expected` snapshot digest. The updater backs up
the chapter, metadata, and guide reference, rejects concurrent changes and
non-draft replacements, writes in one transaction, and verifies full records.
It sets the chapter metadata to Exploring Kyoto and leaves student notes,
marks, Chapter 1 lessons, and existing checkpoint materials untouched.

Tests: `tests/exploringKyoto.test.ts` and `scripts/tests/exploring-kyoto.cjs`.

## Approved Artwork

Lesson 1, **A Weekend Adventure**, uses three approved watercolor scenes:
the four friends planning at the cafe, Claire and Emma discussing the outing,
and Emma and Leo confirming the plan. Challenge 1 uses the final `v2` correction
of Emma's pointing hand. All three scenes remain at the Friday planning stage,
not at the shrine. PNG masters and optimized WebP copies are in `images/`.

Run `bun scripts/apply-shared-hobby-watercolor.ts --chapter=2 --lesson=1`
as a dry run, then add `--write --expected=<reviewed revision>` for the guarded
image-only update. It checks the live story, backs up the lesson, verifies public
asset hashes, rejects concurrent edits and compares the full saved record.
Chapter 1 artwork, lesson text, guides, publication state and learner records
are not rewritten. `chapter2Watercolor()` supplies chapter-specific defaults
while preserving saved artwork for all eight story lessons (1-4 and 6-9).

Lesson 2, **The Wrong Train**, also uses its nine approved images: three
watercolor scenes (Introduce, Apply, Challenge 1) and six realistic vocabulary
photos (ticket, platform, right train, destination, change trains, get off).
PNG masters and optimized WebP copies are retained in `images/`. The same
guarded image updaters accept `--chapter=2 --lesson=2`; the artwork defaults
preserve saved Lesson 2 images as well. Only image references and timestamps
were saved to Memgraph; lesson content, draft status and learner data remain
unchanged. Station art is illustrative, not real navigation guidance.

Lesson 3, **Lost in Gion**, uses nine approved images: three watercolor scenes
and six realistic vocabulary photos (go straight, turn left, turn right at,
walk past, opposite, beside). The guarded updaters accept `--chapter=2 --lesson=3`.
Its Challenge 1 artwork also appears in a reading-passage image block, without
altering the written meeting message. Canonical defaults preserve saved images
and avoid duplicate reading blocks. PNG/WebP assets are in `images/`; lesson
text, tutor guides, feedback, draft status and learner records are unchanged.

Lesson 4, **A Taste of Kyoto**, uses three approved watercolor scenes and six
realistic vocabulary photos (How much, each, inside, would like, pay by card,
bag). PNG masters and optimized WebP copies are retained in `images/`. The
guarded updaters accept `--chapter=2 --lesson=4`, and artwork defaults preserve
saved market scenes and vocabulary images. Apply remains a cash-only practice
stall; Challenge 1 is a separate card-accepting practice stall. Only image
references and timestamps changed in Memgraph; all lesson text, guides,
feedback, draft status and learner data remain unchanged.

Lesson 6, **The Bamboo Forest**, uses three approved watercolor scenes and six
realistic vocabulary photos (tall, path, light, take a photo, include, see).
The guarded updaters accept `--chapter=2 --lesson=6`. PNG masters and optimized
WebP copies are retained in `images/`, and approved defaults preserve saved
artwork and vocabulary photos. The three-character photo outing stays on the
path; camera framing and reviewing photos remain distinct. Only artwork
references and timestamps changed in Memgraph; lesson content, guides,
feedback, publication state and learner records were preserved. Lesson 5
remains the personalized checkpoint, not a new static story lesson.

Lesson 7, **Rain at Kiyomizu-dera**, uses three approved watercolor scenes and
six realistic vocabulary photos (raining, forgot, share, inside, waiting,
later). The story scenes and share photo use the final v3 normal-sized blue
umbrella revisions; earlier review variants are not installed. The guarded
updaters accept `--chapter=2 --lesson=7`. PNG masters and optimized WebP assets
are retained in `images/`. Only image references and timestamps changed in
Memgraph; lesson text, tutor guides, draft status and learner records remain
unchanged. Defaults preserve any previously saved artwork.

Lesson 8, **A Special Souvenir**, uses three approved watercolor scenes and six
realistic vocabulary photos (costs, included, extra, hand wash, receipt, collect).
The costs photo uses its v2 correction matching Emma's established appearance.
The guarded updaters accept `--chapter=2 --lesson=8`. Its reading Challenge 1
includes one image block without changing the gift-order passage. Saved artwork,
vocabulary photos, fixed feedback and publication state are preserved by the
defaults. PNG/WebP assets are retained in `images/`; only image references and
timestamps changed in Memgraph, with learner records and checkpoints untouched.

Lesson 9, **An Evening by the River**, uses three approved watercolor scenes
and six realistic vocabulary photos (Would you like, would love to, free,
meet, How about, sounds good). Introduce uses v2, with Claire and Nao walking
ahead of Emma and Leo; Apply and Challenge 1 use v1. The guarded updaters
accept `--chapter=2 --lesson=9`, and defaults preserve saved artwork and
vocabulary photos. PNG/WebP assets are in `images/`. Only image references
and timestamps changed in Memgraph; text, guides, publication state, notes,
exercise marks and checkpoints remain unchanged. All eight Chapter 2 story
lessons now have nine approved images each; Lesson 10 stays personalized.

Six approved realistic Step A vocabulary photos are installed: explore, day
trip, go first, free on Saturday, meet at, and sounds perfect. PNG masters and
optimized WebP copies are retained in `images/`. Their mapping is in
`output/weekend-adventure-watercolor/vocabulary-previews.json`. These illustrate
the phrases and proposed activities without moving the story forward. Small
physical planner/station labels clarify availability and the meeting place;
the images are not a verified navigation guide or timetable.

Run `bun scripts/apply-lesson3-vocabulary-photos.ts --chapter=2 --lesson=1`
for a dry run, then add `--write --expected=<reviewed revision>` for the guarded
image-only save. Chapter-specific assets and phrase matching prevent Chapter 1
collisions. Only the six vocabulary image fields and timestamp are updated in
Memgraph, with a private backup, public hash checks and full-record read-back.
Text, tutor guides, watercolor scenes, draft status and learner data are preserved.
