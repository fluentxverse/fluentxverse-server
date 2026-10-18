import { describe, expect, test } from 'bun:test';
import { materialSections } from '../src/utils/materialProgress';

describe('material stopping points', () => {
  test('Conversation Skills uses the actual optional sections and exercise branches', () => {
    const sections = materialSections('conversational-skills', {
      learnData: { sectionTitle: 'LEARN', steps: [{ stepName: 'Step A Vocabulary', discussionPart: {}, pronunciationPart: {} }] },
      stepBData: { stepName: 'Step B Grammar' },
      applyData: { sectionNumber: 3, sectionTitle: 'APPLY' },
      exerciseData: { sectionNumber: 4, sectionTitle: 'PRACTICE', hasStepB: true },
      missionData: { sectionNumber: 5, sectionTitle: 'CHALLENGE 1' },
      missionData2: { sectionNumber: 5, sectionTitle: 'CHALLENGE 2' },
      feedbackData: { sectionNumber: 6, sectionTitle: 'FEEDBACK' },
    });
    expect(sections.find(section => section.id === 'exerciseData.stepA')?.label).toBe('Part 4 - PRACTICE - Step A');
    expect(sections.find(section => section.id === 'exerciseData.stepB')?.label).toBe('Part 4 - PRACTICE - Step B');
    expect(sections.find(section => section.id === 'learn.steps.0.discussion')?.label).toContain('Discussion');
    expect(sections.some(section => /^(missionData|feedbackData)/.test(section.id))).toBe(false);
    expect(new Set(sections.map(section => section.id)).size).toBe(sections.length);
  });

  test('Step B is not invented for one-step exercises and custom numbering is preserved', () => {
    const sections = materialSections('conversational-skills', { exerciseData: { sectionNumber: 3, sectionTitle: 'Exercise', hasStepB: false } });
    expect(sections.find(section => section.id === 'exerciseData')?.label).toBe('Part 3 - Exercise');
    expect(sections.some(section => section.id.endsWith('.stepB'))).toBe(false);
    expect(sections.some(section => section.id.startsWith('mission'))).toBe(false);
  });

  test('Parts 5 and 6 are excluded while Learn Step B uses its actual branch title', () => {
    const sections = materialSections('conversational-skills', {
      stepBData: { stepType: 'grammar-tip', grammarTip: { stepName: 'STEP B GRAMMAR TIP' } },
      missionData: { sectionNumber: 5, sectionTitle: 'MISSION', challengeName: 'CHALLENGE 1' },
      missionData2: { sectionNumber: 5, sectionTitle: 'MISSION', challengeName: 'CHALLENGE 2' },
      missionData3: { sectionNumber: 5, sectionTitle: 'MISSION', challengeName: 'CHALLENGE 3' },
      feedbackData: { sectionNumber: 6, sectionTitle: 'FEEDBACK' },
      applyData: { sectionNumber: 5, sectionTitle: 'Renumbered activity' },
    });
    expect(sections.find(section => section.id === 'learn.stepB')?.label).toBe('Part 2 - Learn - STEP B GRAMMAR TIP');
    expect(sections.some(section => /^Part [56]\b/.test(section.label))).toBe(false);
    expect(sections.some(section => /^(missionData|feedbackData|applyData)/.test(section.id))).toBe(false);
  });

  test('Business English excludes Open Talk and Wrap-up but keeps Simulation and drill steps', () => {
    const sections = materialSections('business-english', { beData: { practice: { steps: [{ title: 'Step A - Introductions' }, { title: 'Step B - Follow-up questions' }] }, discussion: { categories: [{}] } } });
    expect(sections.find(section => section.id === 'practice.steps.1')?.label).toBe('Part 4 - Drill - Step B - Follow-up questions');
    expect(sections.find(section => section.id === 'discussion')).toBeUndefined();
    expect(sections.find(section => section.id === 'feedback')).toBeUndefined();
    expect(sections.at(-1)?.label).toBe('Part 5 - Simulation');
    expect(materialSections('business-english', null)).toHaveLength(5);
  });

  test('Daily Dispatch has no resumable sections', () => {
    expect(materialSections('daily-dispatch', { exerciseData: {} })).toEqual([]);
    expect(materialSections('unknown-curriculum', null)).toEqual([]);
  });
});
