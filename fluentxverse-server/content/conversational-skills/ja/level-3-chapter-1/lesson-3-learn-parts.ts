export function buildLesson3LearnParts(images: { cityBike: string; electricBike: string; extras: string }) {
  return {
    discussionPart: {
      instruction: 'II. Which bike would you rent for a day out? Give a reason and say which rental conditions you would check.',
      instructionTranslation: '一日出かけるなら、どちらの自転車を借りたいですか。理由を挙げ、借りる前に確認したい利用条件も伝えましょう。',
      images: [
        { image: images.cityBike, label: 'City bike', translation: 'シティサイクル' },
        { image: images.electricBike, label: 'Electric-assist bike', translation: '電動アシスト自転車' },
        { image: images.extras, label: 'Rental extras', translation: '追加オプション' },
      ],
      tutorSteps: [
        { instruction: 'Introduce Part II.', script: "Okay, now let's do Part II." },
        { instruction: 'Read the instructions and check understanding.', script: 'Which bike would you rent for a day out? Give a reason and say what you would check before renting. Is it clear?' },
        { instruction: 'Have the student choose a bike and explain their choice.', tip: 'Accept personal or invented preferences. Ask one natural follow-up, such as: Would your choice change for a longer ride?' },
        { instruction: 'Ask which conditions the student would check.', script: 'What would you check besides the bike type?', tip: 'Encourage the vocabulary from Part I: included, additional fee, per hour, or return by. Accept a short answer; no calculation or service-list answers are required here. Keep Part II to about one minute.' },
        { instruction: 'Transition to Part III.', script: "Good! Let's go to the next part!" },
      ],
    },
    pronunciationPart: {
      instruction: 'Listen and repeat the words.',
      instructionTranslation: '単語を聞いて、繰り返し発音しましょう。',
      leftColumn: {
        soundSymbol: '/b/', images: [],
        words: [
          { word: 'big', translation: '大きい', isHighlighted: true },
          { word: 'back', translation: '後ろ' },
          { word: 'buy', translation: '買う' },
        ],
      },
      rightColumn: {
        soundSymbol: '/p/', images: [],
        words: [
          { word: 'pig', translation: '豚', isHighlighted: true },
          { word: 'pack', translation: '荷物を詰める' },
          { word: 'pie', translation: 'パイ' },
        ],
      },
      tutorSteps: [
        { instruction: 'Introduce Part III and read the instructions.', script: "Now let's practise /b/ and /p/. Listen and repeat." },
        { instruction: 'Model /b/, then read each word on the left and have the student repeat.', tip: 'Close your lips, then open them using your voice: big, back, buy.' },
        { instruction: 'Model /p/, then read each word on the right and have the student repeat.', tip: 'Close your lips, then release a small puff of air without using your voice: pig, pack, pie.' },
        { instruction: 'Read each pair and have the student repeat.', script: 'Big, pig. Back, pack. Buy, pie.', tip: 'Repeat a difficult pair once if needed. Keep this part to about one minute.' },
        { instruction: 'Transition to Step B.', script: "Great! Let's go to Step B Reading Tip!" },
      ],
    },
  };
}
