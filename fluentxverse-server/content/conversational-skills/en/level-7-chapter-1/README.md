# Level 7, Chapter 1: Before the Spotlight

Beyond the Spotlight begins with eight English-only lessons following Maya,
Natsumi, Jisoo, Luis and Kai at the fictional Spotlight Works agency in Shibuya.
The owner explicitly confirmed **TOEIC 550–780 for Level 7** on November 15,
2026. That target overrides the reference's C1–C2 subtitle.

All copy is written directly in the coding conversation. No external model
API, model probe, application AI credits, images or romantic subplot are used.

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | Welcome to the Industry | Speaking | Clarify roles and realistic expectations |
| 2 | The Sound of Something New | Listening | Understand focused creative feedback |
| 3 | Selling the Sound | Reading | Explain a modest combined campaign |
| 4 | Lights, Camera, Disaster | Speaking | Coordinate an alternative after equipment failure |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | The Fans Have Spoken | Speaking | Separate observations, opinions and assumptions |
| 7 | A Night at the Live House | Speaking | Recognise a mistake, recovery and completion |
| 8 | Going Viral | Reading | Report attention, enquiries and a changed caption |
| 9 | The Clip That Changed Everything | Speaking | Explain missing context and a paused invitation |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Current Pointers

- English only, with exactly four Step A expressions. Each has an English
  meaning and an italic contextual example highlighting the expression.
- The lesson objective comes first, then the situation. Situation fields are
  plain text; questions remain in separate structured fields.
- Direct character roles and natural tutor-first openings. Speaking models
  have ten short alternating turns.
- **Pronunciation exists only in Step B.** No Part III pronunciation. Two
  relevant phrases have linking or meaning-group guides and full examples,
  with exact stressed words/syllables in bold. No extra pronunciation commentary.
- Two distinct short listening messages are tutor-only. Reading challenges
  use fresh visible notes. Six/four keyed exercises, Useful Language, optional
  discussion topics, standard tutor guides and fixed English feedback remain.
  Actual errors and notes support future reviews; no weakness is invented.

Introductions are 57–63 words, speaking models 117–130, listening sources 76/72,
and reading sources/notes 103–121. These fit the same budgets as Level 6.

## Evidence and Continuity

Maya has advertising experience but is new to music work. The five-person cast
and agency are separate from earlier stories. Jisoo and Luis have no unprovided
nationalities or personal histories. Paper Skyline is an upcoming debut single.
A revised arrangement and a completed shoot do not establish its release.

Short-video and visual proposals become a modest combined campaign. No exact
budget or release date is added. Both lights fail; daylight, adjusted settings
and a revised shot list allow filming in three of four remaining hours.

The first promotional video draws thousands of views. The later live clip draws
hundreds of thousands. Comparisons are opinions, release questions show interest,
and views are not sales. The audience laughs with Kai after his own lyric error.
He recovers and finishes. Luis records it, but the uploader/editor is unknown.

The first viral caption links the laughter to the mistake. Two publication
enquiries are not booked interviews. Another version draws less friendly
comments. The final episode establishes that it omits the lyric error and
claims he mocked fans. The original recording supports a planned factual reply;
no published correction or restored reputation is established.

Comments demanding stopped bookings are not a confirmed venue ban. The major
showcase invitation is **on hold until resolution**, rather than permanently
cancelled or restored. Editor identity and motives remain unknown. End on the
cliffhanger, without inventing a resolution or later chapter.

The agency, song, clips, counts and industry conversations are fictional
reference material. The campaign suggestions belong to the characters; they
are not current platform advice or claims about real music professionals.

## Verification and Persistence

```sh
bun scripts/apply-exploring-kyoto.ts --level=7 --chapter=1
bun test ./fluentxverse-server/tests/spotlight.test.ts
node scripts/tests/new-paths.cjs --level=7 --chapter=1
```

Review `output/before-the-spotlight/lesson-*.json`, then supply the fresh digest
with `--write --expected=...`. Persistence uses Memgraph, a private backup,
concurrency protection and full-record read-back. IDs, artwork, statuses,
fixed English feedback and learner properties are preserved. Slots 5/10 remain
dynamic; saved notes, marks and personalized checkpoints are not regenerated.
Draft saving is separate from publication, deployment and Git push.

Local English-only validation and future-checkpoint composition include Level 7.
Reviews draw expressions and pronunciation from all four source lessons. These
server-policy changes require deployment to affect live publishing or new
checkpoint generation. Existing saved reviews remain unchanged.

Saved and verified November 15, 2026: eight new drafts, chapter metadata, level
topic, private backup and full-record read-back. Seventy-five targeted tests
and 33 renderer cases passed. Representative desktop/mobile screenshots were
visually inspected. The full server typecheck retains the existing 159
diagnostics elsewhere, with none in the new chapter or changed policy code.
