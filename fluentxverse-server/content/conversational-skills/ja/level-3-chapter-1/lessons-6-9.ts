import { buildLesson4 } from './lesson-4-speaking';

type Skill = 'listening' | 'reading' | 'speaking';
type Pair = [string, string];
type Vocabulary = [string, string, string];
type Choice = [string, string, string, 'A' | 'B'];
type Question = [string, string];
type Topic = [string, string[]];

interface ArcLesson {
  number: 6 | 7 | 8 | 9;
  skill: Skill;
  title: string;
  objective: Pair;
  intro: Pair;
  warmup: string;
  vocabulary: Vocabulary[];
  tips: { rule: Pair; heading: string; examples: Pair[] }[];
  apply: { situation: Pair; text: string; speaker?: string; questions: Question[]; invitation?: string };
  trivia: { fact: Pair; question: Question; source: string };
  stepA: { instruction: Pair; items: [string, string][] };
  stepB: { instruction: Pair; choices: Choice[]; listeningPrompts?: string[] };
  mission: { situation: Pair; instruction: Pair; text: string; title?: string; questions: Question[]; opening: string; prompts: string[]; planning?: string[] };
  topics: Topic[];
  story: { previous: string; plot: string[]; summary: string; next: string };
}

const lessons: Record<6 | 7 | 8 | 9, ArcLesson> = {
  6: {
    number: 6, skill: 'listening', title: 'The Exhibition Has Moved',
    objective: ['I can follow a voice-message update and identify what changed, why, and what is now confirmed.', '音声メッセージの変更連絡を聞き、変更点、理由、確定した予定を理解できる。'],
    intro: ['Nao is preparing her first small pottery exhibition. It was going to be held at the Kamo House cafe, but a pipe has leaked. Claire leaves a message with a new plan. Listen for the details that changed and the one detail that did not.', 'ナオは初めての小さな陶芸展示会を準備しています。Kamo Houseのカフェで開く予定でしたが、配管から水が漏れました。クレアの連絡を聞き、変わったことと変わらなかったことを確認しましょう。'],
    warmup: 'Which detail would you check first if an event suddenly moved?',
    vocabulary: [
      ['The venue has changed.', 'venue has changed', '会場が変更になりました。'],
      ['The cafe is closed for repairs.', 'closed for repairs', 'カフェは修理のため閉まっています。'],
      ['We found another space.', 'another space', '別の会場を見つけました。'],
      ['It starts an hour later.', 'an hour later', '開始が1時間遅くなります。'],
      ['Sunday is still the day.', 'still', '日曜日であることは変わりません。'],
      ['Please confirm the new location.', 'confirm', '新しい場所を確認してください。'],
    ],
    tips: [
      { rule: ['Was going to describes an earlier plan that may have changed. Listen for but or instead to find the new plan.', 'was going to は以前の予定を表します。but や instead を聞いて新しい予定を確認しましょう。'], heading: 'OLD PLAN AND NEW PLAN', examples: [['We were going to meet at the cafe, but we will meet at the gallery instead.', 'カフェで会う予定でしたが、代わりにギャラリーで会います。']] },
      { rule: ['Still points to a detail that has not changed. Confirm the final day, time, and place after the whole message.', 'still は変わっていない情報を示します。メッセージを最後まで聞いてから、最終的な曜日、時間、場所を確認しましょう。'], heading: 'WHAT STAYS THE SAME', examples: [['It is still on Sunday, but it starts at three instead of two.', '日曜日のままですが、2時ではなく3時に始まります。']] },
    ],
    apply: {
      situation: ['Claire leaves Emma a voice message about Nao\'s exhibition. Listen once for the main problem and again for the confirmed plan.', 'クレアがナオの展示会についてエマに音声メッセージを残します。最初は問題の内容を、次は確定した予定を聞き取りましょう。'],
      text: "Hi Emma, it's Claire. We were going to hold Nao's pottery exhibition at the Kamo House cafe on Sunday at two. A pipe leaked last night, so the cafe is closed for repairs this weekend. The exhibition is not canceled. The Gojo Art Room has offered us a space instead. It is still on Sunday, but the opening will be at three. Please don't share the old poster. I have told Nao, but I haven't heard back from you yet. Could you confirm that you got this message?",
      questions: [['Is the exhibition canceled?', 'No. It has moved.'], ['Why is the cafe unavailable?', 'A pipe leaked, and the cafe is closed for repairs.'], ['What is the final day, time, and place?', 'Sunday at three, at the Gojo Art Room.'], ['What does Claire ask Emma to do?', 'Confirm the message and not share the old poster.']],
    },
    trivia: { fact: ['Kyoto is known for Kyo-yaki and Kiyomizu-yaki pottery. Kyoto\'s official travel guide describes a wide variety of pieces, from tableware to ceramic art. Nao\'s exhibition is fictional, but her craft fits the city\'s real traditions.', '京都は京焼・清水焼で知られています。京都市の公式観光ガイドでは、食器から陶芸作品まで幅広い品が紹介されています。ナオの展示会は架空ですが、陶芸は京都に根付いた工芸です。'], question: ['What kinds of ceramic pieces could Nao show besides cups?', 'For example, plates, bowls, or ceramic art.'], source: 'https://kyoto.travel/en/travel-inspiration/kyoto-craftmanship-various-crafts/' },
    stepA: { instruction: ['Choose the phrase that fits the change. Read each complete sentence.', '変更の内容に合う表現を選び、文全体を読みましょう。'], items: [
      ['We (were going to / still) meet at the cafe, but it is closed now.', 'were going to'],
      ['The gallery will host the exhibition (instead / still) of the cafe.', 'instead'],
      ['The exhibition is (still / instead) on Sunday.', 'still'],
      ['It starts at three, one hour (later / earlier) than the old plan.', 'later'],
    ] },
    stepB: { instruction: ['Listen to four short updates. Choose the confirmed detail, not the first suggestion.', '四つの短い変更連絡を聞き、最初の案ではなく確定した情報を選びましょう。'], choices: [
      ['Where will they meet?', 'At the cafe', 'At the gallery', 'B'],
      ['When will the exhibition open?', 'At two', 'At three', 'B'],
      ['Which day is confirmed?', 'Sunday', 'Saturday', 'A'],
      ['What should Emma do with the old poster?', 'Share it', 'Do not share it', 'B'],
    ], listeningPrompts: [
      'We planned to meet at the cafe, but it is closed. Please come to the gallery instead.',
      'I said two before, but the opening has moved to three.',
      'The place and time changed, but the day is still Sunday.',
      'The old poster has the wrong place. Please do not share it.',
    ] },
    mission: {
      situation: ['Nao leaves Leo a voice message after hearing that the cafe is closed. She is worried about the exhibition and is waiting for Emma to confirm the new poster.', 'カフェが閉まると聞いたナオがレオに音声メッセージを残します。展示会を心配しており、新しいポスターについてエマの返事を待っています。'],
      instruction: ['Listen to Nao\'s whole message. Then tell Leo what Nao first thought, what Claire has confirmed, and what Nao still needs from Emma.', 'ナオのメッセージを最後まで聞きましょう。その後、最初にナオがどう思ったか、クレアが確認したこと、エマにまだ頼みたいことをレオに伝えましょう。'],
      text: "Hi Leo, it's Nao. When Claire told me about the leak, I thought we had to cancel the whole exhibition. I was really disappointed because I've been preparing these cups for months. Then Claire found the Gojo Art Room. So it is still on Sunday, but the opening has moved from two to three, and the venue has changed. That is a relief. I'm worried about one thing, though: Emma made a beautiful poster with the old cafe address. I sent her the new details an hour ago, but she hasn't replied. Could you ask her if she has seen the message before the poster goes online?",
      questions: [['What did Nao first think?', 'She thought the exhibition had to be canceled.'], ['What is now confirmed?', 'It is still on Sunday, at three, at the Gojo Art Room.'], ['Why is Nao worried about the poster?', 'It has the old cafe address and Emma has not replied.'], ['What does Nao ask Leo to do?', 'Ask Emma if she has seen the updated details.']],
      opening: "Hi, I missed Nao's message. What happened to the exhibition?",
      prompts: ['Is it canceled or moved?', 'Which details changed?', 'What does Nao need Emma to confirm?'],
    },
    topics: [
      ['A PLAN THAT CHANGED', ['Tell me about a plan that changed at the last minute. What happened?', 'What did you decide to do instead?', 'Did the new plan work out better or worse? Why?']],
      ['GROUP PLANS', ['When plans change with a group, how do you usually tell everyone?', 'What would you put in the first message so nobody goes to the wrong place?', 'How would you check that everyone has seen the update?']],
      ['DINNER PLAN B', ['Imagine the restaurant you booked closes an hour before dinner. What would you do first?', 'What other place or activity would you suggest to your friends?', 'One friend is already on the way. What would you say to them?']],
    ],
    story: { previous: 'Claire and Emma planned a Sunday bike ride. Nao has been preparing pottery for her first small exhibition.', plot: ['A leak closes the Kamo House cafe.', 'Claire finds a new venue and changes the opening time.', 'Nao worries that Emma may share an outdated poster.'], summary: 'The exhibition survives a last-minute venue change, but Emma has not confirmed that she received the update.', next: 'An outdated poster appears online, and the residents must work out how it happened.' },
  },
  7: {
    number: 7, skill: 'reading', title: 'The Poster Went Out',
    objective: ['I can read a message thread, put events in order, and separate a confirmed fact from an assumption.', 'メッセージのやり取りを読み、出来事の順番を整理し、確認された事実と思い込みを区別できる。'],
    intro: ['The old exhibition poster appears online with the wrong address. Nao thinks Emma ignored the update, but the messages tell a more complicated story. Read the timestamps before deciding what happened.', '展示会の古いポスターが誤った住所のまま公開されます。ナオはエマが連絡を無視したと思いますが、メッセージを読むと事情が違うようです。判断する前に時刻を確認しましょう。'],
    warmup: 'What can happen when someone shares an invitation before checking the latest message?',
    vocabulary: [
      ['The post was scheduled in advance.', 'scheduled in advance', '投稿は事前に予約されていました。'],
      ['The old address is still online.', 'old address', '古い住所がまだオンラインにあります。'],
      ['I missed the update.', 'missed the update', '変更連絡を見逃しました。'],
      ['The notice has been corrected.', 'has been corrected', 'お知らせは修正されました。'],
      ['Please use the latest details.', 'latest details', '最新の情報を使ってください。'],
      ['That was an assumption, not a fact.', 'assumption', 'それは事実ではなく思い込みでした。'],
    ],
    tips: [
      { rule: ['Read timestamps and sequence words before judging a message thread. Had already + past participle marks an action that happened before another past action.', 'メッセージの流れを判断する前に時刻や順序を表す語を読みましょう。had already + 過去分詞は、別の過去の出来事より前に起きたことを示します。'], heading: 'ORDER OF EVENTS', examples: [['Emma had already scheduled the poster when Claire sent the update.', 'クレアが変更連絡を送った時、エマはすでにポスターの投稿を予約していました。']] },
      { rule: ['Someone\'s belief is not automatically a confirmed fact. Look for words such as thought, assumed, confirmed, and corrected.', '誰かの考えがそのまま確認された事実とは限りません。thought、assumed、confirmed、corrected などの語に注目しましょう。'], heading: 'FACT OR ASSUMPTION', examples: [['Nao thought Emma had ignored her message, but Emma had not seen it yet.', 'ナオはエマが連絡を無視したと思いましたが、エマはまだ見ていませんでした。']] },
    ],
    apply: {
      situation: ['Read the Kamo House group messages in time order. Work out why the old poster appeared and what Emma did next.', 'Kamo Houseのグループメッセージを時刻順に読みましょう。なぜ古いポスターが公開され、その後エマが何をしたか確認しましょう。'],
      text: '<p><strong>Saturday, 9:50 | Emma:</strong> I scheduled the poster to go online at 10:15. I will be on the train this morning.</p><p><strong>10:10 | Claire:</strong> The cafe is closed after the leak. Nao\'s exhibition is still on Sunday, but it will be at the Gojo Art Room at 3 p.m. Emma, please change the poster.</p><p><strong>10:16 | Automatic post:</strong> Nao\'s exhibition: Sunday, 2 p.m., Kamo House cafe.</p><p><strong>10:20 | Nao:</strong> People are asking about the cafe address. I thought Emma had seen Claire\'s update. Did she ignore it?</p><p><strong>10:25 | Emma:</strong> I am sorry. I had already scheduled the old poster before I got the update. I have corrected the post and will message everyone who shared it.</p>',
      questions: [['When did Claire send the update?', 'At 10:10 on Saturday.'], ['Why did the old poster still appear?', 'Emma had scheduled it before seeing the update, and it posted automatically at 10:15.'], ['Was it confirmed that Emma ignored Claire?', 'No. Nao only thought so; Emma had not received the update on the train.'], ['What did Emma do at 10:25?', 'She corrected the post and said she would contact people who shared it.']],
    },
    trivia: { fact: ['Kiyomizu-yaki is one kind of Kyo-yaki pottery associated with Kyoto. Kyoto\'s official travel guide notes that ceramics shops can be found in the streets near Kiyomizu Temple. An event notice should still give its exact venue, not just a famous neighborhood.', '清水焼は京都にゆかりのある京焼の一種です。京都市の公式観光ガイドは、清水寺周辺の通りに陶器店があると紹介しています。ただし、イベントの案内には有名な地域名だけでなく、正確な会場を書く必要があります。'], question: ['Why is Gojo Art Room more useful than just saying near Kiyomizu?', 'It names the exact venue.'], source: 'https://kyoto.travel/en/areas/gion-kiyomizu/' },
    stepA: { instruction: ['Choose the form or sequence word that matches what happened first.', '先に起きた出来事に合う形や順序を表す語を選びましょう。'], items: [
      ['Emma (had already scheduled / has already schedule) the post before she saw the update.', 'had already scheduled'],
      ['Claire sent the correction (before / after) the old poster appeared.', 'before'],
      ['Nao (thought / confirmed) Emma had ignored the message, but she did not know yet.', 'thought'],
      ['Emma corrected the post (after / before) she saw the mistake.', 'after'],
    ] },
    stepB: { instruction: ['Read each short record. Choose the conclusion supported by the text.', '短い記録を読み、本文に裏付けられた結論を選びましょう。'], choices: [
      ['9:00: A flyer is scheduled. 9:10: The venue changes. Which happened first?', 'The flyer was scheduled', 'The venue changed', 'A'],
      ['Mika: "I think Jun saw the note." What is confirmed?', 'Jun saw it', 'Mika believes Jun saw it', 'B'],
      ['Old notice: Room A. Latest notice: Room B. Which room should guests use?', 'Room A', 'Room B', 'B'],
      ['11:00: Aya corrects a post. 11:05: She calls guests. What did she do first?', 'Corrected the post', 'Called guests', 'A'],
    ] },
    mission: {
      situation: ['A visitor has an old flyer. Read the venue confirmation and corrected notice, then give the visitor the final details and explain which information was outdated.', '来場者は古いチラシを持っています。会場からの確認連絡と訂正のお知らせを読み、確定した情報と古くなった情報を伝えましょう。'],
      instruction: ['Read both notices. Tell a visitor the correct venue and time, what is free, what costs extra, and when a workshop place must be booked.', '二つのお知らせを読みましょう。正しい会場と時間、無料の内容、追加料金が必要な内容、ワークショップの申込期限を来場者に伝えましょう。'],
      title: 'Nao\'s Pottery Exhibition: Final Notice',
      text: '<strong>Old flyer, posted Friday:</strong> Sunday, 2-5 p.m. Kamo House cafe. Entry free. Short pottery workshop at 3 p.m.<br><br><strong>Venue confirmation, Saturday 11:00:</strong> The cafe cannot open this weekend. The exhibition is confirmed for Sunday, 3-5 p.m. at the Gojo Art Room. Entry is still free. The optional workshop begins at 4 p.m. and costs ¥800. Reserve a workshop place by Saturday at 6 p.m. Please do not use the old flyer.<br><br><strong>Emma\'s corrected notice, Saturday 11:20:</strong> The latest venue and time are the Gojo Art Room, Sunday from 3 to 5 p.m. Visitors who only want to see the pottery do not need to book.',
      questions: [['What is the final exhibition venue and time?', 'Gojo Art Room, Sunday 3-5 p.m.'], ['Is entry to the exhibition free?', 'Yes.'], ['What costs ¥800?', 'The optional workshop.'], ['When must someone book a workshop place?', 'By Saturday at 6 p.m.'], ['Which details on the old flyer are wrong?', 'The cafe venue, 2 p.m. start, and 3 p.m. workshop time.']],
      opening: 'I only saw the first flyer. Is the exhibition still at the cafe at two?',
      prompts: ['Where does the corrected notice say to go?', 'Do I have to pay to see the pottery?', 'What if I want to join the workshop?'],
    },
    topics: [
      ['CHECKING UPDATES', ['Where do you look for the latest event information?', 'What detail is most important to verify?', 'How would you alert someone with an old invitation?']],
      ['MISUNDERSTANDINGS', ['Why can a short message be misunderstood?', 'What could you ask before assuming someone ignored you?', 'How do you correct a misunderstanding politely?']],
      ['ONLINE NOTICES', ['Have you seen an outdated online post?', 'Should corrected posts show what changed?', 'How can organizers reach people who shared an old notice?']],
    ],
    story: { previous: 'A leak moved Nao\'s exhibition from the Kamo House cafe to the Gojo Art Room. Emma had not confirmed the update.', plot: ['A scheduled poster with the old address appears online.', 'Nao thinks Emma ignored the venue change.', 'The timestamps show Emma had scheduled the post before seeing the message.'], summary: 'Emma corrects the poster, but she still needs to repair the misunderstanding with Nao.', next: 'Emma sends Nao a direct apology and explains how she will fix the confusion.' },
  },
  8: {
    number: 8, skill: 'speaking', title: 'Making Things Right',
    objective: ['I can give a clear apology, explain a mistake without blaming others, and describe a concrete solution.', '明確に謝り、他人を責めずに間違いを説明し、具体的な解決策を伝えられる。'],
    intro: ['Emma has corrected the poster, but Nao still feels hurt. A public correction fixes the details; a personal message can repair the relationship. Practise speaking long enough to explain what happened and what you will do next.', 'エマはポスターを修正しましたが、ナオはまだ傷ついています。公開の訂正で情報は直せますが、関係を修復するには本人への連絡も必要です。何が起き、次に何をするかをまとまった話で伝えましょう。'],
    warmup: 'What makes an apology sound sincere to you?',
    vocabulary: [
      ['I owe you an apology.', 'owe you an apology', 'あなたに謝らなければなりません。'],
      ['I should have checked first.', 'should have checked', '先に確認すべきでした。'],
      ['I understand why you are upset.', 'understand why', 'あなたが困っている理由は分かります。'],
      ['I have corrected the post.', 'have corrected', '投稿は修正しました。'],
      ['I will contact everyone who shared it.', 'contact everyone', '共有した人全員に連絡します。'],
      ['Here is the confirmed plan.', 'confirmed plan', 'こちらが確定した予定です。'],
    ],
    tips: [
      { rule: ['Should have + past participle names a better action you did not take. Use it to take responsibility, not to blame someone else.', 'should have + 過去分詞は、しなかったけれどすべきだった行動を表します。人のせいにせず、自分の責任を伝えるときに使えます。'], heading: 'TAKE RESPONSIBILITY', examples: [['I should have checked the final address before the post went online.', '投稿が公開される前に、最終的な住所を確認すべきでした。']] },
      { rule: ['Present perfect can report a remedy already completed. Then use will + verb for your next action.', '現在完了形は、すでに終えた対応を伝えられます。その後、will + 動詞の原形で次の行動を示しましょう。'], heading: 'REPAIR AND NEXT STEP', examples: [['I have corrected the post, and I will message everyone who shared it.', '投稿は修正しました。共有した人全員に連絡します。']] },
    ],
    apply: {
      situation: ['Emma leaves Nao a voice message. Read it as one continuous message, then give a shorter version in your own words.', 'エマがナオに音声メッセージを残します。一つのまとまったメッセージとして読み、その後、自分の言葉で短く伝えましょう。'],
      speaker: 'Emma',
      text: "Nao, I owe you an apology. I had scheduled the old poster before Claire's update, and it went online while I was on the train. I did not ignore your message, but I understand why it looked that way. I should have checked the final details before the post went live. I have corrected the address and time, and I will message everyone who shared the first version. The exhibition is still on Sunday, from three to five, at the Gojo Art Room. I know this is important to you, and I want to help make the opening go well.",
      questions: [['What mistake does Emma take responsibility for?', 'She did not check the final details before the post went live.'], ['What has she already done?', 'Corrected the address and time.'], ['What will she do next?', 'Message everyone who shared the old version.']],
    },
    trivia: { fact: ['Kyoto\'s Museum of Crafts and Design introduces many of the city\'s traditional crafts, including Kyo-yaki/Kiyomizu-yaki pottery. Clear signs and notices help visitors know which craft or event they are seeing, especially when plans change.', '京都の京都伝統産業ミュージアムでは、京焼・清水焼を含む多くの伝統工芸が紹介されています。予定が変わったときは、分かりやすい案内が来場者に役立ちます。'], question: ['What two details should an updated event notice make easy to find?', 'For example, the confirmed venue and time.'], source: 'https://kcp.kyoto.travel/en' },
    stepA: { instruction: ['Choose the form that fits an apology or a completed action. Read the full message.', '謝罪やすでに終えた行動に合う形を選び、文全体を読みましょう。'], items: [
      ['I should have (checked / check) the details before posting.', 'checked'],
      ['I (have corrected / will corrected) the old address already.', 'have corrected'],
      ['I will (contact / contacted) the guests this afternoon.', 'contact'],
      ['I should have (told / tell) you about the change sooner.', 'told'],
    ] },
    stepB: { instruction: ['Choose the response that takes responsibility and offers a useful next step. Explain why.', '責任を認め、役立つ次の行動を示す返答を選び、理由を説明しましょう。'], choices: [
      ['You sent the wrong time. What do you say?', 'Someone else should have checked it.', 'I should have checked it. I will send the correct time now.', 'B'],
      ['A guest has an old address. What do you say?', 'I have corrected the notice. I will message the guests directly.', 'They should look harder for the new address.', 'A'],
      ['Your colleague feels ignored. What do you say?', 'You are too sensitive.', 'I understand why it looked that way. I had not seen the message yet.', 'B'],
      ['End with a clear confirmed plan.', 'Everything should be fine somehow.', 'The event is Sunday at three at the Gojo Art Room.', 'B'],
    ] },
    mission: {
      situation: ['You helped organize a small craft event. An old invitation with the wrong venue was shared, and your co-organizer feels that you did not listen. You must speak to them before the event begins.', '小さな工芸イベントを手伝っています。誤った会場が書かれた古い招待状が共有され、共同主催者は話を聞いてもらえなかったと感じています。開場前に本人へ伝えましょう。'],
      instruction: ['Give a 90-second message without tutor interruptions. Acknowledge the problem and its effect, explain what happened without blaming anyone, say what you should have done, report one action already completed, and offer one next step. End with the confirmed event details.', '講師に途中で質問されず、90秒ほどまとまって話しましょう。問題とその影響を認め、責任転嫁せずに経緯を説明し、すべきだったこと、すでにした対応、次にする対応を伝えます。最後に確定したイベント情報を確認しましょう。'],
      text: '',
      planning: ['Acknowledge the problem and its effect', 'Explain and take responsibility', 'Completed fix, next step, confirmed details'],
      questions: [],
      opening: 'I saw the old invitation online. I was worried people would go to the wrong place. What happened?',
      prompts: ['What should you have checked?', 'What have you already done?', 'How will you reach people who saw the old version?'],
    },
    topics: [
      ['APOLOGIES', ['What makes an apology helpful?', 'Is explaining a reason the same as making an excuse?', 'When is a follow-up action more important than words?']],
      ['FIXING MISTAKES', ['How do you notice that information is wrong?', 'Who should be told first when you correct it?', 'What can prevent the same mistake next time?']],
      ['WORKING TOGETHER', ['How do you clarify a misunderstanding with a teammate?', 'What is a respectful way to disagree?', 'How can a team check final details before sharing them?']],
    ],
    story: { previous: 'Emma\'s scheduled poster went online with the old address. Nao thought Emma had ignored the change, although Emma had not seen the message.', plot: ['Emma acknowledges the confusion she caused.', 'She explains the timing without blaming Claire or Nao.', 'She corrects the poster and promises to contact everyone who shared it.'], summary: 'Emma repairs the public notice and reaches out to Nao personally before the exhibition.', next: 'On opening day, Nao believes her featured cups are missing, and another update is needed.' },
  },
  9: {
    number: 9, skill: 'listening', title: 'The Missing Cups',
    objective: ['I can distinguish a worry from a confirmed fact in spoken updates and explain the final outcome.', '音声による連絡を聞き、心配や推測と確認された事実を区別し、最終的な結果を説明できる。'],
    intro: ['The exhibition day arrives. Nao cannot find the blue cups she made for the main display. She fears the leak or the move may have damaged them. Listen to the messages before deciding what actually happened.', '展示会当日、ナオは目玉作品の青いカップを見つけられません。水漏れや会場移動で傷んだのではと心配します。実際に何が起きたか、連絡を最後まで聞いて判断しましょう。'],
    warmup: 'What would you check before saying that something is lost?',
    vocabulary: [
      ['The box might be at the cafe.', 'might be', '箱はカフェにあるかもしれません。'],
      ['I have not found it yet.', 'not found it yet', 'まだ見つかっていません。'],
      ['I checked the storage room.', 'checked the storage room', '倉庫を確認しました。'],
      ['It turns out the cups are safe.', 'it turns out', '結局、カップは無事だと分かりました。'],
      ['They will arrive by two-thirty.', 'by two-thirty', '2時半までに届きます。'],
      ['The opening can go ahead.', 'go ahead', '開場は予定どおりできます。'],
    ],
    tips: [
      { rule: ['Might expresses uncertainty. Found, confirmed, and it turns out tell you what was later established.', 'might は可能性を表します。found、confirmed、it turns out は、その後に確認されたことを示します。'], heading: 'GUESS OR FACT', examples: [['The cups might be lost. It turns out they are in the storage room.', 'カップはなくなったかもしれません。結局、倉庫にあると分かりました。']] },
      { rule: ['By a time means no later than that time. At a time names the scheduled time itself.', 'by + 時刻は「その時刻までに」、at + 時刻は「その時刻に」を表します。'], heading: 'ARRIVAL AND OPENING', examples: [['The cups will arrive by 2:30. The exhibition opens at 3:00.', 'カップは2時半までに届きます。展示会は3時に開場します。']] },
    ],
    apply: {
      situation: ['Nao and Claire leave two short voice messages about the featured blue cups. Listen first for the worry, then for the confirmed location and delivery time.', 'ナオとクレアが目玉作品の青いカップについて二つの音声メッセージを残します。最初の心配と、その後に確認された場所・配達時刻を聞き分けましょう。'],
      text: "Nao: I cannot find the blue cups for the main display. They might still be at the cafe, or they might have been damaged during the move. I have not checked the dry storage room yet. Claire, could you look there?\n\nClaire: I checked the dry storage room. The cups are safe. When we cleared the cafe after the leak, I moved the box there and forgot to tell you. I am sorry for the worry. Leo has picked it up and will bring it to the Gojo Art Room by two-thirty. The exhibition can open at three as planned.",
      questions: [['What was Nao worried about?', 'She could not find the blue cups and thought they might be damaged.'], ['Had she checked the dry storage room?', 'No.'], ['Where were the cups actually?', 'In the dry storage room at the cafe.'], ['Who is bringing them and by when?', 'Leo, by 2:30.'], ['Can the exhibition open at three?', 'Yes.']],
    },
    trivia: { fact: ['Kyoto\'s pottery traditions include tableware as well as objects made for tea ceremonies and flower arrangements. The shapes and uses vary, so describing a piece precisely can help people identify it when several boxes are being moved.', '京都の陶芸には食器のほか、茶道や生け花に使う品もあります。形や用途がさまざまなので、箱を移動するときに作品を具体的に説明すると見分けやすくなります。'], question: ['Which description is easier to check: "the pottery" or "the box of blue cups"?', 'The box of blue cups.'], source: 'https://kyoto.travel/en/travel-inspiration/kyoto-craftmanship-various-crafts/' },
    stepA: { instruction: ['Choose the word that shows whether the speaker is guessing or reporting a confirmed detail.', '推測か確認済みの情報かを示す語を選びましょう。'], items: [
      ['The box (might / definitely) be at the cafe; I have not checked yet.', 'might'],
      ['Claire (found / might find) the cups in the storage room yesterday.', 'found'],
      ['The cups will arrive (by / at) 2:30, before the opening.', 'by'],
      ['The exhibition opens (at / by) 3:00.', 'at'],
    ] },
    stepB: { instruction: ['Listen to four short updates. Choose what is confirmed, not what someone only guessed.', '四つの短い連絡を聞き、推測ではなく確認されたことを選びましょう。'], choices: [
      ['Where is the display box?', 'In the storage room', 'Lost outside', 'A'],
      ['Are the cups damaged?', 'Yes', 'No', 'B'],
      ['Who will bring the box?', 'Emma', 'Leo', 'B'],
      ['When does the event open?', 'At 2:30', 'At 3:00', 'B'],
    ], listeningPrompts: [
      'I thought the box was lost outside, but I found it in the storage room.',
      'The cups might have been damaged. I checked them just now: they are all safe.',
      'Emma is busy with the guests. Leo has the box and will deliver it.',
      'The box should arrive by two-thirty. We still open at three.',
    ] },
    mission: {
      situation: ['A visitor has seen an old poster and heard a rumor that Nao\'s blue cups are lost. Nao sends one final voice message with the full outcome. Your tutor plays the visitor.', '来場者は古いポスターを見て、ナオの青いカップがなくなったという噂も聞いています。ナオから最終連絡が届きます。講師は来場者役です。'],
      instruction: ['Listen to Nao\'s full update. Then tell the visitor what was only a worry, what has been confirmed, who helped, and the final event place and time.', 'ナオの最終連絡を聞きましょう。その後、来場者に、心配にすぎなかったこと、確認されたこと、助けてくれた人、最終的な会場と時間を伝えましょう。'],
      text: "Hi everyone, it's Nao. This morning I thought my blue cups were missing, and I was afraid they had been damaged in the cafe leak. It turns out they were safe in a dry storage room. Claire had moved them there to protect them, but in the rush she forgot to tell me. Leo brought the box to the Gojo Art Room before two-thirty, and Emma helped me set up the display. Emma also corrected the old poster and spoke to everyone who had shared it. So please don't worry: the exhibition is going ahead today, Sunday, from three to five at the Gojo Art Room. The exhibition is free; the optional pottery workshop starts at four for people who booked it. I'm grateful we sorted this out together, and I hope to see you there.",
      questions: [['What did Nao fear at first?', 'That the cups were missing or damaged by the leak.'], ['Where were the cups really?', 'Safe in a dry storage room.'], ['Who brought the box and who helped set up?', 'Leo brought it; Emma helped set up.'], ['What is the confirmed exhibition plan?', 'Sunday, 3-5 p.m., at the Gojo Art Room; exhibition entry is free.'], ['When does the optional workshop begin?', 'At four, for people who booked it.']],
      opening: 'I heard the blue cups were lost and the exhibition might be canceled. Is that true?',
      prompts: ['Where were the cups found?', 'Did the old poster have the right address?', 'When and where can I visit?'],
    },
    topics: [
      ['CHECKING FACTS', ['How can you tell a guess from a confirmed fact?', 'What would you ask before repeating a rumor?', 'When should you give someone a correction?']],
      ['MISSING ITEMS', ['What do you check first when you cannot find something important?', 'How can a team keep track of boxes during a move?', 'What is a helpful way to update someone who is worried?']],
      ['WORKING THROUGH A PROBLEM', ['Who do you ask for help in a time-sensitive situation?', 'How do you decide which task to do first?', 'What can people learn after a misunderstanding is resolved?']],
    ],
    story: { previous: 'Emma apologized and corrected the old exhibition poster. Nao is preparing the Gojo Art Room for opening day.', plot: ['Nao fears her featured cups are missing or damaged.', 'Claire finds them safe in dry storage and Leo delivers them.', 'Emma helps set up; the exhibition opens as planned.'], summary: 'The cups are safe, the public information is corrected, and the residents work together to open Nao\'s exhibition.', next: 'The residents can now reflect on how they handled changes, misunderstandings, and uncertain information.' },
  },
};

const bullets = (texts: string[]) => texts.map(text => ({ text }));
const questions = (items: Question[]) => items.map(([question, answer]) => ({ question, answer }));
const guideScript = (skill: Skill, text: string) => skill === 'listening' ? { listeningScript: text.replace(/\n\n/g, '<br><br>') } : {};

export function buildArcLesson(number: 6 | 7 | 8 | 9, previous: any, apiBase: string) {
  const spec = lessons[number];
  const base = buildLesson4(previous, apiBase);
  const [goal, goalJa] = spec.objective;
  const isListening = spec.skill === 'listening';
  const isReading = spec.skill === 'reading';
  const isSpeaking = spec.skill === 'speaking';
  const focus = isReading ? 'READING TIP' : isListening ? 'LISTENING TIP' : 'GRAMMAR TIP';
  const applySteps: any[] = [
    { instruction: isListening ? 'Set up the listening, then read the complete message once for gist and again for details.' : isReading ? 'Ask the learner to read the entire thread before answering.' : 'Ask the learner to read the complete message without interruption.', scripts: bullets([isListening ? 'Listen first for the main problem. On the second listen, check the details.' : isReading ? 'Read the whole thread. Pay attention to the timestamps.' : 'Please read the message from beginning to end.']), ...guideScript(spec.skill, spec.apply.text), tips: bullets([isListening ? 'Keep the script in the tutor guide; do not show the transcript to the learner.' : 'Correct only two or three important pronunciation points after the reading.']) },
    { instruction: 'Ask the comprehension questions and request the clue that supports each answer.', questions: questions(spec.apply.questions) },
  ];
  if (isSpeaking) applySteps.push({ instruction: 'Give planning time, then invite a short uninterrupted version in the learner\'s own words.', scripts: bullets(['Take 20 seconds to plan, then give me your own 45-second message. I will listen until you finish.']) });

  const missionSteps: any[] = [
    { instruction: `Introduce the situation and ${isSpeaking ? 'give 30 seconds of planning time' : isReading ? 'ask the learner to read the notices first' : 'read the complete voice message once for gist'}.`, scripts: bullets([isSpeaking ? 'You have 30 seconds to plan your message. Is the task clear?' : isReading ? 'Please read both notices carefully before I ask questions.' : 'Listen for the main problem first. I will read the message again for details. Is it clear?']), ...(isListening ? guideScript(spec.skill, spec.mission.text) : {}), tips: bullets([isListening ? 'Keep the transcript hidden. On the second listen, use a natural pace and do not exaggerate clue words.' : isSpeaking ? 'Do not interrupt the learner during the sustained talk.' : 'Correct at most two or three pronunciation points after the learner finishes reading.']) },
    { instruction: isSpeaking ? 'The tutor speaks first to launch the task, then listens without interrupting.' : 'The tutor speaks first as the person in the situation. Use follow-up prompts only when needed.', scripts: bullets([spec.mission.opening]), prompts: bullets(spec.mission.prompts), tips: bullets([isSpeaking ? 'Let the learner complete a coherent talk. Ask at most one follow-up after they finish.' : 'Accept a natural summary with accurate final details; do not turn every prompt into a checklist.']) },
    { instruction: 'Check the important details and give one specific success and one focused correction.', questions: isSpeaking ? undefined : questions(spec.mission.questions), tips: bullets([`Base the objective score mainly on Challenge 1 ${isListening ? 'listening comprehension' : isReading ? 'reading comprehension' : 'sustained communication'}.`]) },
  ];

  return {
    ...base,
    id: `conversational-skills-L3-C1-${number}-${spec.skill}-ja-v1`,
    lessonNumber: number, skill: spec.skill, levelBadge: 'L3',
    lessonName: spec.title, lessonTitle: `Lesson ${number}: ${spec.title}`,
    goalTextEn: goal, goalTextJp: goalJa, backgroundImage: '',
    introductionData: {
      introTexts: [{ language: 'en', text: spec.intro[0] }, { language: 'ja', text: spec.intro[1] }],
      introImage: '', lessonIssue: null, lessonGoalDuration: '1 minute',
      lessonGoalSteps: [
        { instruction: 'Introduce the objective first and check understanding.', script: `Our objective for today is: ${goal} Is it clear?` },
        { instruction: 'Introduce the situation, then ask one warm-up question.', script: `Here is our situation. ${spec.intro[0]}`, question: spec.warmup },
      ],
    },
    learnData: { sectionTitle: 'LEARN', steps: [{
      stepType: 'vocabulary', stepName: 'STEP A: VOCABULARY', duration: '4 minutes',
      partLabel: 'Listen and repeat. Notice how each phrase helps you understand or explain the situation.',
      partTranslation: '聞いて繰り返しましょう。それぞれの表現が状況の理解や説明にどう役立つか考えましょう。',
      vocabularyItems: spec.vocabulary.map(([englishText, highlightedWord, translation]) => ({ image: '', englishText, highlightedWord, translation })),
      tutorSteps: [
        { instruction: 'Model each phrase and have the learner repeat. Correct only important pronunciation errors.', script: 'Listen first, then say each phrase with me.' },
        { instruction: 'Ask which phrases describe a problem, a confirmed detail, and a next step.', script: 'Which phrases tell us what is uncertain, what is confirmed, and what happens next?', tip: 'Accept a short explanation in English or Japanese before returning to English practice.' },
        { instruction: 'Have the learner use two phrases in new sentences.', script: 'Choose two phrases and use them in your own or an imagined situation.' },
      ],
    }] },
    stepBData: { stepType: 'grammar-tip', grammarTip: {
      stepName: `STEP B: ${focus}`, duration: '2 minutes',
      explanations: spec.tips.map(tip => ({ ruleText: tip.rule[0], ruleTranslation: tip.rule[1], examplesTitle: tip.heading, examples: tip.examples.map(([sentence, translation]) => ({ sentence, translation })) })),
      tutorSteps: [
        { instruction: `Introduce the ${focus.toLowerCase()}. Have the learner read each example.`, script: 'Read the examples and notice how the meaning changes.' },
        { instruction: 'Check one contrast briefly, then move to the activity.', script: isListening ? 'Which words show a guess and which show the final plan?' : isReading ? 'Which detail happened first, and which detail was confirmed later?' : 'Which sentence takes responsibility, and which sentence reports a completed fix?' },
      ],
    } },
    applyData: {
      sectionNumber: 3, sectionTitle: 'APPLY', activityType: spec.skill, activityTitle: spec.skill.toUpperCase(), activityDuration: '4 minutes',
      situationText: spec.apply.situation[0], situationTranslation: spec.apply.situation[1], situationImage: '',
      dialogueLines: isSpeaking ? [{ speaker: spec.apply.speaker || 'Speaker', text: spec.apply.text, isAction: false }] : [],
      ...(isReading ? { readingText: spec.apply.text, readingImage: '', readingImageLabel: '' } : {}),
      tutorSteps: applySteps,
      triviaEnabled: true, triviaDuration: '1 minute', triviaText: spec.trivia.fact[0], triviaTranslation: spec.trivia.fact[1], triviaImage: '',
      triviaTutorSteps: [
        { instruction: 'Introduce the trivia.', scripts: bullets(["Let's look at the trivia."]) },
        { instruction: 'Ask the student to read the trivia.', scripts: bullets(['Please read the trivia.']) },
        { instruction: 'Check understanding with one question.', questions: questions([spec.trivia.question]) },
        { instruction: 'Transition to Exercise.', scripts: bullets(["Great. Let's continue."]) },
      ],
    },
    exerciseData: {
      ...base.exerciseData,
      sectionNumber: 4, sectionTitle: 'EXERCISE', duration: '4 minutes', stepAType: 'choose', stepAName: 'STEP A',
      instructions: spec.stepA.instruction[0], instructionsTranslation: spec.stepA.instruction[1],
      showExpressions: false, expressions: [], showExample: false, exampleSentence: '', exampleAnswer: '', exampleImage: '', showInfoBox: false,
      exerciseItems: [], changeItems: [], chooseImage: '',
      chooseItems: spec.stepA.items.map(([sentence]) => ({ sentence })),
      answers: bullets(spec.stepA.items.map(([, answer]) => answer)),
      tutorSteps: [
        { instruction: 'Ask the learner to choose each answer and read the full sentence.', scripts: bullets(['Choose the correct expression. Then read the complete sentence.']), answerKey: bullets(spec.stepA.items.map(([, answer], index) => `${index + 1}. ${answer}`)) },
      ],
      hasStepB: true, stepBType: 'multiple-choice', stepBName: 'STEP B',
      stepBInstruction: spec.stepB.instruction[0], stepBInstructionTranslation: spec.stepB.instruction[1],
      conversations: [], multipleChoiceImage: '', compareWordBox: [], compareImages: [], compareItems: [], speechSpeakerImage: '',
      multipleChoiceItems: spec.stepB.choices.map(([boldSentence, optionA, optionB]) => ({ boldSentence, optionA, optionB })),
      stepBTutorSteps: [
        { instruction: spec.stepB.listeningPrompts ? 'Read the numbered messages one at a time; do not show them to the learner.' : 'Have the learner read each short record and choose the supported answer.', ...(spec.stepB.listeningPrompts ? { scripts: bullets(spec.stepB.listeningPrompts.map((item, index) => `${index + 1}. ${item}`)) } : {}) },
        { instruction: 'Check the answers and ask for the clue behind one answer.', answerKey: bullets(spec.stepB.choices.map((choice, index) => `${index + 1}. ${choice[3]} - ${choice[choice[3] === 'A' ? 1 : 2]}`)) },
      ],
    },
    missionData: {
      sectionNumber: 5, sectionTitle: 'MISSION', missionType: spec.skill, challengeNumber: 1, challengeName: 'Challenge 1', duration: '6 minutes',
      situation: spec.mission.situation[0], situationTranslation: spec.mission.situation[1],
      instruction: spec.mission.instruction[0], instructionTranslation: spec.mission.instruction[1],
      showGrammarTip: isSpeaking, grammarTipTitle: isSpeaking ? 'PLAN YOUR MESSAGE' : '', grammarTipItems: spec.mission.planning || [],
      image: '', questions: spec.mission.questions.map(([question]) => ({ question, hints: [] })),
      ...(isReading ? { readingPassage: { title: spec.mission.title || 'Latest Notice', showAuthor: false, headerAlignment: 'left', blocks: [{ type: 'paragraph', content: spec.mission.text }] } } : {}),
      tutorSteps: missionSteps,
    },
    missionData2: {
      sectionNumber: 5, sectionTitle: 'MISSION', missionType: 'discussion', challengeNumber: 2, challengeName: 'Challenge 2', duration: '2 minutes', isOptional: true,
      situation: 'Connect this lesson to everyday communication.', situationTranslation: 'このレッスンを日常のコミュニケーションに結び付けましょう。',
      instruction: isSpeaking ? 'Choose a general topic and give a short, connected answer. Your tutor will listen before asking a follow-up.' : 'Choose one general topic. Discuss it with your tutor using your own or an imagined example.',
      instructionTranslation: isSpeaking ? '一般的なトピックを一つ選び、まとまった答えを話しましょう。講師は最後まで聞いてから追加質問をします。' : '一般的なトピックを一つ選び、自分の経験か想像した例を使って講師と話しましょう。',
      showGrammarTip: false, grammarTipTitle: '', grammarTipItems: [], questions: [],
      topics: spec.topics.map(([title, items]) => ({ title, questions: items })),
      tutorSteps: [
        { instruction: 'If time remains, ask the learner to choose one of the three general topics. The tutor speaks first.', scripts: bullets(['Which topic would you like to discuss?']), tips: bullets(['Skip this optional challenge if Challenge 1 or feedback needs more time.']) },
        { instruction: 'Use the questions as guides, not a checklist. Ask a natural follow-up after the learner finishes.', tips: bullets(['Do not bring the story characters into this general free talk.']) },
      ],
    },
    feedbackData: {
      ...base.feedbackData, goal, goalJp: goalJa, rubricTitle: 'LESSON OBJECTIVE ACHIEVEMENT',
      rememberNote: 'Give feedback based on the learner\'s actual Challenge 1 performance. Name one specific success and one useful next step.',
      tutorSteps: [
        { instruction: 'Introduce Feedback.', scripts: bullets(["Okay, now let's do Feedback."]) },
        { instruction: 'Have the student read the lesson objective.' },
        { instruction: 'Ask if they achieved the lesson objective.', scripts: bullets(['Did you achieve the lesson objective?']) },
        { instruction: 'Give the student a score for their objective achievement using the rubric.', tips: bullets(['Base your score mainly on Challenge 1.']) },
        { instruction: "Give feedback on the student's range, accuracy, and fluency using the fixed guide below.", tips: bullets(['Use actual words and performance, not the sample examples.']) },
        { instruction: 'Wrap up the lesson.', scripts: bullets(['You did a great job today. Thank you very much!']) },
      ],
    },
    storyData: {
      enabled: true, storyTitle: 'Life at Kamo House', setting: 'A fictional international shared house in Kyoto. All characters are adults.',
      characters: [
        { id: 'emma', name: 'Emma', role: 'main', description: 'A graphic designer who recently moved to Kyoto and enjoys photography.' },
        { id: 'claire', name: 'Claire', role: 'supporting', description: 'A Kyoto resident who helps run the cafe downstairs.' },
        { id: 'nao', name: 'Nao', role: 'supporting', description: 'A ceramics student preparing her first small exhibition.' },
        { id: 'leo', name: 'Leo', role: 'supporting', description: 'A bakery worker who helps at the cafe and supports the housemates.' },
      ],
      previousSummary: spec.story.previous, currentPlotPoints: spec.story.plot, currentEpisodeSummary: spec.story.summary,
      nextEpisodeHook: spec.story.next,
      storyNotes: `Japanese support edition. Kamo House, Gojo Art Room, the exhibition, and all event details are fictional. Kyoto pottery trivia source: ${spec.trivia.source}. All image fields are intentionally empty.`,
    },
  };
}
