# Level 5, Chapter 5: The Price of Truth

The final eight text-only episodes of Tokyo After Hours, adapted directly in the
coding conversation from the owner's reference. No external model API is used.
The owner's TOEIC 225-545 authoring target takes precedence over the reference's
B2-C1 label. This is an authoring target, not a test-score guarantee.

| Lesson | Title | Skill | Communication Task |
| --- | --- | --- | --- |
| 1 | Following the Evidence | Speaking | Explain the sharing route and remaining questions |
| 2 | The Director's Explanation | Listening | Separate stated reasons from email evidence |
| 3 | The Truth Behind the Numbers | Reading | Compare forecasts and explain the correction |
| 4 | The Price of Silence | Speaking | Discuss regret and a better future action |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1-4 |
| 6 | A Difficult Apology | Speaking | Respond to an apology and agree on teamwork changes |
| 7 | Facing the Client | Speaking | Acknowledge failures and explain completed changes |
| 8 | A Second Chance | Reading | Distinguish final staff decisions from a pending contract |
| 9 | A Different Kind of Success | Speaking | Reflect on teamwork and welcome a new colleague |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6-9 |

## Authoring Standard

Apply [AUTHORING_CORRECTIONS.md](../AUTHORING_CORRECTIONS.md). Introduce the
lesson objective before the situation. Keep English situations, Japanese
support and comprehension questions in separate fields. Use named roles and
short, tutor-first dialogues, never a required monologue or alternate-character
disclaimer. The final Challenge 1 explicitly assigns the tutor the newcomer
role, separately from Ethan in Apply.

Introductions are 49-53 words. Speaking models are below 90 words, both private
listening messages are at most 55 words, and each reading text is under 100
words. Keep six contextual vocabulary examples, Part II discussion, basic
/f/-/v/ pronunciation, two tips, six Step A items, four Step B items and five
Useful Language frames. Tutor guides follow the established numbered structure.
Fixed feedback, the 4-1 rubric and Range/Accuracy/Fluency categories remain.
Record actual mistakes and tutor notes; sparse checkpoint evidence must lead
to balanced review rather than invented weaknesses. No new artwork or romance.

## Continuity and Evidence

- Lesson 1 confirms the route: Ethan forwarded Kuroda's account link under his
  instructions; the consultant employee sent the files to Northstar's strategy
  department. The acquisition preceded sharing. Ownership does not prove
  automatic access, who created the account link, or who knew the connection.
- Lesson 2 presents Kuroda's stated reasons and an email showing he received
  notice two months before the review. His silence is not a confession.
- Lesson 3 confirms the original forecast was reasonable, the higher estimates
  lacked research support, and Kuroda ordered them despite objections to help
  secure the contract. Forecasts are not actual earned sales. His hope for
  outside support is not proof of intent to send material to a rival bid team.
- Lesson 4 contains Kuroda's admission of knowledge, denial of intended rival
  bid-team delivery and suspension pending a final decision. Do not move the
  later dismissals or Ethan's formal warning into this scene.
- Lesson 6 shows Ethan accepting failures and apologizing. Acknowledging an
  apology does not require instant forgiveness or mean trust is fully restored.
- Lesson 7 explains corrected figures, an updated creative plan, extra sharing
  approvals and restricted access. The client has not made a final decision.
- Lesson 8 confirms Kuroda's dismissal, Northstar's dismissal of the involved
  consultant, and Ethan's formal warning and required training while retaining
  his role. Northstar is excluded, but Eastbridge is only still being considered.
  Daichi and Soo-jin are invited to help develop rules, not appointed chairs of
  a finished committee. Separate company breach reviews have begun.
- Lesson 9 confirms the contract award only three months later after fresh
  evaluation. Dinner in Shinjuku leads to Mika welcoming a new employee the
  next morning. She offers to guide him, without invented floors or room
  numbers, and encourages questions without sharing private disciplinary data.

No criminal verdict, damages, confession of deliberate rival delivery,
promotion, romance or sequel is invented. The workplace procedures and
disciplinary outcomes belong to this fictional story, not general legal advice.

## Persistence and Verification

```sh
bun scripts/apply-exploring-kyoto.ts --level=5 --chapter=5
bun test ./fluentxverse-server/tests/priceOfTruth.test.ts
node scripts/tests/new-paths.cjs --level=5 --chapter=5
```

Review the local fixtures under `output/the-price-of-truth/` before the guarded
writer's `--write --expected=...` step. It checks an exact snapshot, takes a
private backup and verifies full saved records. It refuses to overwrite a
published lesson. Existing IDs, compatible artwork, fixed feedback and other
caller properties are preserved by the builder. No checkpoint record or
learner evidence is deleted or rewritten. Saving drafts is separate from
publication, application deployment and Git push.

Saved and verified on 2026-11-14: eight drafts, full database read-back and all
eight records returned through the running lesson service match the authored
content. Fifty-six content/curriculum/checkpoint tests and 33 read-only browser
cases passed. Existing project-wide TypeScript errors remain, with none in the
new source or tests. Level 5 now has 32 regular lessons across Chapters 1, 3, 4
and 5; Chapter 2 is still absent. No deployment, publication or Git push.
