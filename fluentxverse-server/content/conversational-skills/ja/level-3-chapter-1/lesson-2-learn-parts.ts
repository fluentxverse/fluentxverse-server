export function buildLesson2LearnParts(images: { background: string; routine: string; plans: string }) {
  return {
    discussionPart: {
      instruction: 'II. Choose two topics. Use the phrases above to tell your tutor about yourself.',
      instructionTranslation: '話題を二つ選び、上の表現を使って自分のことを講師に話しましょう。',
      images: [
        { image: images.background, label: 'Your background', translation: 'あなたの生い立ち' },
        { image: images.routine, label: 'Your routine', translation: 'あなたの日課や習慣' },
        { image: images.plans, label: 'Something you look forward to', translation: '楽しみにしていること' },
      ],
      tutorSteps: [
        { instruction: 'Introduce Part II.', script: "Okay, now let's do Part II." },
        { instruction: 'Read the instructions and check understanding.', script: 'Please choose two topics. Is it clear?' },
        { instruction: 'Ask one question for each chosen topic.', script: 'Where did you grow up? What do you do on weekends? What are you looking forward to?', tip: 'Use only the questions for the chosen topics. Accept one or two sentences per topic and invented details if preferred. Encourage grew up in, on weekends, or looking forward to.' },
        { instruction: 'Respond naturally and ask one short follow-up if time allows.', tip: 'For example: What did you like about living there? What do you enjoy about that activity? Keep this part to about one minute.' },
        { instruction: 'Transition to Part III.', script: "Good job! Let's go to the next part!" },
      ],
    },
    pronunciationPart: {
      instruction: 'Listen and repeat. Then practise the word pairs.',
      instructionTranslation: '聞いて繰り返しましょう。その後、単語のペアを発音する練習をしましょう。',
      leftColumn: {
        soundSymbol: '/l/', images: [],
        words: [
          { word: 'light', translation: '光', isHighlighted: true },
          { word: 'long', translation: '長い' },
          { word: 'glass', translation: 'グラス' },
        ],
      },
      rightColumn: {
        soundSymbol: '/r/', images: [],
        words: [
          { word: 'right', translation: '右', isHighlighted: true },
          { word: 'wrong', translation: '間違っている' },
          { word: 'grass', translation: '草' },
        ],
      },
      tutorSteps: [
        { instruction: 'Introduce Part III and read the instructions.', script: "Now let's practise /l/ and /r/. Listening for the difference can help you understand a voice message." },
        { instruction: 'Model /l/, then read the left-column words one at a time and have the student repeat.', tip: 'For /l/, the tongue tip touches the ridge just behind the upper front teeth.' },
        { instruction: 'Model /r/, then read the right-column words one at a time and have the student repeat.', tip: 'For /r/, the tongue tip does not touch that ridge. Model your natural English accent; do not require one exact tongue shape.' },
        { instruction: 'Read each left-right pair and have the student repeat.', script: 'Light, right. Long, wrong. Glass, grass.' },
        { instruction: 'Check listening without showing which word you chose.', script: "I'll say one word from each pair. Tell me which word you hear.", tip: 'For example, say right, long, grass, one at a time. Accept pointing or naming the word. Repeat a missed pair once, then finish with looking forward to and grew up in from Part I. Keep this part to about one minute.' },
        { instruction: 'Transition to Step B.', script: "Great! Let's go to Step B Grammar Tip!" },
      ],
    },
  };
}
