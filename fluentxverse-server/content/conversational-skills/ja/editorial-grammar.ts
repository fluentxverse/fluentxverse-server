import type { Episode } from './level-3-chapter-1/new-beginning';

type Pair = [string, string];
export const basicGrammar = {
  plans: {
    tips: [{ rule: ['Use can + verb to offer help.', 'can ＋動詞で、手伝えることを伝えます。'], examples: [['I can help you.', 'お手伝いできます。']] }, { rule: ['Use Let’s + verb to suggest an action.', 'Let’s ＋動詞で行動を提案します。'], examples: [['Let’s check the time.', '時刻を確認しましょう。']] }],
    choose: [['I can (help / helps) you.', 'help'], ['Let’s (check / checked) the time.', 'check'], ['Can you (come / comes) too?', 'come'], ['We can (meet / meets) here.', 'meet'], ['Let’s (ask / asked) first.', 'ask'], ['I can (bring / brings) it.', 'bring']],
  },
  questions: {
    tips: [{ rule: ['Use How much ...? to ask a price.', 'How much ...? で値段を尋ねます。'], examples: [['How much is this?', 'これはいくらですか。']] }, { rule: ['Use Can I + verb? to ask politely.', 'Can I ＋動詞? で丁寧に尋ねます。'], examples: [['Can I pay by card?', 'カードで払えますか。']] }],
    choose: [['How (much / many) is this?', 'much'], ['Can I (pay / paid) by card?', 'pay'], ['I would (like / likes) two.', 'like'], ['What is (inside / between) this box?', 'inside'], ['How many cups (do / does) you need?', 'do'], ['Is the bag (free / freely)?', 'free']],
  },
  descriptions: {
    tips: [{ rule: ['Use There is for one thing and There are for two or more.', '一つには There is、二つ以上には There are を使います。'], examples: [['There is a path.', '道があります。']] }, { rule: ['Use Can you + verb? to ask for help.', 'Can you ＋動詞? で手伝いを頼みます。'], examples: [['Can you take a photo?', '写真を撮ってもらえますか。']] }],
    choose: [['There (is / are) a path.', 'is'], ['There (are / is) two trees.', 'are'], ['Can you (take / took) a photo?', 'take'], ['The trees (are / is) tall.', 'are'], ['Please (stand / stood) here.', 'stand'], ['Can I (see / saw) it?', 'see']],
  },
  directions: {
    tips: [{ rule: ['Use a verb first to give a short instruction.', '動詞から始めて、短い指示を伝えます。'], examples: [['Check the note.', 'メモを確認してください。']] }, { rule: ['Use Do not + verb for something to avoid.', 'Do not ＋動詞で、してはいけないことを伝えます。'], examples: [['Do not use this one.', 'こちらは使わないでください。']] }],
    choose: [['Please (check / checked) the note.', 'check'], ['Do not (use / used) this one.', 'use'], ['(Read / Reads) it first.', 'Read'], ['Can you (help / helps) me?', 'help'], ['Please (wait / waited) here.', 'wait'], ['We need (to / for) check.', 'to']],
  },
  feelings: {
    tips: [{ rule: ['Use I feel + feeling to say how you feel.', 'I feel ＋気持ちを表す語で、自分の気持ちを伝えます。'], examples: [['I feel worried.', '心配です。']] }, { rule: ['Use I do not know to say a detail is unknown.', 'I do not know で、分からないことを伝えます。'], examples: [['I do not know her name.', '彼女の名前は分かりません。']] }],
    choose: [['I (feel / feels) worried.', 'feel'], ['She (is / are) upset.', 'is'], ['I do not (know / knows) her name.', 'know'], ['Do you (know / knew) him?', 'know'], ['I am (sorry / sorrow).', 'sorry'], ['Can we (talk / talks)?', 'talk']],
  },
  past: {
    tips: [{ rule: ['Use the past form to say what happened.', '過去形で、起きたことを伝えます。'], examples: [['I worked yesterday.', '昨日働きました。']] }, { rule: ['Use did not + verb to say what did not happen.', 'did not ＋動詞で、しなかったことを伝えます。'], examples: [['I did not call.', '電話しませんでした。']] }],
    choose: [['I (worked / work) yesterday.', 'worked'], ['I did not (call / called).', 'call'], ['Did you (ask / asked) her?', 'ask'], ['We (were / was) busy yesterday.', 'were'], ['She (was / were) at work.', 'was'], ['I (sent / send) the message yesterday.', 'sent']],
  },
  future: {
    tips: [{ rule: ['Use will + verb for a future action.', 'will ＋動詞で、これからすることを伝えます。'], examples: [['I will send a message.', 'メッセージを送ります。']] }, { rule: ['Use before or after to show the order.', 'before や after で順番を表します。'], examples: [['I will ask before I decide.', '決める前に尋ねます。']] }],
    choose: [['I will (send / sent) a message.', 'send'], ['She will (help / helps) us.', 'help'], ['We will (meet / met) tomorrow.', 'meet'], ['I will ask (before / between) I decide.', 'before'], ['I will rest (after / among) work.', 'after'], ['Will you (come / came)?', 'come']],
  },
  amounts: {
    tips: [{ rule: ['Use How many for things you can count.', '数えられるものには How many を使います。'], examples: [['How many cups do we need?', 'カップはいくつ必要ですか。']] }, { rule: ['Use How much for an amount or price.', '量や値段には How much を使います。'], examples: [['How much pasta do we need?', 'パスタはどのくらい必要ですか。']] }],
    choose: [['How (many / much) cups do we need?', 'many'], ['How (much / many) pasta do we need?', 'much'], ['We need four (tomatoes / tomato).', 'tomatoes'], ['How much (is / are) it?', 'is'], ['We have two (menus / menu).', 'menus'], ['Do we have (enough / many) water?', 'enough']],
  },
} satisfies Record<string, { tips: Episode['tips']; choose: Pair[] }>;

export function speakingLines(roles: [string, string], lines: string[]): [string, string][] {
  if (lines.length !== 10) throw Error('A speaking model must have ten turns');
  return lines.map((line, i) => [roles[i % 2]!, line]);
}

export function comprehensionChoices(questions: Pair[], wrong: string[]): Episode['choices'] {
  if (questions.length !== 4 || wrong.length !== 4) throw Error('Four distinct comprehension items required');
  return questions.map(([question, answer], i) => i % 2 ? [question, wrong[i]!, answer, 'B'] : [question, answer, wrong[i]!, 'A']);
}

export type EditorialPatch = Partial<Episode> & { mission?: Episode['mission']; apply?: Episode['apply'] };
