# Level 6, Chapter 3: The Taste of Tradition

Eight English-only lessons continue Threads of Tradition from the completed
Hands of the Future screening into Mei's Kyoto culinary heritage event.
The owner's TOEIC **550–780** authoring target replaces the reference's C1 label.
All content is written directly in the coding conversation. No external model
API, model-availability probe, application AI credits or new images are used.

| Lesson | Title | Skill | Communication Focus |
| --- | --- | --- | --- |
| 1 | An Invitation to the Table | Speaking | Propose an event and agree on respectful contributions |
| 2 | The Flavors of Home | Listening | Connect seasonal cooking with personal memories |
| 3 | A Taste Worth Preserving | Reading | Distinguish methods and explain producer perspectives |
| 4 | The Secret of Time | Speaking | Ask about experience, time and monitoring |
| 5 | Personalized Checkpoint | Review | Dynamic review of Lessons 1–4 |
| 6 | The Recipe Nobody Can Have | Speaking | Make a sensitive request and accept a refusal |
| 7 | A Question of Ownership | Speaking | Balance access with voluntary sharing |
| 8 | More Than Just a Recipe | Reading | Explain the accepted programme and its limits |
| 9 | What Remains at the Table | Speaking | Thank a contributor and confirm a new offer's scope |
| 10 | Personalized Checkpoint | Review | Dynamic review of Lessons 6–9 |

## Authoring Pointers

- English only: no Japanese translations or bilingual fallback labels.
- Step A has exactly four expressions per lesson, each with an English meaning
  and an italic example highlighting the expression. Part II discussion leads directly to Step B; Part III pronunciation is removed.
- **STEP B: PRONUNCIATION** follows the owner's table reference. A short tip,
  two phrases, reading guides and full examples teach linking and meaning
  groups. Bold marks exactly the stressed words or syllables, rather than the
  whole sentence. Capitals in guides show matching stress; ‿ shows a link and
  | a possible pause. Keep the tip focused on how to practise; omit extra commentary about guides or accents.
- The lesson objective precedes the situation. Situation fields are plain
  text with separate structured questions. Tutors start roleplays in character;
  speaking models have ten short alternating turns and direct named roles.
- Listening scripts remain tutor-only. Reading missions have fresh visible
  notes. Six/four exercises have full keys, with five Useful Language frames,
  three optional discussion topics and the standard fixed English feedback.
  Record actual errors and notes; do not invent checkpoint weaknesses.

Introductions are 58–65 words, speaking models 116–123 words, listening scripts
79/65 words, and reading sources/notes 103–121 words. These fit the established
Level 6 budgets. No required speeches, alternate-role disclaimers or romance.

## Story and Cultural Care

Mei's invitation follows the completed documentary, not a newly confirmed
film trip. No opening budget, menu price, venue or event date is invented.
The restaurant meal is an example of Kyoto-style home cooking, not a fixed
obanzai formula, dietary assurance or universal price claim. Haru's memory is
personal, and his bill comment is humour rather than a real restaurant quote.

The pickle-shop visit distinguishes quick preparations from longer
fermentation. It does not claim every pickle is fermented or supply one
readiness timetable. The Yuasa visit describes interacting factors in flavour
and the role of monitoring. It does not supply home fermentation instructions,
temperatures, safety tests or an operational recipe. Traditional and modern
methods are not ranked universally; Haru compares experience with dyeing,
rather than claiming identical processes.

Mrs. Okabe's refusal remains valid. She teaches the private grandmother recipe
to her granddaughter and agrees to share stories. Neither story permission nor
event participation automatically grants access to private cooking details.
The ethical discussion is not presented as a legal ruling on recipe ownership.

Mei decides on voluntary participation before the organisers accept her plan
in Lesson 8. Mrs. Okabe's “perhaps one day” is not a scheduled public class.
The final handwritten card is her own **different** seasonal recipe, offered
for students and visitors; it does not reveal the private recipe or grant an
unlimited commercial licence. Respect is not a tactic rewarded with access to
the secret. Young visitors' interest does not mean enrolment or confirmed
training. End at Mei's restaurant with the cleaning joke, without a sequel.

Primary sources checked November 15, 2026:

- [Kyoto Travel](https://kyoto.travel/en/food-and-drink/) and the
  [Kyoto Food Industry Association](https://www.syoku-kyoto.com/en/ren-ding-burando/kyo-souzai):
  obanzai's connection to Kyoto home cooking and seasonal ingredients.
- [MAFF: Kyo Tsukemono](https://www.maff.go.jp/e/policies/market/dento_syoku/menu/kyo_tsukemono.html):
  differing Kyoto pickle varieties and methods, rather than one process.
- [JNTO: Japan's Essential Seasoning](https://www.japan.travel/en/gastronomy/article-japans-essential-seasoning/):
  Yuasa's soy-sauce heritage and traditional fermentation setting.

These sources support general cultural background. Characters, conversations,
the family recipes, project notes and event are fictional. The actual recipes
are not invented. Language trivia is original, without copied source passages.

## Verification and Persistence

```sh
bun scripts/apply-exploring-kyoto.ts --level=6 --chapter=3
bun test ./fluentxverse-server/tests/tasteTradition.test.ts
node scripts/tests/new-paths.cjs --level=6 --chapter=3
```

Review `output/the-taste-of-tradition/lesson-*.json` before supplying the fresh
snapshot digest with `--write --expected=...`. The existing guarded writer uses
Memgraph, a private backup, transactional concurrency checks and complete
read-back. Identities, artwork, publication states, fixed feedback and learner
properties are preserved. Checkpoints 5/10 stay dynamic; existing notes, marks
and saved reviews are not rewritten. Saving drafts is not publication or
application deployment.

Saved and verified November 15, 2026: eight new drafts and chapter metadata,
private backup and full-record read-back. Fifty targeted tests and 33 Chapter 3
browser cases passed; the two earlier chapters passed another 66 renderer cases
for their saved pronunciation update. Representative desktop/mobile screenshots
were visually inspected. The full server typecheck still reports 159 existing
diagnostics elsewhere, with none in the new chapter or pronunciation changes.
No publication, deployment or model invocation was performed.
