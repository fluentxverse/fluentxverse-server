const assetDirectory = '/lessons/conversational-skills/ja/l3-c1/v1';
export const lesson2ImageNames = [
  'lesson2-grew-up',
  'lesson2-moved-for-work',
  'lesson2-work-part-time',
  'lesson2-on-weekends',
  'lesson2-looking-forward',
  'lesson2-getting-to-know',
  'lesson2-machiya-cafe',
  'lesson2-apply-message',
  'lesson2-challenge-message',
];
const goal = 'I can understand a housemate\'s background, reason for moving, and current routine in a voice message.';
const goalJa = 'ハウスメイトの音声メッセージを聞き、出身地、引っ越した理由、今の日課を理解できる。';
const bullets = (texts: string[]) => texts.map(text => ({ text }));

const applyScript = `<p>Hi Emma, it's Leo from Kamo House. Claire said you moved in this week, so I wanted to say hello. I grew up in Bristol, but I moved to Kyoto last spring because I got a job at a small bakery. I used to work in a hotel kitchen. Now I make bread early in the morning, and I help Claire at the cafe downstairs on Sundays. I heard you enjoy photography. Maybe you can show me some of your pictures when we meet.</p>`;

const challengeScript = `<p>Hi everyone, I'm Nao. I grew up in Fukuoka, and I moved to Kyoto three months ago to study ceramics. I used to work full-time in a bookshop. Now I study during the week and work part-time at a small gallery on Saturdays. I'm still getting to know the city. This Sunday, I'd like to walk around the old streets and take photos. Claire told me Emma likes photography too. If you're free, would you like to come with me? I'm looking forward to meeting you all.</p>`;

export function buildLesson2(previous: any, apiBase: string) {
  const image = (name: string) => `${apiBase.replace(/\/$/, '')}/lesson/files${assetDirectory}/${name}.webp`;
  return {
    lessonName: 'A Housemate\'s Voice Message',
    goalTextEn: goal,
    goalTextJp: goalJa,
    backgroundImage: image('lesson2-apply-message'),
    introductionData: {
      introTexts: [
        { language: 'en', text: 'Emma has just moved into Kamo House in Kyoto. Another resident sends her a voice message before they meet. Listen for what was true before, why things changed, and what is true now.' },
        { language: 'ja', text: 'エマは京都のシェアハウス「Kamo House」に引っ越したばかりです。会う前に別の住人から音声メッセージが届きます。以前のこと、変化の理由、今のことを聞き取りましょう。' },
      ],
      introImage: image('lesson2-apply-message'),
      lessonIssue: null,
      lessonGoalDuration: '1 minute',
      lessonGoalSteps: [
        { instruction: 'Introduce the objective first and check understanding.', script: `Our objective for today is: ${goal} Is it clear?` },
        { instruction: 'Introduce the situation, then ask the learner a warm-up question.', script: 'Here is our situation. Emma has just moved into Kamo House. Another resident has sent her a voice message.', question: 'What would you like to know about a new housemate?' },
      ],
    },
    learnData: {
      sectionTitle: 'LEARN',
      steps: [{
        stepType: 'vocabulary',
        stepName: 'STEP A: VOCABULARY',
        duration: '4 minutes',
        partLabel: 'Listen and repeat. Notice how each phrase helps tell a person\'s story.',
        partTranslation: '聞いて繰り返しましょう。それぞれの表現がどのように人物の話を伝えるかに注目しましょう。',
        vocabularyItems: [
          { image: image('lesson2-grew-up'), englishText: 'I grew up in Bristol.', highlightedWord: 'grew up in', translation: '私はブリストルで育ちました。' },
          { image: image('lesson2-moved-for-work'), englishText: 'I moved here for work.', highlightedWord: 'moved here for work', translation: '仕事のためにここへ引っ越しました。' },
          { image: image('lesson2-work-part-time'), englishText: 'I work part-time at a gallery.', highlightedWord: 'work part-time', translation: 'ギャラリーでアルバイトをしています。' },
          { image: image('lesson2-on-weekends'), englishText: 'I take photos on weekends.', highlightedWord: 'on weekends', translation: '週末に写真を撮ります。' },
          { image: image('lesson2-looking-forward'), englishText: 'I\'m looking forward to meeting you.', highlightedWord: 'looking forward to', translation: 'あなたに会えるのを楽しみにしています。' },
          { image: image('lesson2-getting-to-know'), englishText: 'I\'m getting to know the neighborhood.', highlightedWord: 'getting to know', translation: '近所のことを少しずつ知っているところです。' },
        ],
        tutorSteps: [
          { instruction: 'Model each phrase. Ask the learner to repeat and connect the picture to its meaning.', script: 'Listen first, then say it with me.' },
          { instruction: 'Check before versus now with two examples.', script: 'Which phrase tells us about the past? Which phrase tells us about a regular activity now?', tip: 'Accept grew up in or moved here for the past; work part-time or on weekends for a current routine.' },
          { instruction: 'Ask for one personal or invented example.', script: 'Choose one phrase and make your own sentence.', tip: 'An invented person is fine. Do not require private information.' },
        ],
      }],
    },
    stepBData: {
      stepType: 'grammar-tip',
      grammarTip: {
        stepName: 'STEP B: GRAMMAR TIP',
        duration: '2 minutes',
        explanations: [
          {
            ruleText: 'Used to + verb tells us about a past situation that is no longer true. But now signals a change to the present.',
            ruleTranslation: 'used to + 動詞の原形は、今は当てはまらない過去のことを表します。but now は現在への変化を示します。',
            examplesTitle: 'LISTEN FOR THE CHANGE',
            examples: [
              { sentence: 'I used to work in a hotel kitchen, but now I make bread.', translation: '以前はホテルの厨房で働いていましたが、今はパンを作っています。' },
              { sentence: 'I used to live in Fukuoka, but now I live in Kyoto.', translation: '以前は福岡に住んでいましたが、今は京都に住んでいます。' },
            ],
          },
          {
            ruleText: 'Because introduces the reason for a change.',
            ruleTranslation: 'because は変化の理由を示します。',
            examplesTitle: 'LISTEN FOR THE REASON',
            examples: [{ sentence: 'I moved to Kyoto because I got a new job.', translation: '新しい仕事が決まったので京都に引っ越しました。' }],
          },
        ],
        tutorSteps: [
          { instruction: 'Read the two listening clues. Ask the learner to read the examples.', script: 'Listen for used to, but now, and because. They help us organize a person\'s story.' },
          { instruction: 'Check the meaning of one contrast and one reason.', script: 'What did the person do before? What do they do now? Why did they move?', tip: 'Keep the focus on understanding spoken information, not memorizing a rule.' },
        ],
      },
    },
    applyData: {
      sectionNumber: 3,
      sectionTitle: 'APPLY',
      activityType: 'listening',
      activityTitle: 'LISTENING',
      activityDuration: '4 minutes',
      situationText: 'Emma receives a voice message from Leo, another resident of Kamo House. Listen once for the main idea, then again for Leo\'s past work, reason for moving, and current routine.',
      situationTranslation: 'エマは同じシェアハウスの住人レオから音声メッセージを受け取ります。まず大まかな内容を聞き、次に以前の仕事、引っ越した理由、今の日課を聞き取りましょう。',
      situationImage: image('lesson2-apply-message'),
      dialogueLines: [],
      tutorSteps: [
        { instruction: 'Set up the listening. Tell the learner you will speak as Leo, then read the monologue once naturally.', scripts: bullets(['Leo has sent Emma a message. I will be Leo. Listen for the main idea first. Is it clear?']), listeningScript: applyScript, tips: bullets(['Keep the transcript in the tutor guide. Do not show or read it together with the learner.']) },
        { instruction: 'Ask for the main idea, then read the same message once more for details.', questions: [{ question: 'Why does Leo send Emma a message?', answer: 'To welcome her and introduce himself before they meet.' }] },
        { instruction: 'Check the key details and one natural follow-up.', questions: [
          { question: 'Where did Leo grow up?', answer: 'Bristol.' },
          { question: 'Why did he move to Kyoto?', answer: 'He got a job at a small bakery.' },
          { question: 'What did he use to do, and what does he do now?', answer: 'He worked in a hotel kitchen; now he makes bread.' },
          { question: 'When does he help Claire?', answer: 'On Sundays.' },
          { question: 'What would you ask Leo about his life in Kyoto?', answer: 'Student\'s own answer.' },
        ], tips: bullets(['If a detail is missed, replay only the relevant sentence orally, then ask again.']) },
      ],
      triviaEnabled: true,
      triviaDuration: '1 minute',
      // Kyoto City Official Travel Guide describes machiya used as both homes and shops, including renovated cafes.
      // https://kyoto.travel/en/see-and-do/manjicafe.html
      triviaText: 'In Kyoto, some traditional machiya townhouses were both homes and workplaces. Some have been renovated as cafes. Kamo House is fictional, but its cafe downstairs and rooms upstairs echo that local pattern.',
      triviaTranslation: '京都の伝統的な京町家には、住まいと仕事場を兼ねた建物があります。カフェに改装された町家もあります。Kamo Houseは架空の場所ですが、階下にカフェ、階上に住まいがある設定はその地域の特徴を思わせます。',
      triviaImage: image('lesson2-machiya-cafe'),
      triviaTutorSteps: [
        { instruction: 'Introduce the trivia.', scripts: bullets(['Let\'s look at the trivia.']) },
        { instruction: 'Ask the learner to read the trivia aloud or silently.', scripts: bullets(['Please read the trivia.']) },
        { instruction: 'Check understanding, then ask one question.', questions: [{ question: 'What part of Kamo House reminds you of a machiya?', answer: 'The cafe downstairs and the living rooms upstairs.' }] },
        { instruction: 'Transition to the next section.', scripts: bullets(['Great. Let\'s continue.']) },
      ],
    },
    exerciseData: {
      ...previous.exerciseData,
      sectionNumber: 4,
      sectionTitle: 'EXERCISE',
      duration: '4 minutes',
      stepAType: 'choose',
      stepAName: 'STEP A',
      instructions: 'Choose the correct phrase in parentheses. Then say whether it tells us about the past, the present, or a reason.',
      instructionsTranslation: 'カッコの中から正しい表現を選び、過去・現在・理由のどれを表すか言いましょう。',
      showExpressions: false,
      expressions: [],
      showExample: false,
      exampleSentence: '',
      exampleAnswer: '',
      showInfoBox: false,
      exerciseItems: [],
      chooseItems: [
        { sentence: 'I (used to live / live) in Bristol, but now I live in Kyoto.' },
        { sentence: 'Leo moved to Kyoto (because / but) he got a bakery job.' },
        { sentence: 'I used to work in a hotel kitchen, (because / but) now I make bread.' },
        { sentence: 'She (works / used to work) at a gallery on Saturdays now.' },
      ],
      changeItems: [],
      answers: bullets(['used to live - past', 'because - reason', 'but - change', 'works - present']),
      tutorSteps: [
        { instruction: 'Have the learner choose each phrase and name its time or function.', scripts: bullets(['First, choose the phrase. Then tell me: past, present, or reason?']), answerKey: bullets(['used to live - past', 'because - reason', 'but - change', 'works - present']) },
        { instruction: 'Ask the learner to read two complete sentences aloud.', tip: 'Do not spend the listening-practice time on extended grammar correction.' },
      ],
      hasStepB: true,
      stepBType: 'multiple-choice',
      stepBName: 'STEP B',
      stepBInstruction: 'Listen to three short messages. Choose the best answer. What word or phrase helped you?',
      stepBInstructionTranslation: '三つの短いメッセージを聞き、最も適切な答えを選びましょう。手がかりになった語句も答えましょう。',
      conversations: [],
      multipleChoiceItems: [
        { boldSentence: 'Why did the speaker move to Kyoto?', optionA: 'For a job', optionB: 'For university' },
        { boldSentence: 'When does the speaker work at the gallery?', optionA: 'On weekdays', optionB: 'On Saturdays' },
        { boldSentence: 'Where does the speaker live now?', optionA: 'Nagoya', optionB: 'Kyoto' },
      ],
      compareWordBox: [],
      compareImages: [],
      compareItems: [],
      stepBTutorSteps: [
        { instruction: 'Read each short message once. Pause for the learner to choose an answer.', scripts: bullets([
          '1. I used to live in Osaka, but I moved to Kyoto because I got a job at a bakery.',
          '2. I study ceramics from Monday to Friday. On Saturdays, I work at a gallery.',
          '3. I grew up in Nagoya, but now I live in Kyoto.',
        ]), tips: bullets(['The messages are for the tutor only. Do not let the learner read them before answering.']) },
        { instruction: 'Check the answer and ask which words supported it.', answerKey: bullets(['A - because I got a job', 'B - on Saturdays', 'B - but now I live in Kyoto']) },
      ],
    },
    missionData: {
      sectionNumber: 5,
      sectionTitle: 'MISSION',
      missionType: 'listening',
      challengeNumber: 1,
      challengeName: 'Challenge 1',
      duration: '6 minutes',
      situation: 'A new resident, Nao, has sent a voice message to Kamo House. Emma listens to it. Claire is busy downstairs and asks Emma what Nao said.',
      situationTranslation: '新しい住人ナオからKamo Houseに音声メッセージが届きました。エマがそれを聞きます。階下で忙しいクレアに、ナオの話を伝えましょう。',
      instruction: 'Listen to Nao\'s message. Then tell Claire where Nao grew up, why she moved to Kyoto, what changed in her work, and what she hopes to do on Sunday.',
      instructionTranslation: 'ナオのメッセージを聞きましょう。その後、出身地、京都に引っ越した理由、仕事の変化、日曜日にしたいことをクレアに伝えましょう。',
      showGrammarTip: false,
      grammarTipTitle: '',
      grammarTipItems: [],
      image: image('lesson2-challenge-message'),
      questions: [
        { question: 'Where did Nao grow up?', hints: [] },
        { question: 'Why did she move to Kyoto?', hints: [] },
        { question: 'What did she do before, and what does she do now?', hints: [] },
        { question: 'What would she like to do on Sunday?', hints: [] },
      ],
      listeningScript: challengeScript,
      tutorSteps: [
        { instruction: 'Set the situation. Tell the learner you will read Nao\'s message and that Claire will ask about it afterward.', scripts: bullets(['First, listen for why Nao moved to Kyoto. On the second listen, notice her work and Sunday plan. Is it clear?']) },
        { instruction: 'Read Nao\'s complete monologue once for gist, then a second time for details. Keep the script hidden from the learner.', listeningScript: challengeScript, tips: bullets(['Use one natural speaking voice. Pause between the past, present, and Sunday-plan ideas, but do not exaggerate the clue words.']) },
        { instruction: 'Start the roleplay as Claire. The tutor speaks first; use follow-ups only when the learner needs support.', scripts: bullets(['Hi Emma, I was busy downstairs. Did you hear Nao\'s message? What did she say?']), prompts: bullets(['Where did she grow up, and why did she move here?', 'What did she used to do? What does she do now?', 'Does she work on Sundays?', 'You both like photography. What could you say to her?']), tips: bullets(['Accept a natural summary rather than demanding every word. Nao grew up in Fukuoka, moved to study ceramics, used to work full-time in a bookshop, now studies and works part-time at a gallery on Saturdays, and wants to take photos on Sunday.']) },
        { instruction: 'Give specific feedback, then ask the learner to retry one missed detail.', tips: bullets(['Score listening comprehension from the information the learner recovered, not from minor grammar errors in the retelling.']) },
      ],
    },
    missionData2: {
      sectionNumber: 5,
      sectionTitle: 'MISSION',
      missionType: 'discussion',
      challengeNumber: 2,
      challengeName: 'Challenge 2',
      duration: '2 minutes',
      isOptional: true,
      situation: 'People have different reasons for moving and different ways of settling into a new place.',
      situationTranslation: '人が引っ越す理由や、新しい場所での生活に慣れる方法はさまざまです。',
      instruction: 'Choose one category. Discuss the questions with your tutor. You can use your own experience or imagine a situation.',
      instructionTranslation: 'カテゴリーを一つ選び、講師と質問について話しましょう。自分の経験でも、想像した状況でもかまいません。',
      showGrammarTip: false,
      grammarTipTitle: '',
      grammarTipItems: [],
      questions: [],
      topics: [
        { title: 'MOVING TO A NEW PLACE', questions: [
          'What might make you decide to move to a new city?',
          'What would you want to learn about a neighborhood before moving there?',
          'What helps people feel at home after a move?',
        ] },
        { title: 'WORK AND ROUTINES', questions: [
          'How might a new job or course change someone\'s daily routine?',
          'What is one part of your routine that has changed over time?',
          'Would you rather study or work in a new city? Why?',
        ] },
        { title: 'MEETING NEW PEOPLE', questions: [
          'What do you usually want to know when you meet someone new?',
          'What question could you ask to find a shared interest?',
          'What activity would make it easier to get to know new neighbors?',
        ] },
      ],
      tutorSteps: [
        { instruction: 'If time remains, ask the learner to choose one of the three categories. The tutor speaks first and asks the first question.', scripts: bullets(['Which topic would you like to discuss: moving, work and study, or meeting new people?']), tips: bullets(['Skip this optional discussion if the learner needs more time for Challenge 1 or feedback.']) },
        { instruction: 'Use the questions as a guide. Ask a natural follow-up based on the learner\'s answer, and share a brief response of your own when appropriate.', tips: bullets(['Accept real or imagined answers. Keep this as a free talk, not a test on the story.']) },
      ],
    },
    feedbackData: {
      ...previous.feedbackData,
      goal,
      goalJp: goalJa,
      rubricTitle: 'LESSON OBJECTIVE ACHIEVEMENT',
      rubricLevels: [
        { score: 4, label: 'Very Good', description: 'Could complete the task with ease' },
        { score: 3, label: 'Good', description: 'Could complete the task with some clarifications' },
        { score: 2, label: 'Fair', description: 'Could complete the task with additional instructions' },
        { score: 1, label: 'Poor', description: 'Could somehow complete the task with difficulty' },
      ],
      personalizedFeedbackTitle: 'PERSONALIZED FEEDBACK',
      feedbackGuideTitle: 'PERSONALIZED FEEDBACK GUIDE',
      rememberNote: 'Give evidence-based feedback about the details heard in Challenge 1. Name one success and one useful next listening strategy.',
      tutorSteps: [
        { instruction: 'Introduce Feedback.', scripts: bullets(["Okay, now let's do Feedback."]) },
        { instruction: 'Have the student read the lesson objective.' },
        { instruction: 'Ask if they achieved the lesson objective.', scripts: bullets(['Did you achieve the lesson objective?']) },
        { instruction: 'Give the student a score for their objective achievement using the rubric.', tips: bullets(['Base your score mainly on Challenge 1.']) },
        { instruction: 'Give feedback on the student\'s range, accuracy, and fluency using the guide below.', tips: bullets(['Mention one correctly understood detail and one useful listening strategy based on the student\'s actual performance.']) },
        { instruction: 'Wrap up the lesson.', scripts: bullets(['You did a great job today. Thank you very much!']) },
      ],
      categories: [
        {
          id: 'range', title: 'RANGE', titleJp: '表現の幅\nさまざまな語彙や表現を使えるか',
          focusOn: 'the ability to add a reason and time detail to a self-introduction and ask relevant follow-up questions',
          exampleFeedbackItems: ['reasons for moving', 'for and since time details', 'natural follow-up questions'],
          vocabularyExample: 'by the way - used to add extra information naturally',
          examples: [
            { youSaid: 'My name Mina.', correction: 'My name is Mina.', correctionLabel: 'Better:' },
            { youSaid: 'I live Cebu.', correction: 'I live in Cebu.', correctionLabel: 'Better:' },
          ],
        },
        {
          id: 'accuracy', title: 'ACCURACY', titleJp: '正確さ\n文法や表現を正しく使えるか',
          focusOn: 'the ability to distinguish a finished move from an activity continuing now',
          exampleFeedbackItems: ['simple past with a finished time', 'have been + -ing', 'for a duration and since a starting point'],
          examples: [
            { youSaid: 'I have moved here last month.', correction: 'I moved here last month.', correctionLabel: 'Correct:' },
            { youSaid: 'I have been living here since three weeks.', correction: "I've been living here for three weeks.", correctionLabel: 'Correct:' },
          ],
        },
        {
          id: 'fluency', title: 'FLUENCY', titleJp: '流暢さ\n自然に話し続けられるか',
          focusOn: 'the ability to connect an answer to a relevant question and keep the conversation moving',
          exampleFeedbackItems: ['adding one meaningful detail', 'asking a question back', "responding to the other person's answer"],
          examples: [
            { youSaid: 'I am Ken. From Tokyo.', correction: "I'm Ken. I'm from Tokyo.", correctionLabel: 'Better:' },
            { youSaid: 'I work hotel.', correction: 'I work at a hotel.', correctionLabel: 'Better:' },
          ],
        },
      ],
    },
  };
}
