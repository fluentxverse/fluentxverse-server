// Exact editorial replacements shared by the source builders and the data migration.
// They change roleplay copy without rebuilding lessons or touching student evidence.
const replacements: [string, string][] = [
  ['You are a new resident at Kamo House. Your tutor is Claire, who welcomes you near the cafe. You may use your own or invented details.', 'You are Emma, a new resident at Kamo House. Your tutor is Claire, who welcomes you near the cafe.'],
  ['あなたはKamo Houseの新しい住人です。講師はカフェの近くで迎えてくれるクレア役です。自分の情報でも、架空の情報でもかまいません。', 'あなたはKamo Houseの新しい住人エマ役です。講師はカフェの近くで迎えてくれるクレア役です。'],
  ['Introduce yourself. Share your hometown, work or studies, and one interest. Ask Claire at least one related question and respond to her invitation.', 'Introduce yourself as Emma. Say what you do and what you enjoy. Ask Claire a related question and respond to her invitation.'],
  ['自己紹介をしましょう。出身地、仕事や勉強、好きなことを一つ伝えましょう。クレアに関連する質問を一つ以上し、誘いにも返事をしましょう。', 'エマとして自己紹介をしましょう。仕事と好きなことを伝え、クレアに関連する質問をして、誘いに返事をしましょう。'],
  ['Please be the new resident.', 'Please be Emma.'],
  ['Nice to meet you. Where are you from?', 'Nice to meet you. How are you settling in?'],
  ['After trying Leo\'s bread, Emma listens as he tells her a little more.', 'You are Emma. After trying Leo\'s bread, you listen as he tells you a little more.'],
  ['レオのパンを食べた後、エマはレオからもう少し話を聞きます。', 'あなたはエマ役です。レオのパンを食べた後、もう少し話を聞きます。'],
  ['Nao sends Emma a message about their first photo walk.', 'You are Emma. Nao sends you a message about your first photo walk.'],
  ['ナオからエマに、初めての写真散歩についてメッセージが届きます。', 'あなたはエマ役です。ナオから初めての写真散歩についてメッセージが届きます。'],
  [' Choose places and details from the story or invent your own.', ''],
  ['物語の場所や出来事を使っても、自分で考えてもかまいません。', ''],
  ['You may use your own or invented details.', ''],
  ['You may use your own or an imagined example.', ''],
  ['自分の情報でも、架空の情報でもかまいません。', ''],
  ['架空の情報でもかまいません。', ''],
  ['You may invent a sensible meeting time and a simple activity.', 'Choose a meeting time and an activity.'],
  ['待ち合わせ時刻や活動は、無理のない内容を自由に考えてかまいません。', '待ち合わせ時刻と活動を決めましょう。'],
  ['Emma receives a message from Nao about meeting at a small cafe after the walk.', 'You are Emma. Nao sends you a message about meeting at a small cafe after the walk.'],
  ['At a practice station counter, Emma listens to the staff.', 'You are Emma at a practice station counter. Listen to the staff.'],
  ['練習用の駅の窓口でエマが係員の説明を聞きます。', 'あなたは練習用の駅の窓口にいるエマ役です。係員の説明を聞きましょう。'],
  ['You play the shop assistant;', 'You are the shop assistant;'],
  ['散策の後に小さなカフェで会おうとナオからエマにメッセージが届きます。', 'あなたはエマ役です。散策の後に小さなカフェで会おうとナオからメッセージが届きます。'],
  ['You are Emma on a photo walk. Your tutor is Leo. Imagine a bamboo path, garden, or another outdoor place. You can describe an imagined scene; no photograph is required.', 'You are Emma on a photo walk in Arashiyama. Your tutor is Leo. Tall bamboo lines the path, and sunlight comes through the leaves.'],
  ['あなたは写真散歩中のエマ役、講師はレオ役です。竹林の道、庭園、または別の屋外の場所を想像しましょう。実際の写真は必要ありません。', 'あなたは嵐山で写真散歩中のエマ役、講師はレオ役です。道の両側には高い竹があり、葉の間から光が差しています。'],
  [' You may share his umbrella or choose another option.', ''],
  ['傘に一緒に入っても、別の方法を選んでもかまいません。', ''],
  ['Your tutor is Leo, inviting you to a friendly outing. You may play Emma or use an invented adult character. Decide whether to accept, suggest another day, or politely decline. No personal or romantic information is needed.', 'You are Emma. Your tutor is Leo. You are planning another outing together.'],
  ['Your tutor is Leo, inviting you to a friendly outing. You are Emma. Decide whether to accept, suggest another day, or politely decline.', 'You are Emma. Your tutor is Leo. You are planning another outing together.'],
  ['講師は気軽な外出に誘うレオ役です。あなたはエマ役でも、架空の大人の人物でもかまいません。応じるか、別の日を提案するか、丁寧に断るかを選びましょう。個人的な情報や恋愛の話は必要ありません。', 'あなたはエマ役、講師はレオ役です。二人で次の外出を計画しています。'],
  ['Please be Emma or your invented character.', 'Please be Emma.'],
  ['Accept personal or invented details and short, clear sentences.', 'Accept short, clear sentences.'],
  ['Accept a personal or invented answer. Give one brief correction if needed.', 'Check the answer and give one brief correction if needed.'],
  ['Look for a clear introduction, a relevant question, and a response to the invitation. Do not require private personal details or a memorized speech.', 'Look for a clear introduction, a relevant question, and a response to the invitation.'],
  ['Accept invented places. This is an exchange, not a speech.', 'Check the exchange, not the length of a speech.'],
  ['Accept imagined experiences; do not demand emotional disclosure or a monologue.', 'Keep the task conversational.'],
  ['No personal gift or romantic response is required.', ''],
  ['Do not require flirtation.', ''],
  ['Sharing an umbrella is optional; assess planning language, not personal closeness.', 'Assess the weather problem, destination, and backup plan.'],
  ['Respond voluntarily and politely, suggest/clarify details or a different time, and confirm a plan. A polite decline is also valid: ask/answer a follow-up and close respectfully. Do not assess romantic interest or insist on acceptance.', 'Respond to the invitation, clarify the details or suggest a different time, and confirm the plan.'],
  ['Light romance develops only between fictional adult Emma and Leo; learner roles remain optional and consent-respecting.', 'Emma and Leo\'s relationship develops through the story.'],
  ['Never require personal romantic disclosures.', 'Use direct character roles in the tasks.'],
];

export function directRoleplayCopy<T>(value: T): T {
  if (typeof value === 'string') {
    let text: string = value;
    for (const [before, after] of replacements) text = text.replaceAll(before, after);
    return (text === value ? text : text.trim()) as T;
  }
  if (Array.isArray(value)) return value.map(directRoleplayCopy) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, directRoleplayCopy(item)])) as T;
  return value;
}
