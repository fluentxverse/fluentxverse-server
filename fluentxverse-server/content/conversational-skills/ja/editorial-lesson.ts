import type { Episode } from './level-3-chapter-1/new-beginning';
import { basicGrammar, comprehensionChoices, speakingLines } from './editorial-grammar';

type Pair = [string, string];
export interface SimpleLesson {
  intro: Pair;
  goal: Pair;
  words: Episode['words'];
  grammar: keyof typeof basicGrammar;
  model?: string[];
  text?: string;
  questions: Pair[];
  wrong: string[];
  task: Pair;
  prompts: string[];
  useful: string[];
  missionText?: string;
  trivia: Pair;
  triviaQuestion: Pair;
}

const topics: Record<number, Episode['topics']> = {
  2: [['DAYS OUT', ['Where do you like to go?', 'Who do you go with?', 'What do you take?']], ['SHOPPING', ['What do you like to buy?', 'Do you pay by card?', 'What gift would you choose?']], ['TRAVEL PLANS', ['How do you travel?', 'What time do you like to start?', 'What do you do on a rainy day?']]],
  3: [['DAILY LIFE', ['What time do you start work or study?', 'When do you have dinner?', 'What do you do on Sundays?']], ['HELPING', ['Who helps you?', 'How can you help a friend?', 'How do you say thank you?']], ['TALKING TO FRIENDS', ['What do you talk about?', 'How do you invite a friend?', 'What can you say when you do not understand?']]],
  4: [['WORK', ['What work do you enjoy?', 'Do you like working with others?', 'What would you like to learn?']], ['PLANNING', ['How do you remember a date?', 'Who can help with a plan?', 'What do you check first?']], ['IDEAS', ['What would you like to make?', 'Who can you ask for help?', 'How do you say you like an idea?']]],
  5: [['KEEPING IN TOUCH', ['Do you call or send messages?', 'When do you call a friend?', 'What do you say when you are busy?']], ['CHANGING PLANS', ['What do you say when you are late?', 'Who needs to know about a change?', 'How do you choose a new time?']], ['LISTENING', ['What helps you listen?', 'How do you ask someone to repeat?', 'How do you show you understand?']]],
};

export function editSimpleLesson(source: Episode, chapter: number, copy: SimpleLesson): Episode {
  const e = structuredClone(source);
  const grammar = basicGrammar[copy.grammar];
  Object.assign(e, { intro: copy.intro, goal: copy.goal, words: copy.words, tips: structuredClone(grammar.tips), choose: structuredClone(grammar.choose),
    warmup: 'What can you say in this situation?',
    discussion: ['II. Use two of the new expressions to talk about this situation.', 'この場面について、新しい表現を二つ使って話しましょう。'],
    followup: 'What question can you ask next?', topics: structuredClone(topics[chapter]), trivia: copy.trivia, triviaQuestion: copy.triviaQuestion,
    choices: comprehensionChoices(copy.questions, copy.wrong),
  });
  e.apply.questions = copy.questions;
  if (e.skill === 'speaking') {
    e.apply.dialogue = speakingLines(e.apply.roles!, copy.model!);
    delete e.apply.text;
  } else {
    e.apply.text = copy.text ?? e.apply.text;
    delete e.apply.roles;
    delete e.apply.dialogue;
  }
  Object.assign(e.mission, { task: copy.task, lines: copy.prompts, useful: copy.useful });
  if (copy.missionText) e.mission.text = copy.missionText;
  if (e.skill === 'speaking') delete e.mission.text;
  return e;
}
