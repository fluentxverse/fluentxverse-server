import { buildLesson6 } from './lesson-6-listening';
import { buildStepBTutorGuide } from './standardize-tutor-guides';

export const lesson7Id = 'conversational-skills-L3-C1-7-reading-ja-v1';
export const lesson7UsefulLanguage = [
  'According to the message, ...',
  'This happened before ...',
  'The old poster says ..., but the latest notice says ...',
  'The correct details are ...',
];
export const lesson7Thread = [
  ['9:50 | Emma', 'I have scheduled our exhibition poster to go online at 10:15. It says Sunday, two to five, at Kamo House cafe.'],
  ['10:05 | Nao', 'A pipe burst in the cafe. We may have to cancel. Please do not share the poster yet.'],
  ['10:10 | Claire', 'Good news! The Gojo Art Room is confirmed for tomorrow, Sunday, three to five. The exhibition can go ahead. Please update the poster.'],
  ['10:13 | Emma', 'I heard the new messages. I will speak to Leo now and ask him to call your teacher.'],
  ['10:15 | Automatic post', "Nao's first pottery exhibition: Sunday, two to five, at Kamo House cafe."],
  ['10:20 | Nao', "Emma, the old poster is online. Didn't you listen to my message? I thought you understood how important this is."],
  ['10:25 | Emma', 'I did listen. I scheduled that post at 9:50 and forgot to stop it. It went online automatically while I was speaking to Leo. I am sorry. I have replaced it with the correct venue and time.'],
  ['10:28 | Nao', 'Thank you for correcting it. But some people have already shared the old version. We need to talk.'],
].map(([speaker, text]) => `<p><strong>${speaker}</strong><br>${text}</p>`).join('');

export const lesson7Notices = [
  { type: 'paragraph', content: '<strong>OLD POSTER - published Saturday, 10:15</strong><br>Sunday, 2-5 p.m.<br>Kamo House cafe<br>Exhibition entry: free<br>Pottery workshop: 3 p.m.<br>Please use the front entrance.' },
  { type: 'paragraph', content: '<strong>CORRECTED NOTICE - updated Saturday, 11:00</strong><br>Nao\'s Pottery Exhibition<br>Sunday, 3-5 p.m.<br>Gojo Art Room<br>Exhibition entry: free. No booking needed to see the pottery.<br>Use the side entrance beside the bicycle parking area. The front entrance is closed.<br>Optional pottery workshop: Sunday, 4 p.m. Price: 800 yen per person.<br>Reserve a workshop place by Saturday at 6 p.m.<br>This notice replaces the old poster. Please share this version.' },
];
const objective = 'I can read messages and updated notices to explain what happened and give the correct event details.';
const objectiveJa = 'メッセージや変更後のお知らせを読み、何が起きたかを説明し、正しいイベント情報を伝えられる。';
const bullets = (texts: string[]) => texts.map(text => ({ text }));
const triviaSource = 'https://www.mediawiki.org/wiki/Help:History';

export function buildLesson7(previous: any, apiBase: string, reference?: any) {
  const base = buildLesson6(previous, apiBase, reference);
  const learn = base.learnData.steps[0];
  const vocabulary = [
    ['Please read the latest update.', 'latest update', '最新の変更連絡を読んでください。'],
    ['The scheduled post went online at 10:15.', 'scheduled post', '予約投稿は10時15分に公開されました。'],
    ['The poster has the old address.', 'old address', 'そのポスターには変更前の住所が載っています。'],
    ['I need to correct a mistake.', 'correct a mistake', '間違いを訂正する必要があります。'],
    ['Emma scheduled the post before the venue changed.', 'before', 'エマは会場が変わる前に投稿を予約しました。'],
    ['She corrected the poster after Nao saw it.', 'after', 'ナオが見た後で、エマはポスターを訂正しました。'],
  ];
  const stepA: [string, string][] = [
    ['The post was scheduled at 9:50. The venue update came at 10:10. The post was scheduled (before / after) the update.', 'before'],
    ['The old post appeared at 10:15. Emma corrected it at 10:25. She corrected it (before / after) it appeared.', 'after'],
    ['The notice updated at 11:00 replaces the 10:15 poster. The (latest / oldest) notice gives the current details.', 'latest'],
    ['Nao says, "I think Emma ignored me." This is Nao\'s (belief / confirmed fact).', 'belief'],
    ['The system published the scheduled post. It went online (automatically / by hand).', 'automatically'],
    ['Emma found the wrong time and changed it. She (corrected / repeated) the mistake.', 'corrected'],
  ];
  const choices = [
    ['First notice: Saturday, 4 p.m., Room A. Update: Saturday, 4 p.m., Room B. What changed?', 'The starting time', 'The room', 'B'],
    ['Original invitation: Entry 500 yen. Corrected invitation: Entry free; workshop 500 yen. What does it cost just to enter?', 'Nothing', '500 yen', 'A'],
    ['10:00: A post is scheduled. 10:20: The time changes. 10:30: The old post appears automatically. What does the record show?', 'The post was scheduled after the change', 'The post was scheduled before the change', 'B'],
    ['Aya: "I think Jun saw my update." Jun has not replied. What is confirmed by this message?', 'Aya thinks Jun saw it', 'Jun has definitely seen it', 'A'],
  ];
  return {
    ...base, id: lesson7Id, skill: 'reading', lessonName: 'The Poster Went Out', lessonTitle: 'Lesson 7: The Poster Went Out',
    goalTextEn: objective, goalTextJp: objectiveJa,
    introductionData: {
      ...base.introductionData,
      introTexts: [
        { language: 'en', text: 'The exhibition has a new venue, but the old poster is now online. Nao thinks Emma ignored the messages. Emma says she listened. The Kamo House message thread contains the missing piece of the story. Read the times before deciding what happened.' },
        { language: 'ja', text: '展示会の会場は変わったのに、古いポスターがオンラインに公開されてしまいました。ナオはエマが連絡を無視したと思っていますが、エマは聞いたと言います。何が起きたかを知る手掛かりは、Kamo Houseのメッセージのやり取りにあります。判断する前に時刻を確認しましょう。' },
      ],
      lessonGoalSteps: [
        { instruction: 'Introduce the lesson objective and check understanding.', script: 'Our lesson objective today is to read messages and updated notices to explain what happened and give the correct event details. Is it clear?' },
        { instruction: 'Introduce the situation.', script: 'Here is our situation. Nao is upset because the old poster went online. Emma says she heard the update. We will read the message thread to find out what happened.' },
        { instruction: 'Ask the student a warm-up question.', script: 'Have you ever seen an invitation with the wrong place or time? What did you check?' },
        { instruction: 'Transition to the next section.', script: "Great! Let's go to the next part!" },
      ],
    },
    learnData: { ...base.learnData, steps: [{
      ...learn,
      vocabularyItems: vocabulary.map(([englishText, highlightedWord, translation], index) => ({ englishText, highlightedWord, translation, image: previous?.learnData?.steps?.[0]?.vocabularyItems?.[index]?.image || '' })),
      discussionPart: {
        instruction: 'II. A friend sends an invitation and then changes the time. How would you find the correct time? Use two phrases from Part I.',
        instructionTranslation: '友達から招待のメッセージが届いた後、時刻が変更になりました。正しい時刻をどう確認しますか。パートIの表現を二つ使いましょう。', images: [],
        tutorSteps: [
          { instruction: 'Introduce Part II.', script: "Okay, now let's do Part II." },
          { instruction: 'Read the instructions and check understanding.', script: 'Your friend changed the time after sending an invitation. How would you find the correct time? Is it clear?' },
          { instruction: 'Have the student answer using the vocabulary from Part I.', tip: 'Accept one or two sentences about checking the latest update and comparing when the messages were sent.' },
          { instruction: 'Ask one natural follow-up based on the answer.', script: 'What would you do if the two messages were still unclear?', tip: 'Keep Part II to about one minute.' },
          { instruction: 'Transition to Part III.', script: "Good! Let's go to the next part!" },
        ],
      },
      pronunciationPart: {
        instruction: 'Listen and repeat. Then practise the word pairs.', instructionTranslation: '聞いて繰り返しましょう。その後、単語のペアを発音する練習をしましょう。',
        leftColumn: { soundSymbol: '/p/', images: [], words: [{ word: 'pack', translation: '荷造りする', isHighlighted: true }, { word: 'cap', translation: '帽子' }, { word: 'lap', translation: '膝の上' }] },
        rightColumn: { soundSymbol: '/b/', images: [], words: [{ word: 'back', translation: '戻って', isHighlighted: true }, { word: 'cab', translation: 'タクシー' }, { word: 'lab', translation: '実験室' }] },
        tutorSteps: [
          { instruction: 'Introduce Part III and read the instructions.', script: "Now let's practise /p/ and /b/. Listen and repeat." },
          { instruction: 'Model /p/, then read each word on the left and have the student repeat.', tip: 'Close both lips, then release the air without using your voice. The initial /p/ in pack has a small puff of air.' },
          { instruction: 'Model /b/, then read each word on the right and have the student repeat.', tip: 'Use the same lip closure and add your voice. Model your natural accent; do not add an extra vowel after the final consonant.' },
          { instruction: 'Read each pair and have the student repeat.', script: "Now let's compare the words. Pack, back. Cap, cab. Lap, lab.", tip: 'Repeat a difficult pair once if needed. Keep this part to about one minute.' },
          { instruction: 'Transition to Step B.', script: "Great! Let's go to Step B Reading Tip!" },
        ],
      },
    }] },
    stepBData: { stepType: 'grammar-tip', grammarTip: {
      stepName: 'STEP B: READING TIP', duration: '2 minutes',
      explanations: [
        { ruleText: 'Read the date and time beside each message. Before and after help you put events in order. Check when a post was scheduled as well as when it appeared.', ruleTranslation: '各メッセージにある日付と時刻を読みましょう。before と after は出来事の順番を整理するのに役立ちます。投稿が公開された時刻だけでなく、予約された時刻も確認しましょう。', examplesTitle: 'CHECK THE ORDER', examples: [
          { sentence: '9:50: Emma schedules a post. 10:10: Claire sends an update. Emma schedules the post before the update.', translation: '9時50分：エマが投稿を予約。10時10分：クレアが変更を連絡。エマが投稿を予約したのは、変更連絡より前です。' },
          { sentence: '10:15: The post appears. 10:25: Emma corrects it. She corrects it after it appears.', translation: '10時15分：投稿が公開される。10時25分：エマが訂正。エマが訂正したのは、公開された後です。' },
        ] },
        { ruleText: 'A message that says I think shows someone\'s belief, not proof. Compare it with the record. For event details, use the latest confirmed notice, not an older poster.', ruleTranslation: 'I think と書かれたメッセージは、その人の考えを示すもので、証拠とは限りません。記録と比べましょう。イベント情報は古いポスターではなく、確認済みの最新のお知らせで確認します。', examplesTitle: 'BELIEF OR EVIDENCE?', examples: [
          { sentence: 'Nao thinks Emma ignored the update. But Emma\'s 10:13 message says she heard it.', translation: 'ナオはエマが変更連絡を無視したと思っています。しかし、エマの10時13分のメッセージには、連絡を聞いたと書かれています。' },
          { sentence: 'The old poster says two, but the latest notice says three.', translation: '古いポスターには2時とありますが、最新のお知らせには3時とあります。' },
        ] },
      ],
      tutorSteps: buildStepBTutorGuide('The post was scheduled at 9:50 and the update came at 10:10. Which happened first?', 'Accept that the post was scheduled first. Give one brief correction if needed.').map((step, index) => index === 0 ? { ...step, instruction: 'Read the reading tips and ask the student to read the examples.', script: 'Please read the examples. Notice the times and the wording that supports each conclusion.' } : step),
    } },
    applyData: {
      ...base.applyData, activityType: 'reading', activityTitle: 'READING', activityDuration: '4 minutes',
      situationText: 'Read the Kamo House messages from Saturday morning. Find when the poster was scheduled, when the plan changed, and when the old poster appeared. Then explain the misunderstanding.',
      situationTranslation: '土曜の朝のKamo Houseのメッセージを読みましょう。投稿が予約された時刻、予定が変わった時刻、古いポスターが公開された時刻を確認し、誤解が生まれた理由を説明しましょう。',
      dialogueLines: [], readingText: lesson7Thread, readingImage: '', readingImageLabel: '',
      tutorSteps: [
        { instruction: 'Set up the reading and ask the student to read the complete message thread aloud.', scripts: bullets(['Please read the messages in time order. Notice who wrote each one and when.']), tips: bullets(['Read the situation first. Let the student finish before correcting at most two or three important pronunciation errors.']) },
        { instruction: 'Ask the questions below and have the student point to the wording that supports each answer.', questions: [
          { question: 'Did Emma schedule the poster before or after Claire confirmed the new venue?', answer: 'Before. Emma scheduled it at 9:50; Claire confirmed the new venue at 10:10.' },
          { question: 'Which message shows that Emma heard the update?', answer: 'Her 10:13 message: I heard the new messages.' },
          { question: 'Why did the wrong poster appear at 10:15?', answer: 'It was a scheduled post. Emma forgot to stop it, and it appeared automatically while she was speaking to Leo.' },
          { question: 'What did Emma do at 10:25?', answer: 'She explained the mistake, apologized, and said she had replaced the post with the correct venue and time.' },
          { question: 'Why is Nao still upset after the correction?', answer: 'Some people have already shared the old version.' },
        ], tips: bullets(['Accept the student\'s own wording when it matches the text. Distinguish Nao\'s belief from the evidence without dismissing her feelings.']) },
      ],
      triviaText: 'A changed web page does not always erase its past. Many wikis keep a page history with the dates and times of earlier versions. On sites that use MediaWiki, readers can compare two versions to see what changed. A screenshot shows only one moment, so checking the history can give you more context. A newer version is not automatically true, but it can show what was edited.',
      triviaTranslation: 'ウェブページが変わっても、以前の内容が必ず消えてしまうわけではありません。多くのウィキには、過去の版の日付や時刻を記録する履歴があります。MediaWikiを使うサイトでは、二つの版を比べて変更点を確認できます。スクリーンショットはある一時点しか示さないため、履歴を見ると背景をより詳しく知ることができます。新しい版が必ず正しいとは限りませんが、何が編集されたかは確認できます。',
      triviaTutorSteps: [
        { instruction: 'Introduce the trivia.', scripts: bullets(["Let's look at the trivia."]) },
        { instruction: 'Ask the student to read the trivia.', scripts: bullets(['Please read the trivia.']) },
        { instruction: 'Check understanding and ask the question below.', questions: [{ question: 'An old screenshot and a current event page show different times. What would you check before sharing either one?', answer: 'For example: the update times, the page history if available, and the organizer\'s latest confirmed notice.' }] },
        { instruction: 'Transition to Exercise.', scripts: bullets(["Great. Let's continue."]) },
      ],
    },
    exerciseData: {
      ...base.exerciseData,
      instructions: 'Read each short record. Choose the word or phrase supported by the information.', instructionsTranslation: '短い記録を読み、その情報に合う語や表現を選びましょう。',
      chooseItems: stepA.map(([sentence]) => ({ sentence })), answers: bullets(stepA.map(([, answer]) => answer)),
      tutorSteps: [{ instruction: 'Have the student choose each phrase, then read the whole sentence.', scripts: bullets(['Read the record, choose an answer, and read the complete sentence.']), answerKey: bullets(stepA.map(([, answer], index) => `${index + 1}. ${answer}`)), tips: bullets(['Mark each item using the existing lesson assessment controls. Record the actual incorrect response, especially any confusion about event order or belief versus fact.']) }],
      stepBInstruction: 'Read each pair of notices or messages. Choose the answer supported by the text.', stepBInstructionTranslation: '各組のお知らせやメッセージを読み、本文に裏付けられた答えを選びましょう。',
      multipleChoiceItems: choices.map(([boldSentence, optionA, optionB]) => ({ boldSentence, optionA, optionB })),
      stepBTutorSteps: [
        { instruction: 'Have the student read each record and choose an answer.', scripts: bullets(['Read both parts before choosing. Which words or times support your answer?']), tips: bullets(['Keep all records visible. This is a reading task, not a memory test. Mark each item and note the incorrect choice using the existing assessment controls.']) },
        { instruction: 'Check the answers and ask for the clue behind one answer.', answerKey: bullets(choices.map((choice, index) => `${index + 1}. ${choice[3]} - ${choice[choice[3] === 'A' ? 1 : 2]}`)), tips: bullets(['Ask the student to reread the relevant line before giving the answer.']) },
      ],
    },
    missionData: {
      ...base.missionData, missionType: 'reading',
      situation: 'You are Emma. A visitor has seen the old poster and is planning to come to the exhibition. Your tutor is the visitor. Read the old poster and the corrected notice before you talk.',
      situationTranslation: 'あなたはエマ役です。古いポスターを見た来場予定の人が、展示会について尋ねます。講師はその来場者役です。話す前に、古いポスターと訂正後のお知らせを読みましょう。',
      instruction: 'Help the visitor use the corrected notice. Explain the right venue, hours, and entrance. Then answer their questions about entry, the optional workshop, and the booking deadline. Keep the notices visible and refer to the text.',
      instructionTranslation: '訂正後のお知らせを使って来場者を案内しましょう。正しい会場、開催時間、入口を説明し、入場、任意参加のワークショップ、申込期限についての質問に答えましょう。お知らせは見える状態にして、本文を確認しながら話しましょう。',
      grammarTipTitle: 'Useful language', grammarTipItems: [...lesson7UsefulLanguage],
      readingPassage: { title: 'Which Notice Should Visitors Use?', showAuthor: false, headerAlignment: 'left', blocks: structuredClone(lesson7Notices), closingQuestion: '' },
      tutorSteps: [
        { instruction: 'Read the situation and instructions, then check understanding.', scripts: bullets(['Please read the situation and instructions. Is it clear?']) },
        { instruction: 'Ask the student to read the complete notices before the roleplay.', scripts: bullets(['Please read both notices aloud. Compare the place, time, entrance, and workshop conditions.']), tips: bullets(['Correct at most two or three important pronunciation errors after reading. Keep the notices visible throughout the roleplay.']) },
        { instruction: 'Start the roleplay. The tutor speaks first; use follow-ups only when the student needs support.', scripts: bullets([
          "I'll be a visitor. Please be Emma. You may use the useful language and refer to the notices. I'll start.",
          '1. Hi Emma, I saw the first poster. Shall I come to the cafe at two tomorrow?',
          '2. Thanks for telling me. Should I use the front entrance at the new venue?',
          '3. I only want to see the pottery. Do I need to pay or book a place?',
          '4. My friend wants to try the workshop. When does it start, and how much does it cost?',
          '5. Can my friend wait until Sunday morning to reserve a workshop place?',
          '6. Which notice should I send to my friend so they get the right details?',
        ]), tips: bullets(['Let the student finish before correcting. Use later lines only when the information has not already been given. Ask where in the notice they found an answer if support is needed.', 'Reading evidence: Sunday 3-5 p.m., Gojo Art Room; side entrance beside bicycle parking, not the closed front entrance; exhibition free with no booking; optional workshop Sunday at 4 p.m., 800 yen; reserve by Saturday at 6 p.m.; share the corrected version.', 'Base the objective score on finding and explaining the written details, not memorizing Lesson 6 or making a long speech. Record the actual missed details in tutor notes.']) },
        { instruction: 'Give specific feedback and retry one part that needs support.', scripts: bullets(['After helping the visitor, Emma sees Nao\'s reply: "The notice is fixed, but I was counting on you. Can we talk?" The next lesson continues their conversation.', "Great job! Let's go to the next part!"]), tips: bullets(['Give one specific reading success and one focused correction before reading the closing story line. The closing line is not an assessment question.', 'Do Challenge 2 only if there is time left before Feedback.']) },
      ],
    },
    missionData2: {
      ...base.missionData2,
      topics: [
        { title: 'ONLINE INVITATIONS', questions: ['Do you usually read an invitation carefully or just check the time?', 'What information makes an invitation easy to understand?', 'How would you tell a friend that an invitation has changed?'] },
        { title: 'BEFORE YOU ASSUME', questions: ['Have you ever misunderstood a short message?', 'What would you ask before deciding someone ignored you?', 'Is it easier to clear up a misunderstanding by text or by talking? Why?'] },
        { title: 'CORRECTING A MISTAKE', questions: ['What would you do first if you shared the wrong event details?', 'Who would you contact directly?', 'What could help you avoid the same mistake next time?'] },
      ],
    },
    feedbackData: { ...base.feedbackData, goal: objective, goalJp: objectiveJa, rememberNote: 'Give feedback based on actual Challenge 1 reading evidence. Separate missed written details from speaking errors in the explanation. Name one success and one useful next reading strategy.' },
    storyData: {
      ...base.storyData,
      setting: 'A fictional shared house above a cafe in Kyoto, on the Saturday before Nao\'s Sunday exhibition. All characters are adults.',
      previousSummary: 'In Lesson 6, a burst pipe closed Kamo House cafe. Claire confirmed the Gojo Art Room for Sunday, 3-5 p.m. Emma heard the update and passed Nao\'s request to Leo, but the old poster appeared online and Nao challenged her.',
      currentPlotPoints: ['Emma scheduled the old poster at 9:50, before the venue update at 10:10.', 'Her 10:13 message confirms she heard the update. The old post publishes automatically at 10:15 while she speaks to Leo.', 'Nao assumes Emma ignored her. At 10:25 Emma explains that she forgot to stop the scheduled post and has corrected it.', 'A later corrected notice gives new entrance and workshop details, which Emma explains to a visitor.', 'The public information is fixed, but Nao wants a personal conversation about the effect of the mistake.'],
      currentEpisodeSummary: 'The message timeline explains the scheduled post without excusing the missed check. Emma helps visitors use the corrected notice, but she still needs to repair Nao\'s trust.',
      nextEpisodeHook: 'Lesson 8: Emma and Nao speak directly. Emma needs to apologize, listen to Nao, and agree on practical next steps in a dialogue.',
      storyNotes: `No images generated; preserve existing image fields. Apply thread: Saturday 9:50-10:28. The corrected visitor notice at 11:00 adds entrance and workshop details; it does not change the confirmed Sunday exhibition hours. Do not reuse the older draft's claim that Emma had not seen the update on a train. All venue, entrance and event details are fictional. Trivia source: ${triviaSource}`,
    },
  };
}
