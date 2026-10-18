/**
 * Student Material Generator
 * 
 * This utility strips tutor-only content from lesson materials
 * to create a student-safe version that doesn't expose teaching hints,
 * scripts, or instructor-specific content.
 */

/**
 * Fields that should be stripped from sections for student view:
 * - lessonGoalSteps (tutor instructions and scripts)
 * - lessonGoalTitle (tutor goal header)
 * - sidebarTitle (tutor sidebar header)
 * - sidebarSubtitle (tutor sidebar subheader)
 * - All fields containing tipText, scriptLine, scriptLines
 */

export interface LessonGoalStep {
  id: string;
  instruction: string;
  scriptLine?: string;
  scriptLines?: string[];
  tipText?: string;
}

export interface SectionContent {
  id: string;
  sectionNumber: string;
  sectionTitle: string;
  sectionType?: string;
  explanationEn?: string;
  explanationJp?: string;
  sectionImage?: string;
  stepTitle?: string;
  instructionEn?: string;
  instructionJp?: string;
  vocabItems?: any[];
  questionInstruction?: string;
  questionInstructionJp?: string;
  questions?: any[];
  
  // Tutor-only fields (to be stripped)
  lessonGoalTitle?: string;
  lessonGoalSteps?: LessonGoalStep[];
  sidebarTitle?: string;
  sidebarSubtitle?: string;
  
  // Other section-specific fields
  [key: string]: any;
}

export interface LessonMaterialDraft {
  version: number;
  header: any;
  sections: SectionContent[];
  vocabulary?: any[];
  grammar?: any[];
  exercises?: any[];
  [key: string]: any;
}

/**
 * Strips tutor-only content from lesson material to create student version
 * 
 * @param tutorMaterial - The full tutor material with all hints and scripts
 * @returns Student-safe material without tutor content
 */
export function generateStudentMaterial(tutorMaterial: LessonMaterialDraft): LessonMaterialDraft {
  // Deep clone to avoid mutating original
  const studentMaterial: LessonMaterialDraft = JSON.parse(JSON.stringify(tutorMaterial));
  
  // Filter out feedback sections entirely
  studentMaterial.sections = studentMaterial.sections.filter(
    section => section.sectionType !== 'feedback'
  );
  
  // Strip tutor-only fields from each section
  studentMaterial.sections = studentMaterial.sections.map(section => {
    const cleanSection: SectionContent = { ...section };
    
    // Remove tutor goal/instruction fields
    delete cleanSection.lessonGoalTitle;
    delete cleanSection.lessonGoalSteps;
    delete cleanSection.sidebarTitle;
    delete cleanSection.sidebarSubtitle;
    
    // Remove any tip-related fields that might exist at section level
    delete cleanSection.tipText;
    delete cleanSection.scriptLine;
    delete cleanSection.scriptLines;
    
    // Clean up vocabulary items if they have tutor notes
    if (cleanSection.vocabItems) {
      cleanSection.vocabItems = cleanSection.vocabItems.map((item: any) => {
        const cleanItem = { ...item };
        delete cleanItem.tutorNote;
        delete cleanItem.teachingTip;
        return cleanItem;
      });
    }
    
    // Clean up questions if they have answer explanations for tutors
    if (cleanSection.questions) {
      cleanSection.questions = cleanSection.questions.map((q: any) => {
        const cleanQ = { ...q };
        delete cleanQ.tutorExplanation;
        delete cleanQ.expectedAnswer;
        delete cleanQ.gradingRubric;
        return cleanQ;
      });
    }
    
    // Clean listeningQuestions
    if (cleanSection.listeningQuestions) {
      cleanSection.listeningQuestions = cleanSection.listeningQuestions.map((q: any) => {
        const cleanQ = { ...q };
        delete cleanQ.tutorNote;
        return cleanQ;
      });
    }
    
    // Clean readingQuestions
    if (cleanSection.readingQuestions) {
      cleanSection.readingQuestions = cleanSection.readingQuestions.map((q: any) => {
        const cleanQ = { ...q };
        delete cleanQ.tutorNote;
        return cleanQ;
      });
    }
    
    // Clean grammar tip items (these are for tutor display)
    if (cleanSection.grammarTipTitle || cleanSection.grammarTipItems) {
      // Keep grammar tips visible but remove any tutor-specific instructions
      // Actually, grammar tips might be student-facing, so we keep them
    }
    
    // Clean conversation prompts (keep for student, but remove tutor hints)
    if (cleanSection.conversationPrompts) {
      // These are student-facing, keep them
    }
    
    return cleanSection;
  });
  
  // Add a marker to identify this as student material
  studentMaterial._isStudentVersion = true;
  studentMaterial._generatedAt = new Date().toISOString();
  
  return studentMaterial;
}

/**
 * Validates that material is the student version
 */
export function isStudentMaterial(material: any): boolean {
  return material?._isStudentVersion === true;
}

/**
 * Gets the byte size reduction percentage between tutor and student material
 */
export function getMaterialSizeReduction(tutorMaterial: any, studentMaterial: any): number {
  const tutorSize = JSON.stringify(tutorMaterial).length;
  const studentSize = JSON.stringify(studentMaterial).length;
  return Math.round((1 - studentSize / tutorSize) * 100);
}
