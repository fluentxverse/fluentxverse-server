# Level 3, Chapter 1: A New Beginning

Current language target: **Level 3, TOEIC 10-220** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

English lessons for adults, with Japanese supporting translations.
The revised lessons follow residents of fictional Kamo House in Kyoto.
Lesson 1 is published in Memgraph; Lessons 2-4 and 6-9 are
drafts for editorial review. Existing authored drafts in slots 5 and 10 remain
untouched; personalized checkpoint slots are generated separately when their
four source lessons are published. Lesson 1 retains its existing ID.

## Curriculum

| Lesson | Title | Skill / Apply / Main Mission | Language focus | Exercise A / B |
| --- | --- | --- | --- | --- |
| 1 | A New Beginning | Speaking | Introductions and relevant questions | Choose / multiple choice |
| 2 | The Sunday Cafe | Listening | Leo's background, current work, and routines | Choose / multiple choice |
| 3 | A Shared Hobby | Reading | Nao's profile and a photo-walk invitation | Choose / multiple choice |
| 4 | A Walk Through Kyoto | Speaking | Past experiences, preferences, and reasons | Choose / multiple choice |
| 5 | Personalized Checkpoint | Review | Lessons 1-4, adapted to student evidence | Dynamic practice / three challenges |
| 6 | An Interesting Idea | Speaking | Suggesting the cafe exhibition and offering help | Choose / multiple choice |
| 7 | An Unexpected Problem | Speaking | Broken bakery oven; solutions, requests, and deadlines | Choose / multiple choice |
| 8 | The Exhibition | Reading | Visitor guide, artist contributions, and afternoon program | Choose / multiple choice |
| 9 | A Place to Call Home | Speaking | Reflecting on experiences and feelings; future plans | Choose / multiple choice |
| 10 | Personalized Checkpoint | Review | Lessons 6-9, adapted to student evidence | Dynamic practice / three challenges |

Each non-checkpoint lesson has a 23-minute core: introduction 1, Learn 4, language focus 2,
Apply 4, Exercise 4, Mission 6, and Feedback 2. Challenge 2 adds up to two minutes.
All eight story lessons use optional discussion with three general free-talk categories.

Listening is **tutor-delivered**: complete scripts, delivery guidance, gist/detail
questions, and answer keys are in the tutor guide. No recorded audio was generated.
Student views do not render the tutor guides or transcripts. Reading lessons
have actual passages. Speaking lessons use short alternating dialogues and
tutor-first roleplays, not compulsory monologues. Score receptive lessons chiefly on understanding,
not on the length of a correct answer.

English is the instructional language. Japanese appears in goal, introduction,
vocabulary/expression, task-instruction, grammar-support, and feedback fields.
The existing `goalTextJp` field is used; no application-wide language switch was added.
The chapter replaces the old Level 3 Chapter 1 content; it is not a parallel course.
Future authoring and regeneration must follow the shared rules in
`../AUTHORING_CORRECTIONS.md`.

## Current Story Source

`new-beginning.ts` is the canonical user-approved story. Its eight episodes map
to Lessons 1-4 and 6-9, leaving Lesson 5 as a checkpoint. The exhibition stays
at Kamo House cafe on Sunday, 2-4 p.m. The only preparation problem is the
bakery oven; the cafe kitchen and teamwork solve it. The exhibition succeeds,
then the four friends reflect beside the Kamo River.

`buildChapter()` applies this source for future chapter generation. Older
lesson-specific modules and `exhibition-arc.ts` are historical schema templates,
not the current story. Do not run historical update scripts to restore those plots.
Use `scripts/apply-new-beginning-story.ts` for guarded Memgraph updates. It backs
up all eight records, requires exact revisions, preserves IDs/publication states
and fixed feedback, and verifies full records after the atomic write.
It does not change student notes, assessment history, or generated checkpoint lessons.
The story rewrite clears incompatible previous scene images. Lessons 1 and 2
now have matching watercolor illustrations for Introduce, Apply, and Challenge 1.
Their six PNG masters and optimized WebP assets live in `images/`; prompts and
character/style references are recorded in `new-beginning-watercolor-prompts.json`.
Use `scripts/apply-new-beginning-watercolor.ts` for guarded, image-only uploads
and Memgraph reference changes. It preserves lesson text, notes, and publication states.

Lesson 3, **A Shared Hobby**, also uses approved watercolor scenes for Introduce,
Apply, and Challenge 1. Emma meets Nao through their shared photography hobby,
reads Nao's profile on the residents' board, and discusses Nao's invitation with
Claire. They have not gone on the photo walk yet. The PNG masters and WebP
assets use the `lesson3-*-new-beginning-watercolor-v1` filenames in `images/`.
Use `scripts/apply-shared-hobby-watercolor.ts` (dry run, then `--write` with
the reviewed `--expected` revision) for image-only persistence. It backs up
the record, refuses different files at existing asset URLs, guards concurrent
edits, and verifies the complete record after saving. Realistic full-scene preview
variants were not selected or added to these three sections.

Lesson 3's six Step A vocabulary cards use separately approved realistic photos:
shared hobby, ceramics, free time, explore, cafe entrance, and bring your camera.
The PNG masters and optimized WebP assets are in `images/` with the
`lesson3-vocabulary-*-photo-v1` filenames. The three main watercolor scenes stay
unchanged. Use `scripts/apply-lesson3-vocabulary-photos.ts` (dry run, then `--write`
with the reviewed `--expected` revision) for phrase-matched, guarded image-only
persistence. It does not change vocabulary text, tutor guides or learner data.

Lesson 4, **A Walk Through Kyoto**, uses the approved watercolor scenes for
Introduce (old street and temple gate), Apply (sharing a garden photo), and
Challenge 1 (talking after the walk beside the river). Apply uses the corrected
`lesson4-apply-new-beginning-watercolor-v2` image: the camera's screen faces Nao,
not the viewer. PNG masters and WebP copies are in `images/`. Use
`scripts/apply-shared-hobby-watercolor.ts --lesson=4` for the dry run, then add
`--write --expected=<reviewed revision>` for guarded, image-only persistence.
It preserves vocabulary artwork, lesson text, guides, status and learner data.

Lesson 4's Step A vocabulary also has six approved realistic photos for
walked through, visited, photos, peaceful, favorite place, and feel at home.
The `lesson4-vocabulary-*-photo-v1` PNG masters and WebP copies are in `images/`.
Use `scripts/apply-lesson3-vocabulary-photos.ts --lesson=4` for a dry run, then
add `--write --expected=<reviewed revision>` to update only the six phrase-matched
image fields. Main watercolor scenes, text and learner data are preserved.

Lesson 6, **An Interesting Idea**, uses approved watercolor scenes for Introduce
(four friends planning), Apply (Claire and Emma discussing the exhibition), and
Challenge 1 (dividing tasks beside the still-empty display wall). These show
planning, not the completed exhibition or the later bakery problem. The final
Challenge 1 asset is `lesson6-challenge1-new-beginning-watercolor-v3`: Emma's legs
are naturally aligned, with the table and photo samples behind her. Masters and
WebP files are in `images/`. Run `scripts/apply-shared-hobby-watercolor.ts --lesson=6`
as a dry run, then add `--write --expected=<reviewed revision>` to persist only
the artwork references under the existing backup/concurrency guards.

Lesson 6's Step A cards use six separately approved realistic vocabulary photos:
organize an exhibition, display our photos, bring her ceramic pieces, prepare
snacks, make a poster, and invite the neighbors. These illustrate the assigned
activities; they do not rewrite the story or mean the exhibition has happened.
The `lesson6-vocabulary-*-photo-v1` masters/WebP files live in `images/`.
Use `scripts/apply-lesson3-vocabulary-photos.ts --lesson=6` for a dry run, then
add `--write --expected=<reviewed revision>` for phrase-matched image-only saves.
All three main watercolor scenes, text, guides and learner records are preserved.

Lesson 7, **An Unexpected Problem**, uses the approved watercolor scenes for
Introduce (Leo brings the bakery news), Apply (Claire offers the cafe kitchen),
and Challenge 1 (Emma and Leo divide unfinished preparation jobs). The bakery's
broken oven is distinct from the cafe's working oven. PNG masters and optimized
WebP copies use `lesson7-*-new-beginning-watercolor-v1` in `images/`.
Use `scripts/apply-shared-hobby-watercolor.ts --lesson=7` with the same dry-run,
exact-revision, backup and image-only write guards.

Lesson 7's Step A uses six approved realistic photos: is broken, worried about,
enough, instead, Could you help me, and finish by. The worried-about image uses
the final `v3` correction with visible wrists and adult-proportioned hands.
PNG masters and WebP copies use `lesson7-vocabulary-*-photo-v1` filenames except
`lesson7-vocabulary-worried-about-photo-v3`. Run
`scripts/apply-lesson3-vocabulary-photos.ts --lesson=7` as a dry run, then use
`--write --expected=<reviewed revision>` for the guarded image-only update.
The three watercolor scenes, text, guides, status and learner data are preserved.

Lesson 8, **The Exhibition**, uses the approved `v2` watercolor scenes for
Introduce, Apply and Challenge 1. Visitors have distinct older faces; the four
main characters retain their established designs. PNG masters and optimized
WebP copies use `lesson8-*-new-beginning-watercolor-v2` in `images/`.
Use `scripts/apply-shared-hobby-watercolor.ts --lesson=8` with the same dry-run,
exact-revision, backup and image-only write guards. The reading challenge also
includes its approved scene as an image block after the unchanged program.

Lesson 8's Step A uses six approved realistic photos: exhibition, on display,
ceramic cups and bowls, free, welcomes visitors, and guest book. Visitors retain
their distinct older designs. The free-entry and guest-book images use small
physical signs to clarify their meanings. PNG masters and optimized WebP copies
use `lesson8-vocabulary-*-photo-v1` filenames in `images/`.
Use `scripts/apply-lesson3-vocabulary-photos.ts --lesson=8` with the same dry-run,
exact-revision, backup and image-only write guards. Text, reading evidence,
guides, watercolor scenes, draft status and learner data are preserved.

Lesson 9, **A Place to Call Home**, uses the approved watercolor scenes beside
the Kamo River: all four friends in Introduce, Claire and Emma in Apply, and
Emma and Nao in Challenge 1. Leo no longer wears his cafe apron outdoors.
PNG masters and WebP copies use `lesson9-*-new-beginning-watercolor-v1` in
`images/`. Run `scripts/apply-shared-hobby-watercolor.ts --lesson=9` with the
same dry-run, exact-revision, backup and image-only write guards. Canonical
defaults now include approved main-scene artwork for all eight story lessons.

Lesson 9's Step A uses six approved realistic photos: proud of, special memory,
at first, belong here, your support, and looking forward to. Exhibition memories
are distinguished from the current riverside scene; the next photo outing
remains a plan. PNG masters and optimized WebP copies use
`lesson9-vocabulary-*-photo-v1` filenames in `images/`. Run
`scripts/apply-lesson3-vocabulary-photos.ts --lesson=9` with the same dry-run,
exact-revision, backup and image-only write guards. Lesson text, guides,
watercolor scenes, feedback, draft status and learner data are preserved.

## Review in Admin

Open http://localhost:5175/conversational-skills-editor and select Level 3,
Chapter 1. Each draft opens in the existing visual editor. Use its Preview action
to review an unpublished lesson. Publish after editorial review.

Direct Lesson 1 editor:
http://localhost:5175/conversational-skills-visual-editor/conversational-skills-L3-C1-1-speaking-1774155960030

The source lesson is preserved in `backups/2026-09-23T06-32-26-413Z.json`.
Later backups are snapshots taken before subsequent imports.

## Assets and Source

- `specs.ts`: legacy base content for the original ten draft slots.
- `lesson-1-trivia.ts`: revised first-meeting trivia about the liking gap, Japanese translation, discussion question, and research source (Boothby et al., 2018).
- `standardize-tutor-guides.ts`: Lesson 3-based tutor-guide standard for Lessons 1-2; changes guide fields only. Apply through `bun scripts/standardize-lessons-1-2-tutor-guides.ts` from the repository root (dry run first, then `--write` with the three reviewed `--expected-1/2/3` revision arguments).
- `build.ts`: adapts the base content and overlays revised Lessons 6-9 for the visual-editor schema.
- `chapter.json`: exported full editor records from the import.
- `images/`: generated, inspected visual aids, optimized to WebP.
- `lesson-2-listening.ts`: the revised Kyoto listening lesson and its tutor scripts.
- `lesson-2-image-prompts.json`: prompts for Lesson 2's distinct photo assets.
- `apply-lesson-2.ts`: backs up and updates only Lesson 2 after checking its revision.
- `lesson-3-reading.ts`: the Kyoto bicycle-rental reading lesson, service lists, and tutor guides.
- `lesson-3-image-prompts.json`: prompts for Lesson 3's nine distinct photos.
- `apply-lesson-3.ts`: backs up and updates only Lesson 3 after checking its revision.
- `lesson-4-speaking.ts`: the text-only continuation of the bike outing, with an Emma-Claire Apply dialogue and a tutor-first problem-solving roleplay. Standard guide format; existing trivia and fixed feedback categories are preserved.
- `scripts/update-lesson-4-story.ts` (repository root): backs up and revises only live Lesson 4, checks both its revision and the Lesson 3 guide reference, validates content, and verifies persistence. Run without `--write` first.
- `apply-lesson-4.ts`: backs up and updates only Lesson 4 after checking its revision.
- `lesson-6-listening.ts`: the dramatic exhibition continuation, two-message Apply, Nao-to-Emma listening mission, five approved Useful Language phrases, and early-lesson tutor-guide structure. Existing images and fixed feedback categories are preserved.
- `scripts/update-lesson-6-story.ts` (repository root): reads current live Lessons 2 and 6, validates a preview, backs up both, then updates Lesson 6 only with revision guards and full read-back verification. Run without `--write` first; a write requires reviewed `--expected-updated-at` and `--expected-reference` values. Lesson 7 is not updated by this command.
- `scripts/simplify-lesson-6-listening.ts` (repository root): changes only Apply and Challenge 1 listening tasks in the latest live record, preserving other editor content. Scripts are 72 and 57 words, with pause points, four Apply questions, and short-answer support. Dry run first, then write with the reviewed `--expected-updated-at` value.
- `lessons-6-9.ts`: routes Lesson 6 to its dedicated authoring module and builds the remaining text-only exhibition arc.
- `apply-lessons-6-9.ts`: backs up and updates only draft Lessons 6-9 after checking their revisions.
- `image-prompts.json`: exact generation prompts; built-in image_gen was used.
- `import.ts`: validates, backs up, uploads assets, and transactionally imports drafts.

Images are served through the existing API file proxy from SeaweedFS:
`/lesson/files/lessons/conversational-skills/ja/l3-c1/v1/{name}.webp`.
They illustrate the situation and concrete vocabulary; they are not listening
answer keys or a claim that every pictured person matches a named speaker.

## Reproduce

From `fluentxverse-server`:

```sh
bun content/conversational-skills/ja/level-3-chapter-1/import.ts
bun test tests/conversationalLessonValidation.test.ts
LESSON_AUTHORING_DB_URI=bolt://localhost:7691 bun content/conversational-skills/ja/level-3-chapter-1/import.ts --write
```

`--write` imports drafts only and requires an explicit database URI. Credentials
use the existing `MEMGRAPH_USER` and `MEMGRAPH_PASSWORD` environment variables.
`LESSON_AUTHORING_FILER` defaults to `http://localhost:8888`;
`LESSON_ASSET_API_BASE` defaults to `http://localhost:8765` for validation only.
For `--write`, set it explicitly to the public API origin (for example,
`https://api.fluentxverse.xyz`) so saved image URLs work in hosted lessons.
Set `LESSON_AUTHORING_FILER` to the matching storage endpoint as needed.
The importer refuses unexpected lesson IDs or records changed in the admin
after an import. Work in the admin normally; do not rerun to overwrite edits.

Lesson 1's current editor record has newer content than the legacy chapter export.
To update only its trivia in the live Memgraph database, run
`bun scripts/update-lesson-1-trivia.ts` from the repository root to review the
proposed text and current revision. Then pass `--write` and
`--expected-updated-at=<reviewed revision>`. This backs up the live record,
preserves the image and guide format, and refuses concurrent edits. The fact is
based on [the original liking-gap study](https://pubmed.ncbi.nlm.nih.gov/30183512/),
including its findings about new dorm mates; it is not a claim specific to Japan.

## Verification

Content tests cover active branch completeness, skill alignment, Japanese
support, absence of Korean, script placement, missing passages, and old-course
compatibility. Publish validation is applied to Conversational Skills Level 3+.

Browser checks use the saved draft export as intercepted lesson responses so
unpublished lessons can be tested in student and tutor renderers without making
them public. Database persistence is checked separately through the real lesson
service. Desktop checks cover all ten lessons in admin preview, editor, student,
and tutor views; mobile checks cover one lesson of each skill in each renderer.
Screenshots and the result report are under `output/lesson-authoring/qa` at the
repository root. Tutor login in these renderer checks uses a test response;
this does not exercise a real login flow.
