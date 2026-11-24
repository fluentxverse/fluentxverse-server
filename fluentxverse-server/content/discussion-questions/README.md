# Discussion Questions: five levels, fifty materials

Directly authored English-only question banks for the existing Discussion
Questions course. Each of five levels contains ten topics with twenty questions,
for **50 materials and 1,000 questions**. The existing empty **Motorcycle** draft
is completed in place; its identity, original author and creation date remain.
The other 49 materials are new drafts.

| Level | Existing course label | Topics |
| --- | --- | --- |
| 1 | Starter | Motorcycle; Food I Like; My Day; Places Around Town; Free Time; Weather and Clothes; Animals Around Us; Things at Home; Getting Around; A Good Weekend |
| 2 | Beginner | Starting a New Hobby; Eating Out Together; A Trip for One Day; Shopping Choices; Learning Something New; Using My Phone; Meeting New People; Making Plans with Friends; Helping in Everyday Life; A Small Celebration |
| 3 | Elementary | Building a Learning Habit; A Comfortable Neighbourhood; Choosing a Travel Experience; Working Well Together; What Makes a Good Purchase?; Making Time for What Matters; Stories We Recommend; Digital Habits and Attention; Welcoming Visitors; Small Changes, Less Waste |
| 4 | Intermediate | Flexible Work, Shared Responsibilities; Designing Better Public Spaces; Trusting Reviews and Recommendations; Learning Beyond the Classroom; Tourism and Everyday Life; Everyday Privacy Choices; Convenience and Sustainable Choices; Resolving Everyday Disagreement; What Counts as Success?; A Community Budget Decision |
| 5 | Advanced | AI Tools and Human Judgement; The Limits of a Single Measure; Speaking for Others; Fairness Beyond Equal Treatment; Preserving a Place While Changing It; Accountability After a Mistake; Moderating a Shared Online Space; Ownership, Access and Shared Resources; Expert Advice and Public Judgement; Making Progress Without a Perfect Solution |

The labels above are the course manager's existing five-level taxonomy; the
Conversational Skills TOEIC ranges are not imported into this separate course.

## Teaching approach

Starter questions support naming, preferences and short sentences. Beginner
questions add simple reasons and practical exchanges. Elementary questions ask
for explanation, comparisons and suggestions. Intermediate questions consider
competing needs and qualified proposals. Advanced questions examine assumptions,
evidence, responsibility, counterarguments and conditions for revising a view.

Each material includes a specific goal, topic description, five-step tutor guide,
English-only feedback, a four-point achievement rubric and six feedback steps.
The objective comes before the topic; the tutor asks first. Questions form a
bank for selecting 6–8 exchanges during the twenty-minute discussion, with two
minutes for feedback. Tutors should not rush all twenty questions.

Students can give real, invented or third-person examples and skip questions.
No private income, family history or other personal disclosure is required.
Sensitive decisions use fictional situations. Opinions and voluntary refusals
are not language errors. Feedback uses observed responses; its examples are
illustrations rather than invented student performance. No compulsory speech.

This course uses its existing Discussion Questions format. No Conversational
Skills story, Step A/Step B sections or duplicate pronunciation is added. No
Japanese translations, external model calls, application AI credits or artwork
generation are used.

## Compilation, review and guarded save

```sh
bun scripts/apply-discussion-questions.ts
bun test ./fluentxverse-server/tests/discussionQuestions.test.ts
node scripts/tests/discussion-questions.cjs
```

Review `output/discussion-questions/materials.md` or the fifty JSON fixtures.
Then supply the fresh dry-run digest to the writer with `--write --expected=...`.
The digest covers both the live snapshot and direct authored source. The writer
backs up existing records privately, checks for concurrent changes in a
transaction, rejects unexpected occupied slots and preserves existing identities,
artwork, learner properties, fixed feedback and publication states. It verifies
all complete records after saving and leaves course metadata unchanged.

The browser harness intercepts API reads with fixtures and blocks writes. It
checks all fifty editor materials on desktop, one per level on mobile and the
catalogue at both sizes. It does not call the AI authoring feature or publish.
Draft saving is separate from application deployment and Git push.

Saved and verified November 15, 2026: exactly ten drafts per level, fifty total,
with one thousand questions. Nine targeted tests (3,459 assertions) and 57
read-only browser data checks passed. Full server typecheck retains 159 existing
diagnostics elsewhere and none in the new content or tests. No publication,
application deployment, model-backed authoring or Git push.

Visual review found a pre-existing mobile editor limitation: its feedback grid
retains a fixed 380px right column, collapsing the objective panel at 390px.
The feedback values load correctly; this is not a mobile layout pass. Existing
single-line editor fields also clip long text until scrolled within the field.
The server's generic computed lesson badge differs from this course manager's
five-level labels; this content-only update retains existing application behaviour.
The complete questions and goals can be reviewed in `materials.md` without those
editor constraints. No application styles or badge mappings were changed.
