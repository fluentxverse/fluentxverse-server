# Level 7, Chapter 3: Behind the Contract

Eight directly authored lessons continuing Beyond the Spotlight from the
owner's Chapter 3 outline. The owner-confirmed **TOEIC 550–780** range governs
the wording, overriding the reference's C1–C2 subtitle. English only; no external
model calls, application AI credits, new artwork or romantic subplot.

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | The Offer on the Table | Speaking | Clarify a proposal before committing |
| 2 | Read the Fine Print | Listening | Identify payment conditions and ask for clarification |
| 3 | Creative Control | Reading | Balance professional feedback with artistic priorities |
| 4 | A Bigger Budget, A Bigger Price | Speaking | Compare scenarios and trade-offs |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | Who Owns the Music? | Speaking | Distinguish composition and recording rights questions |
| 7 | Divided Opinions | Speaking | Clarify team concerns and competing priorities |
| 8 | Across the Negotiating Table | Reading | Explain a counterproposal and its open status |
| 9 | The Decision | Speaking | Explain a reviewed commitment and query a proposed timetable |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Current Pointers

- Exactly four Step A expressions, English meanings and italic contextual
  examples with the expression highlighted. No vocabulary cards or Japanese.
- Lesson objective first, then situation. Apply situations are plain English,
  with comprehension questions in separate structured tutor-guide fields.
- Direct character roles, natural tutor-first openings and ten alternating
  turns in short speaking models. No required long speech.
- **Pronunciation only in Step B.** No Learn Part III. Part II transitions
  directly to Step B. Two phrases teach linking or meaning groups with complete
  examples and precise bold stress. No IPA, reading-cue or accent commentary.
- Two distinct short listening messages remain tutor-only. Reading missions
  have fresh visible notes. Six/four keyed exercises, Useful Language frames,
  optional discussion topics, standard guides and fixed English feedback remain.
  Actual learner mistakes and notes support dynamic checkpoints.

Introductions are 57–62 words, speaking models 114–140 words, listening messages
84/80 words, and reading sources/notes 104–117 words. Goals have 10–14 words.
All fit the established Level 7 budgets.

## Scope, Sequence and Evidence

Monday's full offer follows Chapter 2's invitation to discuss. The proposed
facilities, international distribution and promotion are opportunities rather
than achieved international success. Apex's producers would have considerable
input. The team requests full terms and review time without accepting.

The next afternoon, Ms. Hayashi explains the fictional proposal. A master is
the original recorded version used for copies and releases. Apex's proposed
control concerns covered recordings for an unspecified extended period. The
advance is paid upfront against future royalties, with specified recoupable
costs recovered before additional recording royalties under these terms. The
source gives no rates, amounts, precise duration, all-cost deduction, personal
repayment obligation or deduction from concert or songwriting income.

A week later, the producer suggests a more conventional direction, shorter
songs, stronger hooks and possible collaborators. Kai may still write his own
material, with commercial release aims. Suggestions are not recorded revisions,
and meaningful input is a priority rather than a settled final veto.

Financial scenarios explore possible outcomes without invented numbers or
guaranteed income. A larger budget may increase exposure, while earnings also
depend on costs, revenue and terms. Independence offers control with financial
risk; neither path is presented as automatically superior.

Composition rights and rights in a particular recording remain distinct in the
lawyer's explanation. Outcomes depend on creation and agreements. Limited
licensing, a defined period and clearer approval begin as proposals. The lesson
does not turn that fictional explanation into jurisdiction-specific legal
advice or a guarantee that every limited licence preserves every right.

Jisoo's enthusiasm and Luis's concern are competing priorities rather than
disloyalty. Kai recognises that he should ask about future roles. The current
offer guarantees no continuing team involvement. The team proposes management
and creative coordination without promising exact jobs, fees or unchanged work.

The following week's counterproposal covers **two new singles**, defined
expenses, a limited licensing period and meaningful creative approval, with
Spotlight Works continuing in management and creative coordination. Apex raises
a risk concern; Maya explains the opportunity to evaluate a smaller partnership.
The **two-hour** meeting ends without a final agreement.

Several days later, a revised two-single licensing partnership includes defined
recoupable expenses and a limited period. Kai retains his **existing independent
recordings**; new release rights and approvals are outlined without an invented
ownership allocation, exact duration or complete veto. Natsumi and Ms. Hayashi
review the final documents. Kai decides voluntarily and signs after legal review.

During the dinner celebration, Apex proposes immediate recording and a
promotional tour across several major **Japanese cities**. The fame joke does
not establish international stardom. No exact cities, dates, accepted itinerary,
completed recording, completed tour or resolved preparation schedule is supplied.
End with the new workload and the question of adequate preparation time.

The Japanese promotional article titles pasted above the storyline supply no
additional fictional events. They are not used as lesson text, artwork sources,
or evidence that Kai works at a real studio or with a real artist.

## Verification and Persistence

```sh
bun scripts/apply-exploring-kyoto.ts --level=7 --chapter=3
bun test ./fluentxverse-server/tests/contract.test.ts ./fluentxverse-server/tests/algorithm.test.ts ./fluentxverse-server/tests/spotlight.test.ts ./fluentxverse-server/tests/naturalPronunciation.test.ts ./fluentxverse-server/tests/checkpointLesson.test.ts ./fluentxverse-server/tests/conversationalCurriculum.test.ts
node scripts/tests/new-paths.cjs --level=7 --chapter=3
```

Review `output/behind-the-contract/lesson-*.json` before supplying the fresh
snapshot digest with `--write --expected=...`. The existing guarded Memgraph
writer creates a private backup and verifies full records after saving. It
preserves existing identities, artwork, publication states, fixed English
feedback and learner properties. Dynamic slots 5/10 and saved personalized
reviews, notes and marks are not regenerated. Saving drafts is separate from
publication, server-policy deployment and Git push.

Saved and verified November 15, 2026: eight new drafts and chapter metadata,
private backup and full-record read-back. All 48 targeted tests and 33 renderer
cases passed. Representative desktop/mobile screenshots were inspected. Full
server typecheck retains the existing 159 diagnostics elsewhere, with none in
this chapter or its tests. Nothing published, deployed or pushed.
