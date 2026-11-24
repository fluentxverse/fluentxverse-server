const bullets = (texts: string[]) => texts.map(text => ({ text }));

export function buildLesson3Roleplay() {
  return {
    situation: "You are Emma. You and Claire are planning a two-hour bike ride in Kyoto. Claire asks you to check the rental shop's service list before you choose your bikes.",
    situationTranslation: 'あなたはエマ役です。クレアと京都で2時間のサイクリングをする予定です。自転車を選ぶ前に、クレアに頼まれてレンタル店のサービス一覧を確認します。',
    instruction: 'Read the service list. Then tell Claire about the prices, what is included, and the return rules. Help her choose a bike for a two-hour ride.',
    instructionTranslation: 'サービス一覧を読みましょう。その後、料金、料金に含まれるもの、返却のルールをクレアに伝え、2時間のサイクリングに使う自転車を選ぶ手伝いをしましょう。',
    tutorSteps: [
      {
        instruction: 'Read the situation and instructions, then check understanding.',
        scripts: bullets(['Please read the situation and instructions. Is it clear?']),
      },
      {
        instruction: 'Ask the student to read the complete service list before the roleplay.',
        scripts: bullets(['Please read the service list aloud. Check the prices, what is included, and the return rules.']),
        tips: bullets([
          'Correct at most two or three important pronunciation errors after the reading.',
          'Tutor reference: two-hour city bike, ¥900; two-hour electric-assist bike with a basket, ¥1,800.',
          'Helmet: included. Late return: ¥400 per hour. Full-day return deadline: 5 p.m.',
        ]),
      },
      {
        instruction: 'Start the roleplay. The tutor speaks first; use follow-ups only when the student needs support.',
        scripts: bullets([
          "I'll be Claire. Please be Emma. Use the service list to help me choose a bike. I'll start.",
          '1. Hi Emma, have you checked the rental list? What bikes can we rent for two hours?',
          "2. I'd like a basket. How much is the electric-assist bike with one?",
          '3. Do I need to pay extra for a helmet?',
          '4. What if we decide to rent for the whole day? When do we have to bring the bikes back?',
          "5. And what happens if we're late?",
          '6. Which option would you recommend for our two-hour ride? Why?',
        ]),
        tips: bullets(['Let the student finish before correcting. Follow the conversation naturally rather than reading every guide line as a checklist.']),
      },
      {
        instruction: 'Give specific feedback and retry one part that needs support.',
        scripts: bullets(["Great job! Let's go to the next part!"]),
        tips: bullets([
          'Score mainly on whether the student locates and explains prices, rental periods, and extra charges accurately.',
          'Do Challenge 2 only if there is time left before Feedback.',
        ]),
      },
    ],
  };
}
