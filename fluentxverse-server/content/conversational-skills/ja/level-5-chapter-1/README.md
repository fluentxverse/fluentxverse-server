# Level 5, Chapter 1: First Impressions

The revised **Tokyo After Hours** reference is a workplace friendship and
mystery story, not a romance. Mika joins Eastbridge Creative in Tokyo after
moving from Osaka. Ethan is from Bristol; Soo-jin is from Seoul. Daichi checks
research and financial reports. No link to the completed Kyoto cast is invented.

| Lesson | Title | Skill |
| --- | --- | --- |
| 1 | Welcome to Eastbridge | Speaking |
| 2 | The Big Announcement | Listening |
| 3 | Different Ways of Thinking | Reading |
| 4 | Beyond the Office | Speaking |
| 5 | Personalized Checkpoint | Dynamic review of Lessons 1-4 |
| 6 | A Question of Responsibility | Speaking |
| 7 | Handle with Care | Speaking |
| 8 | A Difficult Conversation | Reading |
| 9 | The Unexpected File | Speaking |
| 10 | Personalized Checkpoint | Dynamic review of Lessons 6-9 |

## Current Language Target

Use the owner's **TOEIC 225-545 authoring range**, not the reference CEFR label.
Level 5 shares Level 4's language band; a workplace plot does not imply advanced
grammar. The score range is not a CEFR conversion or a test-score guarantee.

The approved, editorially corrected episodes are versioned in
`../toeic-revisions-v1/L5-C1-*.json`. Both the chapter builder and
`buildToeicLesson()` use this new outline. The wrapper keeps simple /s/-/z/
pronunciation pairs. Goals start with “I can”; speaking uses ten alternating
turns with no more than 115 words. Each private listening script is at most
70 words; each reading passage is at most 145 words.

Six vocabulary items, Part II discussion, two tips, six/four keyed exercises,
Japanese support, Useful Language, standardized guides, actual-error notes and
the fixed Range/Accuracy/Fluency rubric remain. No new artwork is generated.

## Revised Story

Mika arrives fifteen minutes early and meets the team. The hotel campaign aims
to attract international travellers while keeping a high-quality image. The
project has not yet been won. Ethan and Daichi suggest different guest groups;
Mika proposes two messages with one consistent hotel style. The team still
needs to check information before deciding.

The Shinjuku dinner builds coworker friendship through moving-city experiences.
There are no dating questions. With two weeks to prepare the proposal, Mika
suggests a shared responsibility list rather than assumed assignments.

The newer financial report is current after client feedback. Daichi explicitly
says to keep the older version for reference. Later it disappears. The chapter
does not retain the obsolete attachment-error or deleted-proposal plot.

An incomplete argument remains unexplained. The fresh reading challenge gives
Mika a work note, not proof of a leak. At the printer she then recognises old
figures and **Northstar Media** on confidential proposal pages. These details
are visible in the learner situation and dialogue, not only in a tutor key.
Daichi asks her to close the door. No culprit or explanation is supplied.

## Authoring

```sh
bun scripts/apply-exploring-kyoto.ts --level=5 --chapter=1
bun test ./fluentxverse-server/tests/firstImpressions.test.ts
node scripts/tests/new-paths.cjs --level=5 --chapter=1
```

Use a fresh reviewed snapshot digest with `--write --expected=...` to save.
The updater backs up Memgraph records, preserves IDs and fixed feedback,
refuses non-draft replacement, detects concurrent edits and verifies read-back.
It does not publish, deploy, modify learner records or create static checkpoints.
Raw backups and browser output are not source-release artifacts.
