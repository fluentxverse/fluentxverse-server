export const lesson1Id = 'conversational-skills-L3-C1-1-speaking-1774155960030';

export const lesson1Trivia = {
  text: "After a first conversation, people may like you more than you think. In a 2018 study, participants often thought their conversation partners liked them less than the partners actually did. Researchers call this the 'liking gap.' They found it even among students getting to know their new dorm mates. So a first chat with a new housemate may go better than you expect!",
  translation: '初めて会話をした後、相手はあなたが思う以上にあなたに好感を持っているかもしれません。2018年の研究では、参加者は、会話の相手が自分に抱く好感を実際よりも低く見積もる傾向がありました。研究者はこれを「ライキング・ギャップ」と呼んでいます。この傾向は、寮で新しく一緒に暮らす仲間と知り合う学生の間でも見られました。新しいハウスメイトとの最初の会話も、思ったよりうまくいっているかもしれませんね！',
  question: 'What helps you feel more relaxed when you introduce yourself to someone new?',
  source: 'https://pubmed.ncbi.nlm.nih.gov/30183512/',
};

export function updateLesson1Trivia(current: Record<string, any>) {
  if (!current.triviaEnabled || !Array.isArray(current.triviaTutorSteps)) {
    throw new Error('Expected the existing enabled trivia and tutor guide.');
  }
  const questionSteps = current.triviaTutorSteps.filter(step => step.questions?.length);
  if (questionSteps.length !== 1 || questionSteps[0].questions.length !== 1) {
    throw new Error('Expected one trivia discussion question; review changed tutor guide first.');
  }
  return {
    ...current,
    triviaText: lesson1Trivia.text,
    triviaTranslation: lesson1Trivia.translation,
    triviaTutorSteps: current.triviaTutorSteps.map(step => !step.questions?.length ? step : {
      ...step,
      questions: step.questions.map((question: Record<string, any>) => ({
        ...question,
        question: lesson1Trivia.question,
        answer: "(student's own answer)",
      })),
    }),
  };
}
