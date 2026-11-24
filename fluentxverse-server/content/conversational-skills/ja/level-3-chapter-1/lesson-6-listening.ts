import { requireDefined } from '../../../../../shared/requireDefined';
import { buildLesson4 } from './lesson-4-speaking';
import { buildStepBTutorGuide } from './standardize-tutor-guides';

export const lesson6Id = 'conversational-skills-L3-C1-6-listening-ja-v1';
export const lesson6UsefulLanguage = [
  "There's been a change of plans.",
  "We're meeting at ... instead.",
  'The new starting time is ...',
  'Just to confirm, ... Is that right?',
  'Could you pass the message on to ...?',
];
export const lesson6ApplyScript = '<p><strong>Nao:</strong> Hi Emma. A pipe broke in the cafe. The floor is wet. We cannot use it tomorrow.<br>My old teacher is coming to my exhibition. Do we have to cancel? Please wait before sharing the poster.</p><p><strong>Claire:</strong> Hi Emma. Good news! The exhibition is not canceled.<br>We\'re meeting at the Gojo Art Room instead. It is still on Sunday, from three to five.<br>The new starting time is three, not two.</p>';
export const lesson6MissionScript = '<p>Hi Emma. The exhibition is still on Sunday. It is at the Gojo Art Room, from three to five.<br>My teacher does not know about the change. Could you pass the message on to Leo? He has her phone number.<br>Please ask him to call her this morning. Please check with Claire before sharing the new poster.</p>';
const objective = 'I can understand a change of plans in voice messages and pass on the confirmed details.';
const objectiveJa = '音声メッセージで予定の変更を理解し、確定した情報をほかの人に伝えられる。';
const bullets = (texts: string[]) => texts.map(text => ({ text }));
const triviaSource = 'https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_4.html';

export function buildLesson6(previous: any, apiBase: string, reference?: any) {
  const base = buildLesson4(previous, apiBase, reference);
  const learn = requireDefined(base.learnData.steps[0], "base.learnData.steps[0]");
  const vocabulary = [
    ["There's been a change of plans.", 'a change of plans', '予定が変わりました。'],
    ["We're meeting at the Gojo Art Room instead.", 'instead', '代わりに五条アートルームで会います。'],
    ['The new starting time is three.', 'starting time', '新しい開始時刻は3時です。'],
    ['Just to confirm, it starts at three. Is that right?', 'Just to confirm', '確認ですが、3時に始まるのですね。合っていますか。'],
    ['Could you pass the message on to Leo?', 'pass the message on', 'レオにこのことを伝えてもらえますか。'],
    ['The cafe is closed for repairs.', 'closed for repairs', 'カフェは修理のため休業しています。'],
  ];
  const choices = [
    ['Where should the guests go?', 'Kamo House cafe', 'Gojo Art Room', 'B'],
    ['What is the confirmed starting time?', 'Two o\'clock', 'Three o\'clock', 'B'],
    ['Which day is confirmed?', 'Sunday', 'Saturday', 'A'],
    ['What should Leo do first?', 'Share the old poster', 'Confirm the new details with the teacher', 'B'],
  ];
  const messages = [
    'We were going to meet at Kamo House cafe. The cafe is closed, so please come to the Gojo Art Room instead.',
    'The old poster says two. Please ignore that time. The new starting time is three.',
    'The place and time have changed, but the exhibition is still on Sunday, not Saturday.',
    'Leo, please do not share the old poster. Call the teacher first and check that she knows the new place and time.',
  ];
  const stepA: [string, string][] = [
    ["There's been a change (of / for) plans.", 'of'],
    ["We're meeting at the gallery (instead / still) of the cafe.", 'instead'],
    ['The new starting time (is / are) three.', 'is'],
    ['Just to (confirm / cancel), we are meeting at three. Is that right?', 'confirm'],
    ['Could you pass the message (on / at) to Leo?', 'on'],
    ['The exhibition is (still / instead) on Sunday. The day has not changed.', 'still'],
  ];
  return {
    ...base, id: lesson6Id, skill: 'listening',
    lessonName: 'Please Don\'t Cancel', lessonTitle: 'Lesson 6: Please Don\'t Cancel',
    goalTextEn: objective, goalTextJp: objectiveJa,
    backgroundImage: previous?.backgroundImage || '',
    introductionData: {
      ...base.introductionData,
      introImage: previous?.introductionData?.introImage || '',
      introTexts: [
        { language: 'en', text: 'A few days after their interrupted bike outing, the Kamo House friends are helping Nao prepare her first pottery exhibition. Emma has designed the poster, and Claire has invited the guests. Then, on Saturday morning, a pipe bursts in the cafe. Nao\'s old teacher is coming tomorrow. Can they save the exhibition in time?' },
        { language: 'ja', text: '自転車での外出が途中で予定変更になってから数日後。Kamo Houseの仲間たちは、ナオの初めての陶芸展示会を手伝っています。エマはポスターを作り、クレアは来場者を招待しました。ところが土曜の朝、カフェの配管が破裂します。明日はナオの以前の陶芸の先生も来る予定です。無事に展示会を開けるのでしょうか。' },
      ],
      lessonGoalSteps: [
        { instruction: 'Introduce the lesson objective and check understanding.', script: 'Our lesson objective today is to understand a change of plans in voice messages and pass on the confirmed details. Is it clear?' },
        { instruction: 'Introduce the situation.', script: 'Here is our situation. A burst pipe has closed the cafe before Nao\'s first exhibition. Emma receives two messages: one from Nao and one from Claire.' },
        { instruction: 'Ask the student a warm-up question.', script: 'If the place for an important event changes, who would you tell first?' },
        { instruction: 'Transition to the next section.', script: "Great! Let's go to the next part!" },
      ],
    },
    learnData: { ...base.learnData, steps: [{
      ...learn,
      vocabularyItems: vocabulary.map(([englishText, highlightedWord, translation], index) => ({
        englishText, highlightedWord, translation, image: previous?.learnData?.steps?.[0]?.vocabularyItems?.[index]?.image || '',
      })),
      tutorSteps: learn.tutorSteps.map((step, index) => index === 0 ? { ...step, script: "Now, let's try Learn. First we have Step A Vocabulary. Let's do Part I." } : step),
      discussionPart: {
        instruction: 'II. Your dinner reservation has moved to another restaurant and starts an hour later. What would you tell a friend? Use two phrases from Part I.',
        instructionTranslation: '夕食の予約先が別のレストランに変わり、開始時刻も1時間遅くなりました。友達に何と伝えますか。パートIの表現を二つ使いましょう。', images: [],
        tutorSteps: [
          { instruction: 'Introduce Part II.', script: "Okay, now let's do Part II." },
          { instruction: 'Read the instructions and check understanding.', script: 'The restaurant and time have changed. What would you tell your friend? Is it clear?' },
          { instruction: 'Have the student answer using the vocabulary from Part I.', tip: 'Let the student choose a restaurant and a time. Accept two short sentences with sensible details.' },
          { instruction: 'Ask one natural follow-up based on the answer.', script: 'How would you check that your friend understood?', tip: 'Keep Part II to about one minute.' },
          { instruction: 'Transition to Part III.', script: "Good! Let's go to the next part!" },
        ],
      },
      pronunciationPart: {
        instruction: 'Listen and repeat. Then practise the word pairs.', instructionTranslation: '聞いて繰り返しましょう。その後、単語のペアを発音する練習をしましょう。',
        leftColumn: { soundSymbol: '/f/', images: [], words: [{ word: 'fan', translation: '扇風機', isHighlighted: true }, { word: 'fine', translation: '元気な' }, { word: 'safe', translation: '安全な' }] },
        rightColumn: { soundSymbol: '/v/', images: [], words: [{ word: 'van', translation: 'バン（車）', isHighlighted: true }, { word: 'vine', translation: 'つる植物' }, { word: 'save', translation: '救う' }] },
        tutorSteps: [
          { instruction: 'Introduce Part III and read the instructions.', script: "Now let's practise /f/ and /v/. Listen and repeat." },
          { instruction: 'Model /f/, then read each word on the left and have the student repeat.', tip: 'Touch the lower lip lightly with the upper teeth and let air flow. Do not use your voice.' },
          { instruction: 'Model /v/, then read each word on the right and have the student repeat.', tip: 'Keep the same lip position and add your voice. Let the student feel the vibration gently at the throat.' },
          { instruction: 'Read each pair and have the student repeat.', script: "Now let's compare the words. Fan, van. Fine, vine. Safe, save.", tip: 'Repeat a difficult pair once if needed. Keep this part to about one minute.' },
          { instruction: 'Transition to Step B.', script: "Great! Let's go to Step B Listening Tip!" },
        ],
      },
    }] },
    stepBData: { stepType: 'grammar-tip', grammarTip: {
      stepName: 'STEP B: LISTENING TIP', duration: '2 minutes',
      explanations: [
        { ruleText: 'Listen for but, instead, and the new ... to find a changed detail. Still tells you what has not changed. Listen to the whole update before deciding.', ruleTranslation: 'but、instead、the new ... に注目すると変更点が分かります。still は変わっていない情報を示します。判断する前に、連絡を最後まで聞きましょう。', examplesTitle: 'CHANGED OR UNCHANGED?', examples: [
          { sentence: 'We were going to meet at the cafe, but we are meeting at the Gojo Art Room instead.', translation: 'カフェで会う予定でしたが、代わりに五条アートルームで会います。' },
          { sentence: 'It is still on Sunday. The new starting time is three.', translation: '日曜日であることは変わりません。新しい開始時刻は3時です。' },
        ] },
        { ruleText: 'I think and may can signal uncertainty. Confirmed tells you a detail has been checked. Repeat the key details with Just to confirm, ... Is that right?', ruleTranslation: 'I think や may は、まだ確かでないことを表す場合があります。confirmed は、確認済みであることを示します。大切な情報は Just to confirm, ... Is that right? を使って復唱し、確認しましょう。', examplesTitle: 'WORRY OR CONFIRMED PLAN?', examples: [
          { sentence: 'I think we may have to cancel. / Claire has confirmed the new room. We can go ahead.', translation: '中止しなければならないかもしれません。／クレアが新しい会場を確認しました。開催できます。' },
          { sentence: 'Just to confirm, Sunday at three at the Gojo Art Room. Is that right?', translation: '確認ですが、日曜日の3時に五条アートルームですね。合っていますか。' },
        ] },
      ],
      tutorSteps: buildStepBTutorGuide('Which detail changed, and which stayed the same?', 'Use the examples above. Accept that the place and starting time changed, but the day is still Sunday. Confirm one answer briefly, then continue.').map((step, index) => index === 0 ? {
        ...step, instruction: 'Read the listening tips and ask the student to read the examples.', script: 'Please read the examples. Notice which details change and which are confirmed.',
      } : step),
    } },
    applyData: {
      ...base.applyData, activityType: 'listening', activityTitle: 'LISTENING', activityDuration: '4 minutes',
      situationText: 'It is Saturday. Listen to two short messages. Nao has a problem. Claire has a new plan.',
      situationTranslation: '土曜日です。二つの短いメッセージを聞きましょう。ナオは困っています。クレアには新しい案があります。',
      situationImage: previous?.applyData?.situationImage || '', dialogueLines: [], readingText: '', readingImage: '',
      tutorSteps: [
        { instruction: 'Set up the listening and read the messages once for the main idea.', scripts: bullets(['First, listen to Nao. Then, listen to Claire. Is the exhibition canceled?']), listeningScript: lesson6ApplyScript, tips: bullets(['Only the tutor can see the transcript. Use a slow, natural pace, around 90-100 words per minute. Pause at each line break and between speakers. Do not add extra story details.']) },
        { instruction: 'Ask the main-idea question, read the messages again, then ask the detail questions.', questions: [
          { question: 'Is the exhibition canceled?', answer: 'No.' },
          { question: 'Why can they not use the cafe?', answer: 'A pipe broke. The floor is wet.' },
          { question: 'Where is the exhibition now?', answer: 'At the Gojo Art Room.' },
          { question: 'When is it?', answer: 'On Sunday, from three to five.' },
        ], tips: bullets(['After the first listen, ask only the first question. Read both messages again for the other three questions. Ask one at a time. Accept short answers. If needed, repeat one short part and allow another try without showing the transcript.']) },
      ],
      triviaEnabled: true, triviaDuration: '1 minute', triviaImage: previous?.applyData?.triviaImage || '',
      triviaText: 'In aviation, saying "OK" is not always enough. Pilots repeat important numbers from air traffic instructions, such as an altitude. This is called a readback. It gives the controller a chance to catch a number that was heard incorrectly. Repeating the place and time of a changed plan can help your friends check your understanding in a similar way.',
      triviaTranslation: '航空の通信では、「分かりました」と言うだけでは十分でない場合があります。パイロットは、管制官の指示にある高度などの重要な数字を復唱します。これは「リードバック」と呼ばれ、聞き間違えた数字に管制官が気付く機会になります。友達との予定が変わったときも、場所や時刻を繰り返せば、同じように理解が合っているか確認してもらえます。',
      triviaTutorSteps: [
        { instruction: 'Introduce the trivia.', scripts: bullets(["Let's look at the trivia."]) },
        { instruction: 'Ask the student to read the trivia.', scripts: bullets(['Please read the trivia.']) },
        { instruction: 'Check understanding and ask the question below.', questions: [{ question: 'Your friend changes a meeting to Friday at six at the station. What would you say to check?', answer: 'For example: Just to confirm, Friday at six at the station. Is that right?' }] },
        { instruction: 'Transition to Exercise.', scripts: bullets(['Great. Let\'s continue.']) },
      ],
    },
    exerciseData: {
      ...base.exerciseData, duration: '4 minutes',
      instructions: 'Choose the correct word. Then read the complete sentence.', instructionsTranslation: '正しい語を選び、文全体を読みましょう。',
      chooseItems: stepA.map(([sentence]) => ({ sentence })), answers: bullets(stepA.map(([, answer]) => answer)),
      tutorSteps: [{ instruction: 'Have the student choose each phrase, then read the whole sentence.', scripts: bullets(['Choose the correct word. Then read the complete sentence.']), answerKey: bullets(stepA.map(([, answer], index) => `${index + 1}. ${answer}`)), tips: bullets(['Mark each item using the lesson assessment controls. Note the actual incorrect response rather than inferring a weakness.']) }],
      stepBInstruction: 'Listen to four short updates. Choose the confirmed detail in each message.', stepBInstructionTranslation: '四つの短い変更連絡を聞き、それぞれのメッセージで確定した情報を選びましょう。',
      multipleChoiceItems: choices.map(([boldSentence, optionA, optionB]) => ({ boldSentence, optionA, optionB })),
      stepBTutorSteps: [
        { instruction: 'Read each short message and have the student choose an answer.', scripts: bullets(messages.map((text, index) => `${index + 1}. ${text}`)), tips: bullets(['These messages are for the tutor only. Pause after each one and repeat if needed. Mark each item and record the incorrect choice in the lesson assessment controls.']) },
        { instruction: 'Check the answers and ask for the clue behind one answer.', answerKey: bullets(choices.map((choice, index) => `${index + 1}. ${choice[3]} - ${choice[choice[3] === 'A' ? 1 : 2]}`)), tips: bullets(['Ask which words helped the student choose. Keep correction brief.']) },
      ],
    },
    missionData: {
      ...base.missionData, missionType: 'listening', duration: '6 minutes', image: previous?.missionData?.image || '',
      situation: 'Nao sends Emma a short message. Leo has not heard it. You are Emma. Your tutor is Leo.',
      situationTranslation: 'ナオからエマに短いメッセージが届きます。レオはまだ聞いていません。あなたはエマ、講師はレオです。',
      instruction: 'Listen to Nao. Tell Leo the new place and time. Then tell him who to call and when.',
      instructionTranslation: 'ナオのメッセージを聞きましょう。レオに新しい場所と時間を伝え、誰にいつ電話すればよいか教えましょう。',
      showGrammarTip: true, grammarTipTitle: 'Useful language', grammarTipItems: [...lesson6UsefulLanguage], questions: [],
      tutorSteps: [
        { instruction: 'Read the situation and instructions, then check understanding.', scripts: bullets(['Please read the situation and instructions. Is it clear?', 'Now I will read Nao\'s message. Please listen carefully. You can take notes.']) },
        { instruction: 'Read the complete message once for the main idea, then again for details.', listeningScript: lesson6MissionScript, tips: bullets(['Only the tutor can see the transcript. Read slowly and naturally, pausing at each line break. On the first listen, focus on the new place and time. On the second, focus on who Leo should call and when. Allow notes and repeat a short part if needed.']) },
        { instruction: 'Start the roleplay. The tutor speaks first; use follow-ups only when the student needs support.', scripts: bullets([
          "I'll be Leo. Please be Emma. You may use the useful language. I'll start.",
          '1. Hi Emma. What is the new plan for the exhibition?',
          '2. Just to confirm, it starts at two. Is that right?',
          '3. Who does Nao want me to call?',
          '4. When should I call her?',
          '5. Okay. I will call Nao\'s teacher this morning. The exhibition is Sunday, three to five, at the Gojo Art Room. Is that right?',
        ]), tips: bullets(['Let the student finish. Ask one short question at a time and accept short answers. The wrong time in line 2 is intentional: let the student correct it. Skip later questions if already answered.', 'Core details: Gojo Art Room; Sunday, three to five; call Nao\'s teacher this morning. The phone number and poster check are background, not additional scored items.', 'Score listening comprehension, not minor grammar mistakes in the retelling. Repeat a short part when needed and note the support given. Record actual missed details, not assumed weaknesses.']) },
        { instruction: 'Give specific feedback and retry one part that needs support.', scripts: bullets(['As your conversation ends, a new message arrives from Nao: "Emma, the old poster is online. Didn\'t you listen to my message?" We will find out what happened in the next lesson.', "Great job! Let's go to the next part!"]), tips: bullets(['Give one specific success and one focused correction before reading the closing story line. The cliffhanger is not an assessment item. Do not claim Emma ignored Nao; the cause has not been established.', 'Do Challenge 2 only if there is time left before Feedback.']) },
      ],
    },
    missionData2: {
      ...base.missionData2,
      instruction: 'Choose one topic. Discuss it with your tutor using your own or an imagined example.', instructionTranslation: 'トピックを一つ選び、自分の経験か想像した例を使って講師と話しましょう。',
      topics: [
        { title: 'LAST-MINUTE CHANGES', questions: ['When did a plan change at the last minute for you?', 'What did you do instead?', 'What helped you stay calm?'] },
        { title: 'GETTING THE MESSAGE', questions: ['Do you prefer a call, voice message, or text for an urgent update?', 'What information would you check first?', 'What would you do if someone did not reply?'] },
        { title: 'AN IMPORTANT DAY', questions: ['What event would you really not want to miss?', 'How would you feel if its location suddenly changed?', 'Who could help you sort out a new plan?'] },
      ],
      tutorSteps: [
        { instruction: 'If time remains, ask the student to choose one of the three general topics. The tutor speaks first.', scripts: bullets(['Please choose a category to discuss.']), tips: bullets(['Skip the optional discussion if more time is needed for Challenge 1 or Feedback.']) },
        { instruction: 'Use the questions as guides, not a checklist. Ask a natural follow-up after the student finishes.', tips: bullets(['Keep this a general discussion, not a quiz about the story characters.']) },
      ],
    },
    feedbackData: {
      ...base.feedbackData, goal: objective, goalJp: objectiveJa,
      rememberNote: 'Give feedback on actual Challenge 1 performance. Separate missed listening details from language errors in the retelling. Name one success and one useful next listening strategy.',
      tutorSteps: structuredClone(reference?.feedbackData?.tutorSteps || base.feedbackData.tutorSteps),
    },
    storyData: {
      enabled: previous?.storyData?.enabled ?? true, storyTitle: 'Life at Kamo House',
      setting: 'A fictional shared house above a cafe in Kyoto, on the Saturday before Nao\'s Sunday exhibition. All characters are adults.',
      characters: [
        { id: 'emma', name: 'Emma', role: 'main', description: 'A new resident and graphic designer who has made the exhibition poster.' },
        { id: 'claire', name: 'Claire', role: 'supporting', description: 'A Kamo House resident who helps run the cafe and finds the replacement venue.' },
        { id: 'nao', name: 'Nao', role: 'supporting', description: 'A ceramics student whose first exhibition will be visited by her former pottery teacher.' },
        { id: 'leo', name: 'Leo', role: 'supporting', description: 'A housemate and bakery worker who helps at the cafe and has the teacher\'s phone number.' },
      ],
      previousSummary: 'After the rental choices in Lesson 3 and the interrupted bike outing in Lesson 4, the housemates help Nao prepare her first pottery exhibition. Lesson 5 reviews earlier skills without requiring a fixed generated storyline.',
      currentPlotPoints: ['A pipe bursts in the cafe on Saturday morning, threatening Sunday\'s exhibition.', 'Nao fears cancellation and worries about her former teacher\'s visit.', 'Claire confirms the Gojo Art Room for Sunday, 3-5 p.m., replacing the cafe and the 2 p.m. start.', 'Emma passes the update to Leo so he can call the teacher this morning.', 'The old poster appears online. Nao asks whether Emma listened; the reason is not yet known.'],
      currentEpisodeSummary: 'The friends save the exhibition, but an outdated poster threatens Nao\'s trust in Emma.',
      nextEpisodeHook: 'Lesson 7: read the message timestamps and scheduled-post record before deciding why the wrong poster went online.',
      storyNotes: `No images generated. Preserve existing image fields. Dates: Saturday messages, Sunday exhibition. Apply and Challenge 1 are hidden tutor-read listening scripts, not student reading passages. Do not reveal the scheduled-post explanation until Lesson 7. Trivia source: ${triviaSource}`,
    },
  };
}

// Live simplification updates only the listening tasks, preserving editor changes elsewhere.
export function lesson6ListeningChanges(previous: any) {
  const authored = buildLesson6(previous, 'https://api.fluentxverse.com');
  const pick = (source: any, fields: string[]) => Object.fromEntries(fields.map(field => [field, source[field]]));
  return {
    applyData: { ...previous.applyData, ...pick(authored.applyData, ['situationText', 'situationTranslation', 'tutorSteps']) },
    missionData: { ...previous.missionData, ...pick(authored.missionData, ['situation', 'situationTranslation', 'instruction', 'instructionTranslation', 'tutorSteps']) },
  };
}
