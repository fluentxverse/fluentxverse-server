# Level 3, Chapter 5: Two Cities, One Secret

Current language target: **Level 3, TOEIC 10-220** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

Adapted from the supplied eight-episode outline. The physical-intimacy scene is
replaced throughout with a hidden private dinner and a false work message. The
last lesson reveals that dinner, not a different incident. Regret, honesty, trust
and consequences remain the story's communication focus.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | A New Beginning in Osaka | Speaking | Introduce yourself at work and ask for help |
| 2 | Lunch with Ren | Listening | Understand interests and ask related questions |
| 3 | Working Late | Reading | Read updated deadlines and explain a delay |
| 4 | More Than Friends? | Speaking | Express feelings and state a clear boundary |
| 5 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 1-4 |
| 6 | A Broken Promise | Speaking | Acknowledge a missed plan and apologize |
| 7 | A Choice to Regret | Speaking | Explain regret and a better past choice |
| 8 | Keeping Secrets | Reading | Separate facts from fears and discuss advice |
| 9 | The Truth Comes Out | Speaking | Admit a mistake and respect a request for time |
| 10 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 6-9 |

## Continuity and Teaching Standards

Chapter 4 ends before hybrid work is approved. Here the agency approves it on
Monday morning before the reply deadline; Emma then accepts and starts the
following month. Office days are Monday/Friday, with three Kyoto workdays.
The extra Thursday gathering in Lesson 6 and Friday dinner in Lesson 7 are
separate events. Emma restates her work boundary to Ren but has not explained
the dinner to Leo. Saturday advice leads to a Sunday meeting at six; the project
handover is Monday at ten. Ren's message exposes the dinner on Sunday.

Leo asks for space. The chapter does not force forgiveness, reconciliation or a
final breakup. The tutor assesses clear language and comprehension, not acting
ability or a prescribed emotional response.

Short supported B1 language within the existing Level 3 shell. Direct roles
(You are Emma), Japanese support, six vocabulary items, Part II discussion,
basic Part III pronunciation, two concise tips, six Step A items and four Step B
items with answer keys and existing marking/note controls. Speaking Apply is a
ten-line dialogue. Listening transcripts stay tutor-only; reading evidence stays
visible and Mission uses fresh material. The established guide structure and
fixed feedback rubric are retained. No images generated.

## Persistence and Verification

`build.ts` is the canonical source. The guarded shared updater saves eight drafts
and chapter metadata to Memgraph. It does not write to Postgres or alter student
notes, marks, earlier chapters or checkpoint records.

```sh
bun scripts/apply-exploring-kyoto.ts --chapter=5
```

Review `output/two-cities-one-secret/`, then supply the exact snapshot digest
with `--write --expected=...`. The updater backs up the existing chapter and
reference, guards revisions, refuses non-draft replacements, writes atomically
and checks full records on read-back.

Tests: `tests/twoCitiesOneSecret.test.ts` and
`scripts/tests/two-cities-one-secret.cjs`.
