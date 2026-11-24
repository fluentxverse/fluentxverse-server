import type { StoryLessonNumber } from '../ja/level-3-chapter-1/new-beginning';

export interface NaturalPronunciationLesson {
  tip: string;
  phrases: [phrase: string, guide: string, example: string][];
}

const linking = 'When a word ends with a consonant sound and the next begins with a vowel sound, connect them smoothly. The mark ‿ shows the link. Avoid adding a pause or an extra vowel between the words.';
const grouping = 'Group words that express a complete idea. The mark | shows a possible short pause between meaning groups. Keep the words inside each group flowing; do not pause after every word.';

// Directly authored phrase and sentence practice.
// Each row has a complete contextual example, rather than an isolated sound pair.
export const naturalPronunciationLessons: Record<1 | 2 | 3 | 5, Record<StoryLessonNumber, NaturalPronunciationLesson>> = {
  1: {
    1: { tip: linking, phrases: [
      ['catch up with old friends', '/ catch‿UP with‿old FRIENDS /', 'It is good to catch‿<strong>up</strong> with‿old <strong>friends</strong>.'],
      ['pass it on', '/ pass‿it‿ON /', 'If you learn a useful skill, pass‿it‿<strong>on</strong>.'],
    ] },
    2: { tip: linking, phrases: [
      ['learn from a mistake', '/ LEARN from‿a misTAKE /', 'With patient practice, we can <strong>learn</strong> from‿a mis<strong>take</strong>.'],
      ['take it slowly', '/ TAKE‿it SLOWly /', 'When you try the brush movement, <strong>take</strong>‿it <strong>slow</strong>ly.'],
    ] },
    3: { tip: 'Keep small words such as a and of light, and give the important words a clearer beat. Capitals show a possible focus; ‿ shows a smooth consonant-to-vowel link.', phrases: [
      ['a cup of tea', '/ a CUP‿of TEA /', 'The host offers a <strong>cup</strong>‿of <strong>tea</strong>.'],
      ['a moment of calm', '/ a MOment‿of CALM /', 'The visit gives us a <strong>mo</strong>ment‿of <strong>calm</strong>.'],
    ] },
    4: { tip: linking, phrases: [
      ['talk about a recipe', '/ TALK‿about‿a REcipe /', 'At dinner, we <strong>talk</strong>‿about‿a <strong>re</strong>cipe from the family.'],
      ['pass it down', '/ pass‿it DOWN /', 'Grandmother hopes someone will learn her method and pass‿it <strong>down</strong>.'],
    ] },
    6: { tip: grouping, phrases: [
      ['Before visitors begin, explain the activity.', '/ Before visitors beGIN | exPLAIN the acTIvity /', 'Before visitors be<strong>gin</strong> | ex<strong>plain</strong> the ac<strong>ti</strong>vity so they know what to expect.'],
      ['If the room is busy, wait for a quieter moment.', '/ If the room is BUSy | WAIT for a quieter MOment /', 'If the room is <strong>bus</strong>y | <strong>wait</strong> for a quieter <strong>mo</strong>ment before starting the explanation.'],
    ] },
    7: { tip: 'Stress the word that carries your main message. Keep the surrounding words lighter rather than giving every word an equal beat. Capitals suggest a focus; a different focus is possible when the meaning changes.', phrases: [
      ['a new idea', '/ a NEW idea /', 'We can try a <strong>new</strong> idea while keeping the craft’s meaning.'],
      ['the meaning behind it', '/ the MEANing behind it /', 'The film should explain the <strong>mean</strong>ing behind it, not only show the design.'],
    ] },
    8: { tip: linking, phrases: [
      ['set up a table', '/ set‿UP‿a TAble /', 'Could we set‿<strong>up</strong>‿a <strong>ta</strong>ble in the indoor space?'],
      ['ask about it', '/ ASK‿aBOUT‿it /', 'If a delivery detail is unclear, <strong>ask</strong>‿a<strong>bout</strong>‿it before making a promise.'],
    ] },
    9: { tip: grouping, phrases: [
      ['Looking back on the week, I learned a lot.', '/ Looking BACK on the WEEK | I LEARNED a LOT /', 'Looking <strong>back</strong> on the <strong>week</strong> | I <strong>learned</strong> a <strong>lot</strong> from our visitors.'],
      ['Before we plan another event, ask what needs checking.', '/ Before we plan another eVENT | ASK what needs CHECKing /', 'Before we plan another e<strong>vent</strong> | <strong>ask</strong> what needs <strong>check</strong>ing with the committee.'],
    ] },
  },
  2: {
    1: { tip: linking, phrases: [
      ['take on a role', '/ take‿ON‿a ROLE /', 'Aiko can take‿<strong>on</strong>‿a <strong>role</strong> researching craft history.'],
      ['focus on the people', '/ FOcus‿on the PEOple /', 'The documentary should <strong>fo</strong>cus‿on the <strong>peo</strong>ple keeping traditions alive.'],
    ] },
    2: { tip: linking, phrases: [
      ['spread them out evenly', '/ SPREAD them‿OUT‿Evenly /', 'Watch the fibres as you <strong>spread</strong> them‿<strong>out</strong>‿<strong>e</strong>venly.'],
      ['look at a sheet', '/ LOOK‿at‿a SHEET /', 'When we <strong>look</strong>‿at‿a <strong>sheet</strong>, we should ask about the choices behind it.'],
    ] },
    3: { tip: grouping, phrases: [
      ['I admire her work, but I want my own path.', '/ I admire her WORK | but I want my OWN PATH /', 'Yui explains, I admire her <strong>work</strong> | but I want my <strong>own path</strong>.'],
      ['Before you use this interview, check the context.', '/ Before you use this INterview | CHECK the CONtext /', 'Before you use this <strong>in</strong>terview | <strong>check</strong> the <strong>con</strong>text of Yui’s answer.'],
    ] },
    4: { tip: linking, phrases: [
      ['fit in a joint', '/ FIT‿in‿a JOINT /', 'Watch how the wooden pieces <strong>fit</strong>‿in‿a <strong>joint</strong>.'],
      ['depend on experience', '/ dePEND‿on‿exPErience /', 'Some decisions de<strong>pend</strong>‿on‿ex<strong>pe</strong>rience, as well as instructions.'],
    ] },
    6: { tip: 'Give the key contrast a clear beat while keeping small words light. Capitals suggest where the message is focused. Do not shout or force one rhythm; let the intended meaning guide the stress.', phrases: [
      ['compete on price', '/ compete on PRICE /', 'A workshop need not compete on <strong>price</strong> alone; buyers may value the skill.'],
      ['value the skill', '/ value the SKILL /', 'We can value the <strong>skill</strong> while respecting different budgets.'],
    ] },
    7: { tip: linking, phrases: [
      ['join in a dance', '/ join‿IN‿a DANCE /', 'The friends decide to join‿<strong>in</strong>‿a <strong>dance</strong> after watching the movements.'],
      ['get into the rhythm', '/ get‿INto the RHYthm /', 'Haru needs practice to get‿<strong>in</strong>to the <strong>rhy</strong>thm.'],
    ] },
    8: { tip: grouping, phrases: [
      ['The words are accurate, but the meaning has changed.', '/ The WORDS are accurate | but the MEANing has CHANGED /', 'Aiko warns, The <strong>words</strong> are accurate | but the <strong>mean</strong>ing has <strong>changed</strong>.'],
      ['Before we use the scene, restore the context.', '/ Before we use the SCENE | reSTORE the CONtext /', 'Before we use the <strong>scene</strong> | re<strong>store</strong> the <strong>con</strong>text of Yui’s contribution idea.'],
    ] },
    9: { tip: grouping, phrases: [
      ['One viewer changed her mind, but we cannot speak for everyone.', '/ One viewer changed her MIND | but we cannot speak for EVERYONE /', 'Daniel says, One viewer changed her <strong>mind</strong> | but we cannot speak for <strong>everyone</strong>.'],
      ['Before another journey, agree on the plan.', '/ Before another JOURney | aGREE on the PLAN /', 'Before another <strong>jour</strong>ney | a<strong>gree</strong> on the <strong>plan</strong> with the whole group.'],
    ] },
  },

  3: {
    1: { tip: linking, phrases: [
      ['bring an idea', '/ BRING‿an‿iDEa /', 'Aiko can <strong>bring</strong>‿an‿i<strong>de</strong>a to the planning call.'],
      ['check with a cook', '/ CHECK with‿a COOK /', 'Before publishing a recipe, <strong>check</strong> with‿a <strong>cook</strong>.'],
    ] },
    2: { tip: linking, phrases: [
      ['think about a meal', '/ THINK‿aBOUT‿a MEAL /', 'The flavour makes Haru <strong>think</strong>‿a<strong>bout</strong>‿a <strong>meal</strong> with his grandmother.'],
      ['make the most of it', '/ make the MOST‿of‿it /', 'When a seasonal ingredient is available, make the <strong>most</strong>‿of‿it.'],
    ] },
    3: { tip: grouping, phrases: [
      ['Some methods are quick, while others take longer.', '/ Some methods are QUICK | while others take LONGer /', 'Mr. Ishida explains, Some methods are <strong>quick</strong> | while others take <strong>long</strong>er.'],
      ['To keep the skill alive, producers need an income.', '/ To keep the skill aLIVE | producers need an INcome /', 'To keep the skill a<strong>live</strong> | producers need an <strong>in</strong>come as well as enthusiasm.'],
    ] },
    4: { tip: linking, phrases: [
      ['keep track of it', '/ keep TRACK‿of‿it /', 'When a condition changes, monitoring can help us keep <strong>track</strong>‿of‿it.'],
      ['develop over time', '/ deVELop‿over TIME /', 'The flavour can de<strong>vel</strong>op‿over <strong>time</strong>.'],
    ] },
    6: { tip: 'Use clear, calm stress when expressing or accepting a boundary. Keep smaller words light. Capitals show possible stress and ‿ shows a link; natural does not mean speaking quickly or weakening the refusal.', phrases: [
      ['I would rather keep it private.', '/ I would RAther KEEP‿it PRIvate /', 'I would <strong>ra</strong>ther <strong>keep</strong>‿it <strong>pri</strong>vate.'],
      ['talk about memories', '/ TALK‿about MEMories /', 'We can <strong>talk</strong>‿about <strong>mem</strong>ories without sharing the recipe.'],
    ] },
    7: { tip: grouping, phrases: [
      ['Sharing matters, but choice matters too.', '/ SHARing matters | but CHOICE matters TOO /', '<strong>Shar</strong>ing matters | but <strong>choice</strong> matters <strong>too</strong>.'],
      ['Before we announce the plan, speak to the organisers.', '/ Before we announce the PLAN | SPEAK to the organisers /', 'Before we announce the <strong>plan</strong> | <strong>speak</strong> to the organisers.'],
    ] },
    8: { tip: linking, phrases: [
      ['explain an alternative', '/ exPLAIN‿an‿alTERnative /', 'Mei can ex<strong>plain</strong>‿an‿al<strong>ter</strong>native to publishing every recipe.'],
      ['put it forward', '/ PUT‿it FORward /', 'If you have a respectful suggestion, <strong>put</strong>‿it <strong>for</strong>ward.'],
    ] },
    9: { tip: grouping, phrases: [
      ['This recipe is different, and the family one stays private.', '/ This recipe is DIFferent | and the FAMily one stays PRIvate /', 'This recipe is <strong>dif</strong>ferent | and the <strong>fam</strong>ily one stays <strong>pri</strong>vate.'],
      ['After the event, we thanked the cooks.', '/ After the eVENT | we THANKED the COOKS /', 'After the e<strong>vent</strong> | we <strong>thanked</strong> the <strong>cooks</strong> for their contributions.'],
    ] },
  },

  5: {
    1: { tip: linking, phrases: [
      ['take it on', '/ take‿it‿ON /', 'Haru wants to understand the role before he agrees to take‿it‿<strong>on</strong>.'],
      ['get advice', '/ GET‿adVICE /', 'He can <strong>get</strong>‿ad<strong>vice</strong> from his friends.'],
    ] },
    2: { tip: grouping, phrases: [
      ['Before I decide, I need to compare the options.', '/ Before I deCIDE | I need to comPARE the OPtions /', 'Before I de<strong>cide</strong> | I need to com<strong>pare</strong> the <strong>op</strong>tions.'],
      ['We can divide the roles, rather than carry everything alone.', '/ We can diVIDE the ROLES | rather than carry everything aLONE /', 'We can di<strong>vide</strong> the <strong>roles</strong> | rather than carry everything a<strong>lone</strong>.'],
    ] },
    3: { tip: linking, phrases: [
      ['put it in context', '/ PUT‿it‿in CONtext /', 'The interview helps us <strong>put</strong>‿it‿in <strong>con</strong>text.'],
      ['look at a photograph', '/ LOOK‿at‿a PHOtograph /', 'We can <strong>look</strong>‿at‿a <strong>pho</strong>tograph and ask about the story behind it.'],
    ] },
    4: { tip: 'Stress the words that express the shared priorities. Keep the smaller words lighter so the contrast between careful growth and quality is easy to hear.', phrases: [
      ['start small', '/ start SMALL /', 'We can start <strong>small</strong> before adding more classes.'],
      ['maintain the quality', '/ mainTAIN the QUALity /', 'We should expand only if we can main<strong>tain</strong> the <strong>qual</strong>ity.'],
    ] },
    6: { tip: linking, phrases: [
      ['work out a budget', '/ work‿OUT‿a BUDget /', 'Haru needs to work‿<strong>out</strong>‿a <strong>bud</strong>get for the trial.'],
      ['set aside enough', '/ set‿aSIDE‿eNOUGH /', 'We must set‿a<strong>side</strong>‿e<strong>nough</strong> for instructor payments.'],
    ] },
    7: { tip: grouping, phrases: [
      ['The display honours her, but it must include others.', '/ The display HONours HER | but it must include OTHers /', 'The display <strong>hon</strong>ours <strong>her</strong> | but it must include <strong>oth</strong>ers.'],
      ['After your feedback, we revised the display.', '/ After your FEEDback | we reVISED the disPLAY /', 'After your <strong>feed</strong>back | we re<strong>vised</strong> the dis<strong>play</strong>.'],
    ] },
    8: { tip: linking, phrases: [
      ['give an example', '/ GIVE‿an‿exAMple /', 'When thanking a teacher, <strong>give</strong>‿an‿ex<strong>am</strong>ple of what you learned.'],
      ['welcome a beginner', '/ WELcome‿a beGINner /', 'Haru is ready to <strong>wel</strong>come‿a be<strong>gin</strong>ner to the workshop.'],
    ] },
    9: { tip: grouping, phrases: [
      ['When you are ready, we can begin.', '/ When you are READy | we can beGIN /', 'When you are <strong>read</strong>y | we can be<strong>gin</strong>.'],
      ['Before we begin, please ask any questions.', '/ Before we beGIN | please ASK any QUEStions /', 'Before we be<strong>gin</strong> | please <strong>ask</strong> any <strong>ques</strong>tions.'],
    ] },
  },
};

export function buildNaturalPronunciation(data: NaturalPronunciationLesson) {
  return {
    stepName: 'STEP B: PRONUNCIATION', duration: '2 minutes',
    tip: `${data.tip} Bold marks the stressed words or syllables in the examples; capitals show the same stress in the guides.`,
    phrases: data.phrases.map(([phrase, pronunciationGuide, exampleSentence]) => ({ phrase, pronunciationGuide, exampleSentence })),
    tutorSteps: [
      { instruction: 'Introduce Step B Pronunciation.', script: 'Let’s make these phrases flow naturally, then use them in complete sentences.' },
      { instruction: 'Read the tip and model its focus.', tip: 'Explain the symbols used in this lesson. Model a comfortable speaking pace; keep the meaning clear.' },
      { instruction: 'Say the first phrase naturally, then have the student repeat.', tip: 'Use the guide to show a link, a focus word or a meaning group.' },
      { instruction: 'Read the full example and have the student repeat it.', tip: 'Keep words within a meaning group connected. Pause where an idea ends, rather than after every word.' },
      { instruction: 'Repeat with the second phrase and its full example.', tip: 'Compare careful word-by-word speech with a natural connected version. Correct one useful feature, then retry.' },
      { instruction: 'Transition to Apply.', script: 'Good. Let’s use this natural phrasing in the next activity.' },
    ],
  };
}

// Remove only the duplicate part, its transition, and pronunciation commentary.
const cleanPronunciationText = (text: string) => text
  .replace(/(?:The guides are|These are|Guides are) (?:classroom )?reading cues, not IPA[.]\s*/gi, '')
  .replace(/Follow a clear, comfortable accent[.]\s*/gi, '')
  .replace(/Accept clear speech in (?:any consistent|different) accents?[.]\s*/gi, '')
  .replace(/Avoid exaggerated reductions and forced accents[.]\s*/gi, '')
  .trim();

export function cleanLevel6Pronunciation(lesson: any) {
  if (lesson.level < 6) throw Error('Pronunciation cleanup requires Level 6 or above');
  const learnData = structuredClone(lesson.learnData);
  for (const step of learnData?.steps || []) {
    delete step.pronunciationPart;
    const discussion = step.discussionPart;
    if (discussion?.tutorSteps) discussion.tutorSteps = discussion.tutorSteps.map((item: any) =>
      /(?:part\s*(?:iii|3)|next part)/i.test(`${item.instruction || ''} ${item.script || ''}`) && /transition/i.test(item.instruction || '')
        ? { ...item, instruction: 'Transition to Step B Pronunciation.', script: 'Good. Let’s go to Step B Pronunciation.' } : item);
  }
  const clean = (value: any): any => typeof value === 'string' ? cleanPronunciationText(value)
    : Array.isArray(value) ? value.map(clean)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)])) : value;
  return { ...lesson, learnData, stepBData: clean(lesson.stepBData) };
}

export function applyNaturalPronunciation(lesson: any, data: NaturalPronunciationLesson) {
  if (lesson.level < 6) throw Error('Natural pronunciation migration requires Level 6 or above');
  return cleanLevel6Pronunciation({ ...lesson, stepBData: { stepType: 'pronunciation', pronunciation: buildNaturalPronunciation(data) } });
}
