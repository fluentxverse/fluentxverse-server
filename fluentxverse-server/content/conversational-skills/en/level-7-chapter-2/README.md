# Level 7, Chapter 2: The Algorithm Never Sleeps

Eight directly authored episodes continuing Beyond the Spotlight from the
owner's supplied Chapter 2 outline. **TOEIC 550–780** remains the owner's
Level 7 target, overriding the reference's C1–C2 subtitle. English only.
No external model API, application AI credits, new artwork or romance is used.

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | The Damage Is Done | Speaking | Compare response options and disagree calmly |
| 2 | The Full Picture | Listening | Explain evidence and a mixed response |
| 3 | The Power of a Fan Community | Reading | Interpret support and encourage respectful discussion |
| 4 | An Unexpected Interview | Speaking | Clarify scope and prepare clear points |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | Something Doesn’t Add Up | Speaking | Separate patterns, possible causes and proof |
| 7 | The Interview | Speaking | Correct an impression without attacking others |
| 8 | Back on the List | Reading | Explain reinstatement and confirm readiness |
| 9 | A Different Kind of Spotlight | Speaking | Discuss interest before accepting an agreement |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Current Pointers

- Exactly four Step A expressions with English meanings and italic contextual
  examples highlighting the expression. No vocabulary cards or translations.
- Objective first, then situation. Apply situations are plain text, with
  comprehension questions in separate structured tutor-guide fields.
- Direct character roles, natural tutor-first openings and ten short alternating
  turns in speaking models. No required long speech.
- **Only Step B contains pronunciation.** No Part III. Two phrases teach linking
  or meaning groups, with full examples and precise bold stress. Part II leads
  directly to Step B; there is no commentary about IPA, reading cues or accents.
- Two short, distinct listening messages remain tutor-only. Reading missions
  have fresh visible notes. Six/four keyed exercises, five Useful Language
  frames, optional topics, standard guides and fixed English feedback remain.
  Learner notes and actual errors remain evidence for dynamic checkpoints.

Introductions are 58–61 words, speaking models 118–132 words, listening messages
78/74 words, and reading sources/notes 102–113 words. Goals have 12–13 words.

## Continuity and Evidence

The chapter opens with the showcase invitation still on hold. Tuesday's meeting
ends with a response decision. The following afternoon, the venue permits the
team to publish the full footage with an explanation. Thousands watch the
correction; some apologise while others keep arguing. This is neither a new
sales figure nor proof that every viewer now supports Kai.

Fan support is unsolicited. The photograph, audience memory and collection of
funny moments offer personal perspectives, not universal approval or evidence
about the editor. The team appreciates support without encouraging attacks.

Friday's preliminary call with independent journalist Rika Morimoto clarifies
music, controversy and public expectations. Difficult questions remain part of
the interview. The call provides no editorial control and is not identified
as one of Chapter 1's two publication enquiries.

Luis observes almost identical captions and close posting times. These establish
a pattern, not its cause. Coordination, copying and automated reposting remain
possibilities. The team documents and reports the concern through available
platform channels; no culprit, verdict, account removal or specific platform
procedure is invented. The chapter title does not establish manipulation by
an algorithm.

Monday's interview is completed before its later publication. Kai recognises
the impression created by the edit and his communication responsibilities while
explaining that he laughed at his own missed lyrics. He does not admit to
mocking fans or attack critics.

The published interview receives an encouraging response. Organisers review
the full footage and team response before reinstating the invitation for next
month. Do not claim that the interview alone caused reinstatement. Kai tells
the team he is ready; Natsumi must communicate that confirmation. Jisoo prepares
promotion, while Luis suggests rehearsal filming. The suggestion is not footage
already filmed or published.

A month later, Kai performs successfully at the Tokyo showcase. Paper Skyline
was officially released earlier that week. Mr. Shibata from the fictional
major company Apex Entertainment invites discussion of a possible recording
agreement. Interest is not a signed deal. No formal terms, financial amounts,
ownership provisions or creative restrictions are supplied. The team needs to
understand the terms and expectations; Kai's final decision remains open.

The agency, media reaction and company conversations are fictional story
material. No current social-platform claims or legal advice are required.

## Verification and Persistence

```sh
bun scripts/apply-exploring-kyoto.ts --level=7 --chapter=2
bun test ./fluentxverse-server/tests/algorithm.test.ts ./fluentxverse-server/tests/spotlight.test.ts ./fluentxverse-server/tests/naturalPronunciation.test.ts ./fluentxverse-server/tests/checkpointLesson.test.ts ./fluentxverse-server/tests/conversationalCurriculum.test.ts
node scripts/tests/new-paths.cjs --level=7 --chapter=2
```

Review `output/the-algorithm-never-sleeps/lesson-*.json`, then use the fresh
snapshot digest with `--write --expected=...`. The established Memgraph writer
uses a private backup, concurrency guard and full-record read-back. It preserves
existing identities, artwork, states, fixed English feedback and learner
properties. Checkpoints 5/10 remain dynamic; saved reviews, notes and marks are
not regenerated. Draft saving is separate from publication, deployment and push.

The local Level 7 checkpoint and validation policies from Chapter 1 remain in
place. No server-policy deployment or new checkpoint generation is part of this
chapter-authoring task.

Saved and verified November 15, 2026: eight new drafts and chapter metadata,
with a private backup and full-record read-back. All 38 targeted tests and 33
renderer cases passed. Representative desktop/mobile screenshots were visually
inspected. The full server typecheck has the existing 159 diagnostics elsewhere,
with none in this chapter or its tests. Nothing published, deployed or pushed.
