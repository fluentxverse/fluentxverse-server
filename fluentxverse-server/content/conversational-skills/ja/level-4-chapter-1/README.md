# Level 4, Chapter 1: After the Truth

Current language target: **Level 4, TOEIC 225-545** (owner authoring range, not a CEFR conversion).
The original chapter builder below is a story baseline. Current simplified
episodes are in `../toeic-revisions-v1/` and are composed with
`buildToeicLesson()`. Use the guarded current updater, not a historical direct
import, over saved lessons. See [the language policy](../../../../../docs/conversational-language-targets.md).
Lesson authoring is offline; do not use application or external model API keys.

Adapted from the supplied eight-episode outline. Continue the revised Chapter 5
incident: a hidden private dinner and a false work message, not physical intimacy.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | The Morning After | Speaking | Express feelings and respect a request for space |
| 2 | An Uncomfortable Conversation | Listening | Understand regret and professional-contact arrangements |
| 3 | Different Opinions | Reading | Compare reasons and choose a respectful shared plan |
| 4 | A Chance to Explain | Speaking | Sequence past events and acknowledge responsibility |
| 5 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 1-4 |
| 6 | Trouble at Work | Speaking | Disagree professionally and confirm tasks and deadlines |
| 7 | Finding Some Peace | Speaking | Describe mixed feelings and accept supportive company |
| 8 | The Decision | Reading | Interpret a firm boundary, apology and limited meeting agreement |
| 9 | A Different Kind of Goodbye | Speaking | Accept a breakup respectfully and express gratitude |
| 10 | Personalized Checkpoint | Review | Existing dynamic system; source Lessons 6-9 |

## Continuity

Monday support and office handover follow Chapter 5's Sunday disclosure. Tuesday
brings Claire and Nao's disagreement; Thursday's river conversation leaves the
relationship undecided. Friday's work conflict is separate from the later day-off
photo walk. Emma then makes a firm decision about professional contact and writes
a letter. Claire asks before passing it on. Leo reads it and arranges Saturday
at four at the cafe; meeting does not itself promise reconciliation.

In Lesson 9 Leo explicitly ends the relationship. Emma acknowledges his decision
and request for distance. Only afterward does his former Bristol manager email
about a possible role at a new bakery. No acceptance, move, new romance with Nao,
or automatic reconciliation is invented. The next stories continue in Level 4
Chapters 2-5. This was originally supplied as the Chapter 6 outline.

## Standards and Persistence

Short, supported B1 language with scaffolded B2 forms where relevant. Keep the
existing BEGINNER badge, Japanese support, direct roles, short tutor-first dialogues,
six vocabulary items, discussion, basic pronunciation, two concise tips, six Step A
items and four Step B items with keys and existing marking/note controls. Fixed
range/accuracy/fluency feedback and standard guide counts remain unchanged.
Listening scripts stay tutor-only; reading missions supply fresh visible evidence.
No images generated. Learner roles include Leo and Claire where the scene calls
for them, rather than inventing Emma's presence in every scene.

```sh
bun scripts/apply-exploring-kyoto.ts --level=4 --chapter=1
```

Review candidates in `output/after-the-truth/`, then write with the exact reviewed
snapshot digest using `--write --expected=...`. The existing updater backs up
records, refuses non-draft replacements, guards concurrent edits, writes eight
drafts and chapter metadata transactionally to Memgraph, and verifies full records.
It does not change earlier chapters, checkpoint records, student marks or notes.

Level 3 and Level 4 each have five chapters. Existing migrated drafts retain their
stable IDs and original backups, so saved links remain usable. New records use
Level 4 IDs. See `docs/conversational-level4-reorganization.md` for the guarded
placement-only migration. Content saves do not deploy application code.
