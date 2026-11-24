export const lesson3Trivia = {
  text: 'At De Hoge Veluwe National Park in the Netherlands, visitors can use shared White Bikes at no extra charge after paying for park entry. These bikes cannot be reserved or locked. Once you leave one in a park bike rack, another visitor may use it. If you want a guaranteed bike for your visit, you can pay to rent a Blue Bike instead.',
  translation: 'オランダのデ・ホーヘ・フェルウェ国立公園では、入園料を払うと、共用の「ホワイトバイク」を追加料金なしで利用できます。この自転車は予約できず、鍵をかけることもできません。園内の駐輪ラックに戻すと、ほかの来園者が利用できるようになります。滞在中に確実に自転車を使いたい場合は、代わりに有料の「ブルーバイク」を借りることができます。',
  question: 'Which would you choose: a free shared bike or a paid bike guaranteed for your visit? Why?',
  source: 'https://hogeveluwe.nl/en/plan-your-trip/experience-the-park/cycling',
};

export function updateLesson3Trivia<T extends Record<string, any>>(current: T) {
  const questionSteps = current.triviaTutorSteps?.filter((step: any) => step.questions?.length);
  if (!current.triviaEnabled || questionSteps?.length !== 1 || questionSteps[0].questions.length !== 1) {
    throw new Error('Expected enabled trivia with one discussion question. Review current content first.');
  }
  return {
    ...current,
    triviaText: lesson3Trivia.text,
    triviaTranslation: lesson3Trivia.translation,
    triviaTutorSteps: current.triviaTutorSteps.map((step: any) => !step.questions?.length ? step : {
      ...step,
      questions: step.questions.map((question: any) => ({ ...question, question: lesson3Trivia.question, answer: "(student's own answer)" })),
    }),
  };
}
