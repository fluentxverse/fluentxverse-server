import {expect,test} from 'bun:test';
import {existsSync,readFileSync} from 'node:fs';
import {languageSlots} from '../content/conversational-skills/ja/language-catalog';
import {buildToeicLesson,readLanguageRevision} from '../content/conversational-skills/ja/toeic-language';
import {conversationalLanguageTarget} from '../../shared/conversationalLanguage';
import {languageEpisodeErrors,wordCount} from '../content/conversational-skills/ja/language-validation';
import {conversationalLessonErrors} from '../src/utils/conversationalLessonValidation';

const lessons=languageSlots.map(s=>buildToeicLesson(s.level,s.chapter,s.number));
const episode=(level:number,chapter:number,n:number)=>readLanguageRevision(level,chapter,n).episode;
test('all 88 existing slots have reviewed local revisions at the owner score bands',()=>{
 expect(lessons).toHaveLength(88);
 expect([3,4,5].map(level=>lessons.filter(l=>l.level===level).length)).toEqual([40,40,8]);
 expect(conversationalLanguageTarget(3)).toMatchObject({toeicMin:10,toeicMax:220});
 expect(conversationalLanguageTarget(4)).toMatchObject({toeicMin:225,toeicMax:545});
 expect(conversationalLanguageTarget(5)).toMatchObject({toeicMin:225,toeicMax:545});
 for(const s of languageSlots){
  const r=readLanguageRevision(s.level,s.chapter,s.number),e=r.episode;
  expect(r.review.approved).toBe(true);
  expect(languageEpisodeErrors(e,s.level,s.episodes[s.number].skill)).toEqual([]);
  expect(e.title).toBe(s.episodes[s.number].title);
  expect(e.goal[0]).toMatch(/^I can /);
  expect(e.words).toHaveLength(6);expect(e.choose).toHaveLength(6);expect(e.choices).toHaveLength(4);
 }
});
test('all composed lessons validate and retain standard guides, Japanese and feedback',()=>{
 for(const l of lessons){
  expect(conversationalLessonErrors(l)).toEqual([]);
  expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
  expect(l.learnData.steps[0].tutorSteps).toHaveLength(5);
  expect(l.learnData.steps[0].discussionPart.tutorSteps).toHaveLength(5);
  expect(l.learnData.steps[0].pronunciationPart.tutorSteps).toHaveLength(5);
  expect(l.stepBData.grammarTip.tutorSteps).toHaveLength(2);
  expect(l.applyData.tutorSteps).toHaveLength(2);
  expect(l.missionData.tutorSteps).toHaveLength(l.skill==='speaking'?3:4);
  expect(l.feedbackData.categories.map((v:any)=>v.title)).toEqual(['RANGE','ACCURACY','FLUENCY']);
  expect(l.goalTextJp).toMatch(/[ぁ-んァ-ン\p{Script=Han}]/u);
 }
});
test('models fit their budgets; listening stays private; reading challenges have new evidence',()=>{
 for(const l of lessons){
  const target=conversationalLanguageTarget(l.level)!;
  if(l.skill==='speaking'){
   expect(l.applyData.dialogueLines).toHaveLength(10);
   expect(wordCount(l.applyData.dialogueLines.map((v:any)=>v.text).join(' '))).toBeLessThanOrEqual(target.maxDialogueWords);
  }else if(l.skill==='listening'){
   expect(l.applyData.readingText).toBe('');expect(l.applyData.dialogueLines).toEqual([]);
   expect(l.missionData.readingPassage).toBeUndefined();expect(l.missionData.listeningScript).toBeUndefined();
   const a=l.applyData.tutorSteps[0].listeningScript,b=l.missionData.tutorSteps[1].listeningScript;
   expect(a).not.toBe(b);expect(wordCount(a)).toBeLessThanOrEqual(target.maxListeningWords);expect(wordCount(b)).toBeLessThanOrEqual(target.maxListeningWords);
  }else{
   expect(l.missionData.readingPassage.blocks[0].content).not.toBe(l.applyData.readingText);
   expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(target.maxReadingWords);
  }
 }
});
test('key numerical and unresolved story facts survive the lower language level',()=>{
 expect(episode(3,2,4).apply.dialogue.flat().join(' ')).toContain('600 yen');
 expect(episode(3,2,8).mission.text).toContain('300 yen extra');
 expect(episode(3,3,2).mission.text).toContain('five-thirty');
 expect(episode(3,3,8).mission.text).toContain('Saturday at 6:30');
 expect(episode(3,4,3).mission.text).toContain('3,200 yen');
 expect(episode(3,4,4).mission.evidence).toContain('7700');
 expect(episode(3,4,8).mission.text).toContain('Monday at 5 p.m.');
 expect(episode(3,5,1).intro[0]).toContain('Mondays and Fridays');
 expect(episode(3,5,3).mission.text).toContain('by 7:30');
 expect(episode(3,5,8).mission.text).toContain('Monday’s project handover at ten');
 expect(episode(3,5,9).intro[0]).toContain('not made a final decision');
 expect(episode(4,5,6).mission.evidence).toContain('150,000');
 expect(episode(4,5,7).mission.situation[0]).toContain('twelve');
 expect(episode(4,5,9).intro[0]).toContain('Three months');
});
test('role switches stay usable and later decisions are not announced early',()=>{
 const dual=lessons.find(l=>l.level===3&&l.chapter===4&&l.lessonNumber===9)!;
 const scripts=dual.missionData.tutorSteps[1].scripts.map((v:any)=>v.text).join(' ');
 expect(scripts).toContain('Now I will be the agency recruiter');expect(scripts).toContain('Monday morning');expect(scripts).toContain('five p.m.');
 const welcome=lessons.find(l=>l.level===4&&l.chapter===5&&l.lessonNumber===9)!;
 expect(welcome.missionData.tutorSteps[1].scripts.map((v:any)=>v.text).join(' ')).toContain('Now I will be the new resident');
});
test('saved identities, artwork, publication states and fixed definitions are preserved without mutation',()=>{
 const previous:any={id:'keep-id',status:'published',backgroundImage:'keep-header.webp',introductionData:{introImage:'keep-intro.webp'},applyData:{situationImage:'keep-apply.webp'},missionData:{image:'keep-challenge.webp'},feedbackData:{categories:[{title:'KEEP'}],rubricLevels:[{score:4}]}};
 const copy=JSON.stringify(previous),l=buildToeicLesson(3,1,1,previous);
 expect(l.id).toBe(previous.id);expect(l.status).toBe('published');expect(l.backgroundImage).toBe(previous.backgroundImage);
 expect(l.introductionData.introImage).toBe('keep-intro.webp');expect(l.applyData.situationImage).toBe('keep-apply.webp');expect(l.missionData.image).toBe('keep-challenge.webp');
 expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);expect(l.feedbackData.rubricLevels).toEqual(previous.feedbackData.rubricLevels);expect(JSON.stringify(previous)).toBe(copy);
});
test('offline authoring cannot call a model API and the API batch script is gone',()=>{
 expect(existsSync(new URL('../../scripts/generate-toeic-language-revisions.ts',import.meta.url))).toBe(false);
 const source=readFileSync(new URL('../../scripts/compile-editorial-language-revisions.ts',import.meta.url),'utf8');
 expect(source).not.toMatch(/createAgent|agentFactory|\.generate\(|fetch\(|cloud-ssh|execFile|OPENAI_API_KEY/);
 expect(source).toContain('modelApiCalls:0');
});
