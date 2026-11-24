# Level 6, Chapter 5: What We Leave Behind

The concluding eight episodes of Threads of Tradition, written directly from
the owner's reference at the established **TOEIC 550–780** authoring target.
The reference's C1 label does not change that target. English only, no new
artwork, no romance and no external model API or application AI-credit use.

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | The Weight of an Inheritance | Speaking | Explain uncertainty and ask about shared responsibilities |
| 2 | A Difficult Decision | Listening | Compare alternatives and separate possible roles from commitments |
| 3 | The People Who Came Before | Reading | Interpret an account and prepare accurate historical captions |
| 4 | Different Visions | Speaking | Acknowledge priorities and agree on a limited first step |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | A Promise to the Future | Speaking | Explain the six-month trial, budget categories and shared roles |
| 7 | Preparing the Final Exhibition | Speaking | Use feedback to recognise the wider community |
| 8 | The Last Demonstration | Reading | Express thanks and explain the transition from full-time work |
| 9 | Threads That Never Break | Speaking | Reflect on shared growth and welcome a beginner |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Owner Pointers

- Four Step A expressions per lesson, with English meanings and highlighted
  contextual examples. Part II leads directly to Step B.
- **Only Step B has pronunciation.** No Part III pronunciation. Two relevant
  phrases per lesson teach linking, stress and meaning groups in full sentences.
  Exact stressed words or syllables are bold. There is no extra commentary
  about pronunciation guides or accents in the lesson content.
- The lesson objective comes before the situation. Situation fields are plain
  English, with questions in separate tutor-guide fields. Direct roles and
  natural tutor-first openings support short conversations.
- Listening has two distinct, short tutor-only messages. Reading challenges
  provide fresh visible notes. Six/four exercise keys, five Useful Language
  frames, optional discussion topics and the fixed English feedback remain.
  Student mistakes and notes remain the evidence for personalized checkpoints.

Introductions are 60–69 words, speaking models 117–134 words, listening sources
81/69 words, and reading sources/notes 98–121 words. All fit the Level 6 budgets.

## Continuity and the Ending

The opening uses only the supplied return from a rural festival. It does not
invent an intervening chapter, festival name, route or additional event. Haru's
choice about succession remains voluntary. The alternatives are discussed
before a shared plan is agreed.

Mrs. Takeda will retire from **full-time work at year’s end**. Her autumn
demonstration is her last in that full-time role, not a promise never to help
again. The trial includes occasional mentoring. Haru coordinates daily work
and continues learning; experienced local artisans support teaching.

The historical photograph shows Mrs. Takeda at nineteen. Daniel's first guess
of about twenty is corrected, and no calendar year is added. Her recollections
include slow business and a wider craft community. Permission to photograph
historical materials is kept separate from all possible future image uses.

Haru and Mrs. Takeda first agree to start small, with quality as the condition
for expansion. The family then agrees to a **six-month trial**, fair instructor
compensation and shared roles. The source gives expense categories and planned
fee income, not exact amounts, prices or proven profit. Aiko contacts schools
before the final episode confirms scheduled visits. Visitor interest at the
exhibition is not presented as a completed booking.

The display is revised to recognise former apprentices, colleagues and
craftspeople. The final reading lesson uses a conversational appreciation task;
it does not impose a long speech. Several months later, the first students are
beginning, not finishing the trial. Aiko is developing cultural education, Mei
is collecting stories with families' agreement, and Daniel has completed a
documentary series. Mrs. Takeda welcomes the friends, Haru greets a beginner,
and Daniel lowers his camera to experience the moment. The story ends here.

Background: [Kanazawa's official art-culture guide](https://visitkanazawa.jp/en/feature/detail_290.html)
describes Kaga Yuzen's connection with Kanazawa, handwork and artisans with
different skills. Checked November 15, 2026. The family, exhibition, trial and
school arrangements in these lessons are fictional. No production instructions,
historical dates, awards or financial figures are invented.

## Verification and Persistence

```sh
bun scripts/apply-exploring-kyoto.ts --level=6 --chapter=5
bun test ./fluentxverse-server/tests/leaveBehind.test.ts
node scripts/tests/new-paths.cjs --level=6 --chapter=5
```

Review the generated `output/what-we-leave-behind/lesson-*.json` before using
the fresh snapshot digest with `--write --expected=...`. The established writer
saves to Memgraph with a private backup, concurrency guard and full-record
read-back. It preserves existing IDs, artwork, publication states, fixed
feedback and learner properties. Checkpoints 5/10 remain dynamic; saved notes,
marks and personalized reviews are not regenerated. Content saving is separate
from publication, application deployment and Git push.

Saved and verified November 15, 2026: eight new drafts, chapter metadata,
private backup and full-record read-back. Sixty-three targeted tests and all
33 renderer cases passed, with a further focused final-lesson check after the
last wording edit. The server typecheck retains 159 existing diagnostics
elsewhere; none are in the new chapter or pronunciation source/tests.
