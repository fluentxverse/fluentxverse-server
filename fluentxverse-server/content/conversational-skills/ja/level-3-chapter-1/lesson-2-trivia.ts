export const lesson2Trivia = {
  text: "Do you need to see someone's face to feel connected? In one experiment, strangers talked by text, voice, or video. People felt more connected when they could hear each other's voices than when they typed. Surprisingly, adding video did not make them feel more connected than voice alone. A conversation can feel personal even when you cannot see the other person's face.",
  translation: '相手とのつながりを感じるには、顔を見る必要があるのでしょうか。ある実験では、初対面の人たちが文字、音声、またはビデオで会話しました。参加者は、文字を打ってやり取りするよりも、お互いの声が聞こえるときのほうが、相手とのつながりを強く感じました。意外なことに、映像を加えても、音声だけの場合よりつながりを強く感じるわけではありませんでした。相手の顔が見えなくても、会話を通じて親しみを感じることができるのです。',
  question: 'When getting to know a new housemate, would you rather talk by phone or exchange texts? Why?',
  source: 'https://pubmed.ncbi.nlm.nih.gov/32915017/',
};

export function updateLesson2Trivia<T extends Record<string, any>>(current: T) {
  const questionSteps = current.triviaTutorSteps?.filter((step: any) => step.questions?.length);
  if (!current.triviaEnabled || questionSteps?.length !== 1 || questionSteps[0].questions.length !== 1) {
    throw new Error('Expected enabled trivia with one discussion question. Review current content first.');
  }
  if (!current.situationImage?.startsWith('https://')) throw new Error('Expected the existing public phone-message image.');
  return {
    ...current,
    triviaText: lesson2Trivia.text,
    triviaTranslation: lesson2Trivia.translation,
    triviaImage: current.situationImage,
    triviaTutorSteps: current.triviaTutorSteps.map((step: any) => !step.questions?.length ? step : {
      ...step,
      questions: step.questions.map((question: any) => ({ ...question, question: lesson2Trivia.question, answer: "(student's own answer)" })),
    }),
  };
}
