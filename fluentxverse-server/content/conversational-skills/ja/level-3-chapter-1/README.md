# Level 3, Chapter 1: Nice to Meet You

English lessons for adults, with Japanese supporting translations.
The revised lessons follow residents of fictional Kamo House in Kyoto.
Lesson 1 is published in the connected local database; Lessons 2-4 and 6-9 are
drafts for editorial review. Existing authored drafts in slots 5 and 10 remain
untouched; personalized checkpoint slots are generated separately when their
four source lessons are published. Lesson 1 retains its existing ID.

## Curriculum

| Lesson | Title | Skill / Apply / Main Mission | Language focus | Exercise A / B |
| --- | --- | --- | --- | --- |
| 1 | Introducing Myself | Speaking | Detailed self-introduction; past and ongoing experience | Choose / conversation |
| 2 | A Housemate's Voice Message | Listening | Past versus present, reasons for moving; tutor-read monologues | Choose / listening multiple choice |
| 3 | Choosing a Bike Rental | Reading | Prices, time limits, and extra charges | Choose / service-detail multiple choice |
| 4 | Sharing a Sunday Plan | Speaking | Organized talk, reasons, sequence, and backup | Choose / stronger sentence |
| 5 | Personalized Checkpoint | Review | Lessons 1-4, adapted to student evidence | Dynamic practice / three challenges |
| 6 | The Exhibition Has Moved | Listening | Old versus confirmed plan; changed time and venue | Choose / listening multiple choice |
| 7 | The Poster Went Out | Reading | Message order; fact versus assumption | Choose / evidence multiple choice |
| 8 | Making Things Right | Speaking | Apology, responsibility, completed remedy, next step | Choose / stronger response |
| 9 | The Missing Cups | Listening | Worry versus fact; final outcome and timing | Choose / listening multiple choice |
| 10 | Personalized Checkpoint | Review | Lessons 6-9, adapted to student evidence | Dynamic practice / three challenges |

Each non-checkpoint lesson has a 23-minute core: introduction 1, Learn 4, language focus 2,
Apply 4, Exercise 4, Mission 6, and Feedback 2. Challenge 2 adds up to two minutes.
Lessons 6-9 use optional discussion with three general free-talk categories.

Listening is **tutor-delivered**: complete scripts, delivery guidance, gist/detail
questions, and answer keys are in the tutor guide. No recorded audio was generated.
Student views do not render the tutor guides or transcripts. Reading lessons
have actual passages; Lessons 4 and 8 give space for sustained speaking with
minimal tutor interruption. Score receptive lessons chiefly on understanding,
not on the length of a correct answer.

English is the instructional language. Japanese appears in goal, introduction,
vocabulary/expression, task-instruction, grammar-support, and feedback fields.
The existing `goalTextJp` field is used; no application-wide language switch was added.
The chapter replaces the old Level 3 Chapter 1 content; it is not a parallel course.
Future authoring and regeneration must follow the shared rules in
`../AUTHORING_CORRECTIONS.md`.

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
- `build.ts`: adapts the base content and overlays revised Lessons 6-9 for the visual-editor schema.
- `chapter.json`: exported full editor records from the import.
- `images/`: generated, inspected visual aids, optimized to WebP.
- `lesson-2-listening.ts`: the revised Kyoto listening lesson and its tutor scripts.
- `lesson-2-image-prompts.json`: prompts for Lesson 2's distinct photo assets.
- `apply-lesson-2.ts`: backs up and updates only Lesson 2 after checking its revision.
- `lesson-3-reading.ts`: the Kyoto bicycle-rental reading lesson, service lists, and tutor guides.
- `lesson-3-image-prompts.json`: prompts for Lesson 3's nine distinct photos.
- `apply-lesson-3.ts`: backs up and updates only Lesson 3 after checking its revision.
- `lesson-4-speaking.ts`: the text-only, sustained-speaking Sunday-plan lesson.
- `apply-lesson-4.ts`: backs up and updates only Lesson 4 after checking its revision.
- `lessons-6-9.ts`: the text-only exhibition arc, bilingual support, tutor scripts, answer keys, and trivia sources.
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
