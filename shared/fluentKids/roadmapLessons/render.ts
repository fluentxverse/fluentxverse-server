import type { Bilingual, Picture, Question, RoadmapLesson, SpeakingTask, StudyCard, StudyTable } from './content';

interface LessonHeading {
  id: string;
  title: string;
  level: number;
  unit: number;
  unitTitle: string;
  number: number;
}

const sections = [
  ['intro', 'Hello', 'はじめよう', 'Introduce', 'はじめに', 1],
  ['learn', 'Look and read', '見て読もう', 'Learn · Step A', '学ぼう・ステップA', 4],
  ['language', 'Say it', '言ってみよう', 'Learn · Step B', '学ぼう・ステップB', 3],
  ['story', 'Story time', 'お話の時間', 'Apply · Speaking', '使ってみよう・会話', 4],
  ['practice', 'Practice', 'れんしゅう', 'Exercise', 'れんしゅう', 4],
  ['mission', 'Your turn', 'きみのばん', 'Mission · Challenge 1', 'ミッション・チャレンジ1', 6],
  ['feedback', 'Good job', 'ふりかえり', 'Feedback', 'ふりかえり', 2],
] as const;

function escapeText(value: string) {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function bilingual([english, japanese]: Bilingual) {
  return `${escapeText(english)}<span class="kf-ja" lang="ja">${escapeText(japanese)}</span>`;
}

function picture({ key, alt }: Picture, className = '') {
  return `<img class="${className}" data-art="${escapeText(key)}" alt="${escapeText(alt)}">`;
}

function studyCards(cards: readonly StudyCard[]) {
  return `<div class="kf-look-say kf-roadmap-cards">${cards.map(card => `
    <article class="kf-look-card">
      ${card.picture ? picture(card.picture) : ''}
      <h3 class="kf-frame">${bilingual(card.title)}</h3>
      <p>${bilingual(card.text)}</p>
    </article>`).join('')}</div>`;
}

function studyTable(table: StudyTable) {
  return `<table class="kf-roadmap-table${table.layout === 'map' ? ' kf-park-map' : ''}">
    <caption>${bilingual(table.title)}</caption>
    <thead><tr>${table.columns.map(header => `<th scope="col">${bilingual(header)}</th>`).join('')}</tr></thead>
    <tbody>${table.rows.map(([name, ...values]) => `<tr>
      <th scope="row">${bilingual(name)}</th>
      ${values.map(value => `<td>${bilingual(value)}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table>`;
}

function question([prompt, answer, other, why, art]: Question, index: number) {
  const answerIndex = index % 2 === 0 ? 1 : 0;
  const choices = answerIndex === 1 ? [other, answer] : [answer, other];
  return `<div class="kf-picture-question" data-item="${index + 1}" data-answer="${answerIndex}" data-explanation="${escapeText(why[0])}" data-explanation-ja="${escapeText(why[1])}">
    <h3>${index % 4 + 1}. ${bilingual(prompt)}</h3>
    ${art ? `<div class="kf-word-art">${picture(art)}</div>` : ''}
    <div class="kf-choices">${choices.map(choice => `<button class="kf-choice" type="button" aria-pressed="false">${bilingual(choice)}</button>`).join('')}</div>
    <p class="kf-feedback" aria-live="polite"><span data-en></span><span class="kf-ja" lang="ja" data-ja></span></p>
  </div>`;
}

function speakingTask(task: SpeakingTask, age: '6-8' | '9-12') {
  return `<div class="kf-copy" data-age-content="${age}" ${age === '9-12' ? 'hidden' : ''}>
    <div class="kf-prompt"><strong>${bilingual(task.title)}</strong></div>
    <ol class="kf-checklist">${task.steps.map((step, index) => `<li><span>${index + 1}</span><div>${bilingual(step)}</div></li>`).join('')}</ol>
  </div>`;
}

function tutor(minutes: number, guidance: Bilingual) {
  return `<aside class="kf-teacher"><b>${bilingual([`Tutor guide · ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`, `先生用ガイド・${minutes}分`])}</b><p>${bilingual(guidance)}</p></aside>`;
}

export function renderRoadmapLesson(heading: LessonHeading, lesson: RoadmapLesson) {
  const { title, level, unit, unitTitle, number } = heading;
  const checkpoint = number === 5;
  const time = checkpoint ? 25 : 24;
  const targets: readonly Bilingual[] = [
    ['Look at the scene', '絵を見よう'],
    lesson.study,
    ['Practice the model lines', 'お手本のことばを使おう'],
    lesson.storyTitle,
    ['Read, listen, and choose', '読んで、聞いて、えらぼう'],
    lesson.missionTitle,
    ['Look what you can do!', 'できたことを見つけよう！'],
  ];
  const reviewQuestions = lesson.questions.slice(0, 4);
  const answers = lesson.questions.map(([, answer], index) =>
    bilingual([`${index + 1}. ${answer[0]}`, `${index + 1}. ${answer[1]}`]));
  const readings = lesson.table ? studyTable(lesson.table) : '';
  const content = [
    `<div class="kf-split">
      <div class="kf-scene">${picture(lesson.art)}</div>
      <div class="kf-prompt"><strong>${bilingual(lesson.opening)}</strong></div>
    </div>${tutor(1, ['Give the learner time to look and answer. Model one detail if needed.', '絵を見て答える時間をとります。必要なら、しるしやことばを一つ示します。'])}`,
    `${studyCards(lesson.cards)}${readings}
    ${tutor(4, ['Read or point to the examples. Ask the learner to find one detail they can use in the conversation.', 'お手本を読み、必要なら指します。会話で使えることを一つ見つけてもらいます。'])}`,
    `<div class="kf-split">${lesson.models.map(model => `<div class="kf-example">
      <h3 class="kf-example-head">${bilingual(model.title)}</h3><div class="kf-example-body"><p class="kf-frame">${bilingual(model.text)}</p></div>
    </div>`).join('')}</div>${tutor(3, ['Say each line aloud. Ask the learner to replace one detail and say the new sentence.', 'せりふを一つずつ声に出します。しるしやことばを一つかえて、新しい文で言ってもらいます。'])}`,
    `<div class="kf-split">
      <div class="kf-copy"><div class="kf-scene">${picture(lesson.art)}</div>
        <div class="kf-prompt"><strong>${bilingual(['Read with your tutor. Then swap roles.', '先生といっしょに読もう。それから役をこうたいしよう。'])}</strong><span>${bilingual(['Listen for details that help you answer the questions.', '質問に答えるヒントを聞き取ろう。'])}</span></div>
      </div>
      <div class="kf-dialogue">${lesson.dialogue.map(([speaker, line]) => `<div class="kf-line">
        <span class="kf-person" aria-hidden="true">${escapeText(speaker[0])}</span>
        <div class="kf-bubble"><b>${escapeText(speaker)}</b>${bilingual(line)}</div>
      </div>`).join('')}</div>
    </div>
    <div class="kf-part"><span>${bilingual(['Let’s check the story', 'お話をふりかえろう'])}</span></div>
    <div class="kf-questions">${reviewQuestions.map(([prompt], index) => `<div class="kf-question"><b>${index + 1}</b><div>${bilingual(prompt)}</div></div>`).join('')}</div>
    ${tutor(4, ['Ask the learner to point to the line that supports one answer. Go back to the reading cards as needed.', '答えがわかるせりふを指してもらいます。必要なら前のカードにもどります。'])}`,
    `<div class="kf-talk-strip"><div><p>${bilingual(['Use the example or dialogue to explain one choice. Say your answer aloud.', 'お手本か会話を使って、えらんだ理由を一つ伝えよう。答えを声に出そう。'])}</p></div></div>
    <div class="kf-part"><span>${bilingual(['A · Check the details', 'A・わかったことをたしかめよう'])}</span></div>
    <div class="kf-choice-grid">${reviewQuestions.map(question).join('')}</div>
    <div class="kf-part"><span>${bilingual(['B · Try it in conversation', 'B・会話で使ってみよう'])}</span></div>
    <div class="kf-choice-grid">${lesson.questions.slice(4).map((item, index) => question(item, index + 4)).join('')}</div>
    <div class="kf-actions"><button class="kf-check-action" data-check type="button">Check answers</button>
      <p class="kf-exercise-status" aria-live="polite"><span data-en></span><span class="kf-ja" lang="ja" data-ja></span></p>
    </div>
    <aside class="kf-teacher"><b>${bilingual(['Tutor guide · 4 minutes', '先生用ガイド・4分'])}</b>
      <ol class="kf-roadmap-answers">${answers.map(answer => `<li>${answer}</li>`).join('')}</ol>
    </aside>`,
    `<div class="kf-split">
      ${speakingTask(lesson.younger, '6-8')}${speakingTask(lesson.older, '9-12')}
      <div class="kf-example">
        <h3 class="kf-example-head">${bilingual(['Check what you tried', 'できたことをチェックしよう'])}</h3>
        <div class="kf-example-body">
          <div class="kf-pack-checks" role="group" aria-label="Lesson speaking checklist">${lesson.checks.map(check => `<label><input type="checkbox"><span>${bilingual(check)}</span></label>`).join('')}</div>
        </div>
      </div>
    </div>
    ${tutor(checkpoint ? 7 : 6, lesson.tutor)}
    <details class="kf-optional"><summary><div><p class="kf-kicker">${bilingual(['Challenge 2 · Optional · +2 minutes', 'チャレンジ2・時間があれば＋2分'])}</p><h3>${bilingual(['Try one more round', 'もう一回やってみよう'])}</h3></div></summary>
      <div class="kf-talk-strip"><p>${bilingual(lesson.bonus)}</p></div>
    </details>`,
    `<div class="kf-feedback-goal"><span class="kf-sound-icon" aria-hidden="true">★</span><div><p class="kf-kicker">${bilingual(['Our lesson goal', '今日のめあて'])}</p><strong>${bilingual(lesson.goal)}</strong></div></div>
    <h3>${bilingual(['How did it feel? Choose one.', 'どうだった？ 一つえらぼう。'])}</h3>
    <div class="kf-reflect" role="group" aria-label="How the lesson felt">${([
      ['Let’s try together', 'いっしょにやってみたい'],
      ['A little help, please', '少しヒントがほしい'],
      ['I can do it', 'ひとりでできるよ！'],
    ] as const).map(([en, ja]) => `<button class="kf-choice" data-reflect="${escapeText(en)}" data-reflect-ja="${escapeText(ja)}" aria-pressed="false" type="button"><strong>${bilingual([en, ja])}</strong></button>`).join('')}</div>
    <p class="kf-small kf-reflection-status" aria-live="polite"><span data-en>Tell your tutor what you’d like to try again.</span><span class="kf-ja" lang="ja" data-ja>もう一度やってみたいことを先生に伝えよう。</span></p>
    ${tutor(2, ['Use the checklist to name one thing the learner did well. Try one line again with a new detail.', 'チェックリストを使って、できたことを一つ伝えます。ことばを一つかえて、せりふをもう一度言ってもらいます。'])}`
  ];

  return `<div id="kids-full-lesson" class="kf-roadmap-lesson" aria-label="${escapeText(title)}" data-lesson="${escapeText(heading.id)}" data-japanese="true" data-tutor="false">
    <header class="kf-mast">
      <a class="kf-brand" data-course-link><span aria-hidden="true" class="kf-logo">f</span>Fluent Kids</a>
      <div class="kf-view" aria-label="Age version" role="group">
        <button aria-pressed="true" data-age="6-8" type="button">${bilingual(['Ages 6–8', '6〜8さい'])}</button>
        <button aria-pressed="false" data-age="9-12" type="button">${bilingual(['Ages 9–12', '9〜12さい'])}</button>
      </div>
      <div class="kf-view" aria-label="Lesson view" data-view-tools role="group">
        <button aria-pressed="true" data-view="student" type="button">${bilingual(['Student view', '子ども用'])}</button>
        <button aria-pressed="false" data-view="tutor" type="button">${bilingual(['Tutor guide', '先生用ガイド'])}</button>
      </div>
      <div class="kf-view"><button aria-label="Show Japanese translations" aria-pressed="true" data-japanese-toggle lang="ja" type="button">日本語</button></div>
    </header>
    <div class="kf-hero">
      <div>
        <p class="kf-kicker">${bilingual([`Level ${level} · Unit ${unit} · Lesson ${number}`, `レベル${level}・ユニット${unit}・レッスン${number}`])}</p>
        <h1>${bilingual([title, lesson.titleJa])}</h1>
        <p class="kf-objective">${bilingual(lesson.goal)}</p>
        <div class="kf-lesson-tags">
          <span>${bilingual([checkpoint ? `${unitTitle} checkpoint` : unitTitle, checkpoint ? `「${lesson.unitJa}」のまとめ` : lesson.unitJa])}</span>
          <span>${bilingual([`${time} minutes`, `${time}分`])}</span>
          <span>${bilingual(['+2 minutes optional', '時間があれば＋2分'])}</span>
        </div>
      </div>${picture(lesson.art, 'kf-hero-art')}
    </div>
    <nav aria-label="Lesson sections" class="kf-map">${sections.map(([id, en, ja], index) => `<a href="#kf-${id}"><b>${index + 1}</b><span class="kf-nav-copy">${bilingual([en, ja])}</span></a>`).join('')}</nav>
    <div class="kf-main">${sections.map(([id, , , en, ja, minutes], index) => {
      const duration = checkpoint && id === 'mission' ? minutes + 1 : minutes;
      return `<section class="kf-section" id="kf-${id}">
        <div class="kf-section-head">
          <span class="kf-number">${index + 1}</span>
          <div><p class="kf-kicker">${bilingual([en, ja])}</p><h2>${bilingual(targets[index])}</h2></div>
          <span class="kf-time">${bilingual([`${duration} ${duration === 1 ? 'minute' : 'minutes'}`, `${duration}分`])}</span>
        </div>
        ${content[index]}
      </section>`;
    }).join('')}</div>
    <footer class="kf-footer"><a href="#kids-full-lesson">${bilingual(['Back to the top ↑', 'ページのはじめへ'])}</a></footer>
  </div>`;
}
