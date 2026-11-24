# Level 3, Chapter 4: Work, Dreams & Decisions

Current language target: **Level 3, TOEIC 10-220** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

The user supplied a Chapter 4 fragment beginning with Claire's workshop proposal
and continuing through Nao's first customer, Emma's interview, Leo's success,
the job offer and a hybrid-work request. The first two opening episodes are
newly authored to establish the Osaka interview invitation and Leo's pastry brief.
The chapter title is also an editorial addition.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | A Message from Osaka | Speaking | Discuss an opportunity and ask relevant questions |
| 2 | Leo's New Challenge | Listening | Understand a work brief, requirements, and deadlines |
| 3 | A New Idea for the Cafe | Reading | Compare workshop proposals against a budget |
| 4 | The First Customer | Speaking | Confirm custom order prices, delivery, and requests |
| 5 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 1-4 |
| 6 | The Interview | Speaking | Introduce experience and explain a project |
| 7 | A Recipe for Success | Speaking | Describe a process and give specific feedback |
| 8 | A Choice to Make | Reading | Compare options and separate offer terms from suggestions |
| 9 | The Decision | Speaking | Discuss concerns and ask the agency to consider hybrid work |
| 10 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 6-9 |

## Story and Language Standards

All four characters have professional goals. Emma considers career development
and a possible move; Leo develops a pastry for the menu; Claire plans sustainable
weekly workshops; Nao handles a first direct ceramic order after her exhibition.
The romance stays part of the continuing story, not its only subject.

Use the same short A2-B1 language, Japanese support, direct role assignments,
and standardized tutor guides as Chapters 1-3. Six vocabulary items, Part II
discussion, Part III pronunciation, two concise language tips, six Step A items
and four Step B questions, useful language, and three optional discussion topics.
Speaking Apply uses ten alternating lines; roleplays are tutor-first dialogue.
Listening transcripts remain tutor-only; reading tasks keep the evidence visible.
Keep the fixed range/accuracy/fluency rubric and six-step feedback guide.

Lesson 9 has two short rounds in the existing roleplay guide: tutor begins as Leo,
then explicitly switches to the recruiter and starts the phone conversation.
The agency will consider the hybrid request; it does **not** approve it in this
chapter. Emma has not accepted or declined the job. The final answer remains
pending for Chapter 5. Do not resolve this ending during feedback or free talk.

The interview is next Tuesday at 10. Leo's manager tasting is Wednesday at 3,
following the friends' Sunday preview and Monday feedback. The offer requests
five office days; two office days and three Kyoto remote days remain Emma's
proposal. The recruiter expects an answer by Monday morning before the Monday
5 p.m. offer reply deadline. Story budgets, prices, timings, and workplace terms
are teaching examples, not market data or actual agency policies.

## Persistence

`build.ts` is the canonical chapter source. Eight authored lessons are drafts
in Memgraph, with chapter metadata set to Work, Dreams & Decisions. No images
generated. Student notes, marks, existing chapters and checkpoints are unchanged.

From the repository root, dry-run with:

```sh
bun scripts/apply-exploring-kyoto.ts --chapter=4
```

Review candidates in `output/work-dreams-decisions/`, then provide the exact
snapshot digest with `--write --expected=...`. The shared updater guards
concurrent changes, refuses non-draft replacements, backs up all records and
metadata, writes transactionally and verifies full records.

Tests: `tests/workDreamsDecisions.test.ts` and `scripts/tests/work-dreams-decisions.cjs`.
