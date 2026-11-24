const highlights: Record<string, Record<number, string>> = {
  '3:1:4': {2:'photos'}, '3:1:8': {3:'free'},
  '4:2:1': {2:'One advantage is',5:'responsibilities'}, '4:2:2': {3:'still'},
  '4:2:3': {3:'make the exhibition date larger'}, '4:3:2': {2:'separate'},
  '4:3:4': {0:'How has work been'}, '4:4:9': {4:'not won'}, '4:5:1': {1:'are expected to'},
  '4:5:7': {1:'My concern is',2:'I would prefer'},
  '5:1:2': {0:'competing for'}, '5:1:7': {3:'Which one is correct'},
};
function replace(value: any, before: string, after: string): any {
  if (typeof value === 'string') return value.replaceAll(before, after);
  if (Array.isArray(value)) return value.map(v => replace(v,before,after));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v,before,after)]));
  return value;
}
export function editorialCorrections(key: string, input: any): any {
  let e = structuredClone(input);
  for (const [i, phrase] of Object.entries(highlights[key] || {})) e.words[Number(i)][1] = phrase;
  if (key === '4:2:4') e.mission.evidence = e.mission.evidence.replace(' (and tables on Friday)', '');
  if (key === '4:4:9') e.intro[0] = e.intro[0].replace('a big Seoul project', 'a Seoul project');
  if (key === '4:5:6' || key === '4:5:7') {
    e = replace(e, 'provided that', 'only if');
    e = replace(e, 'I would proceed', 'I will proceed');
    if (key === '4:5:6') {
      e.words[5] = ['I will sign only if the terms are clear.', 'only if', '条件が明確な場合だけサインします。'];
      e.tips[1] = {rule:['Use only if to state a condition that must be met.', 'only if を使って、満たす必要がある条件を伝えます。'], examples:[['I will sign only if the equipment check is okay.', '設備の確認で問題がない場合だけサインします。']]};
      e.choose[0] = ['The (deposit / rent) is paid at the start, not every month.', 'deposit'];
      e.choose[4] = ['I will sign only if the terms (are / is) clear.', 'are'];
    }
  }
  if (key === '4:5:9') {
    e.words[1] = ['Your help made it easier. Thank you.', 'Your help', 'あなたの助けで楽になりました。ありがとう。'];
    e.apply.dialogue[7][1] = 'You helped me settle at Kamo House. Thank you for your welcome.';
    e.tips[1] = {rule:['Use Thank you for + -ing to name the help you received.', 'Thank you for ＋動詞-ing で、何をしてもらったか伝えて感謝します。'],examples:[['Thank you for welcoming me to Kamo House.', 'Kamo Houseで温かく迎えてくれてありがとう。']]};
    e.choose[2] = ['Your help (made / make) it easier.', 'made'];
    e.choices[1] = ['What does “Your help made it easier. Thank you.” express?', 'A demand for payment.', 'Gratitude for support.', 'B'];
    e.mission.useful[2] = 'Thank you for helping me ...';
  }
  if (key === '4:5:8') e.apply.text = e.apply.text.replace('I wish I had been honest sooner when things became difficult.', 'I was not honest when things became difficult. I regret that.');
  if (key === '5:1:2') e.intro = ['The team has a chance to plan an international hotel campaign. The hotel wants more guests from other countries and a high-quality image. Mika listens to Ethan’s message and checks the goal. The agency has not won the project yet.', 'チームに国際的なホテルの広告を企画する機会が来ます。ホテルは高級な印象を保ちながら海外の宿泊客を増やしたいと考えています。ミカはイーサンの連絡を聞き、目標を確認します。会社はまだ案件を獲得していません。'];
  return e;
}
