import { Elysia } from 'elysia';
import { lessonService, type LessonMaterial } from '../services/lesson.services/lesson.service';
import { verifyAuthToken, type JwtAuthPayload } from '../utils/jwt';
import { generateStudentMaterial, getMaterialSizeReduction } from '../utils/studentMaterial';
import { getAuthFromCookie } from '../utils/refreshCookie';
import { publicFilePath } from '../utils/publicFilePath';

// Internal URL for server-to-server communication inside Docker
const FILER_BASE = process.env.SEAWEED_FILER_URL || 'http://localhost:8888';
// API base URL for constructing proxy URLs (browser accesses files via API)
const API_BASE = process.env.API_PUBLIC_URL || 'http://localhost:8765';

const getDashboardPublicUrl = (): string => {
  const explicit = process.env.ADMIN_DASHBOARD_PUBLIC_URL || process.env.DASHBOARD_PUBLIC_URL;
  if (explicit) return explicit;

  const raw = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '';
  const origins = raw
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const preferred = origins.find(o => /dashboard|admin/i.test(o)) || origins[0];
  return preferred || 'http://localhost:5175';
};

/**
 * Upload a file to SeaweedFS Filer
 * Returns a proxy URL through the API server (not direct SeaweedFS URL)
 */
async function uploadToSeaweed(path: string, content: Blob | string, contentType: string): Promise<string> {
  const uploadUrl = `${FILER_BASE}${path}`;
  
  const body = typeof content === 'string' ? content : content;
  
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: body,
    headers: {
      'Content-Type': contentType
    }
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
  
  // Return proxy URL through API server, not direct SeaweedFS URL
  // This keeps SeaweedFS internal and secure
  return `${API_BASE}/lesson/files${path}`;
}

/**
 * Fetch a file from SeaweedFS Filer
 */
async function fetchFromSeaweed(path: string): Promise<any | null> {
  try {
    const url = `${FILER_BASE}${path}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Generate HTML from lesson material data
 * Supports both old format (vocabulary/grammar/exercises) and new format (sections)
 */
function generateLessonHtml(lesson: LessonMaterial, imageUrl?: string): string {
  const dashboardBase = getDashboardPublicUrl();

  // Pixel-perfect: redirect to the real dashboard lesson renderer in preview mode.
  // The viewer computes tutor-data.json URL from the current index.html location.
  // NOTE: Requires dashboard to allow unauth access when `src` or `previewToken` is present.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>Lesson Material</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 16px; }
    a { color: inherit; }
  </style>
</head>
<body>
  <p>Opening lesson…</p>
  <script>
    (function () {
      try {
        var indexUrl = new URL(window.location.href);
        // /.../index.html -> /.../tutor-data.json
        indexUrl.pathname = indexUrl.pathname.replace(/\/index\.html$/, '/tutor-data.json');
        var src = indexUrl.toString();
        var viewer = new URL('${dashboardBase.replace(/'/g, "\\'")}');
        viewer.pathname = (viewer.pathname || '/').replace(/\/$/, '') + '/lesson-material-maker';
        viewer.searchParams.set('src', src);
        viewer.searchParams.set('preview', '1');
        // Preserve print flow if present
        var print = new URLSearchParams(window.location.search).get('print');
        if (print === '1') viewer.searchParams.set('print', '1');
        window.location.replace(viewer.toString());
      } catch (e) {
        document.body.innerHTML = '<p>Failed to open lesson. Please open in the dashboard directly.</p>';
      }
    })();
  </script>
</body>
</html>`;

  // Legacy standalone HTML generator below (kept for reference).
  // eslint-disable-next-line no-unreachable
  const { header } = lesson;
  const sections = (lesson as any).sections || [];
  
  // Use the uploaded image URL or fallback to gradient
  const backgroundStyle = imageUrl || header?.backgroundImage
    ? `background-image: url(${imageUrl || header?.backgroundImage});`
    : 'background: linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%);';

  // Generate sections HTML
  const sectionsHtml = sections.map((section: any) => generateSectionHtml(section)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(header?.lessonLabel) || 'Lesson Material'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f1f5f9; color: #1e293b; line-height: 1.6; }
    
    /* Header Styles */
    .lesson-header {
      position: relative;
      min-height: 140px;
      display: flex;
      flex-direction: column;
      background-size: cover;
      background-position: center;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      ${backgroundStyle}
    }
    .lesson-header-overlay {
      position: absolute;
      inset: 0;
      background-color: ${header?.overlayColor || 'rgba(0,0,0,0.45)'};
    }
    .lesson-header-content { 
      position: relative; 
      z-index: 2; 
      color: #fff; 
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 20px 16px;
    }
    .lesson-header-top { 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      gap: 8px; 
      margin-bottom: 8px; 
      font-size: 11px; 
      font-weight: 600;
      opacity: 0.95; 
      text-transform: uppercase; 
      letter-spacing: 0.5px; 
    }
    .level-badge { 
      background: rgba(255,255,255,0.2); 
      padding: 3px 8px; 
      border-radius: 4px; 
      font-weight: 600; 
    }
    .header-divider { opacity: 0.6; }
    .lesson-label { 
      font-size: 20px; 
      font-weight: 700; 
      margin-bottom: 8px; 
      color: #fbbf24; 
    }
    .goal-row { 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      gap: 10px; 
      margin-bottom: 6px; 
    }
    .goal-badge { 
      display: inline-block;
      background: #22c55e; 
      color: #fff; 
      padding: 4px 10px; 
      border-radius: 4px; 
      font-weight: 800; 
      font-size: 11px; 
      letter-spacing: 0.8px;
      flex-shrink: 0;
    }
    .goal-text { 
      font-size: 22px; 
      font-weight: 800; 
      text-shadow: 0 2px 4px rgba(0,0,0,0.3); 
    }
    .goal-subtext { 
      font-size: 14px; 
      opacity: 0.9;
      margin-top: 4px;
    }
    
    /* Main Body */
    .lesson-body { 
      max-width: 900px; 
      margin: 0 auto; 
      padding: 32px 24px; 
      background: #f1f5f9; 
      min-height: calc(100vh - 140px); 
    }
    
    /* Section Card Styles */
    .section-card { 
      background: #fff; 
      border-radius: 16px; 
      margin-bottom: 24px; 
      box-shadow: 0 2px 12px rgba(0,0,0,0.06); 
      border: 1px solid #e2e8f0; 
      overflow: hidden;
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 24px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    .section-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: #3b82f6;
      color: #fff;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .section-content {
      padding: 24px;
    }
    
    /* Explanation Text */
    .explanation-text {
      font-size: 16px;
      color: #334155;
      margin-bottom: 12px;
      line-height: 1.7;
    }
    .explanation-jp {
      font-size: 14px;
      color: #64748b;
      border-left: 3px solid #e2e8f0;
      padding-left: 12px;
      margin-bottom: 20px;
    }
    
    /* Section Image */
    .section-image {
      width: 100%;
      max-width: 600px;
      border-radius: 12px;
      margin: 20px auto;
      display: block;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    
    /* Step Title */
    .step-title {
      font-size: 14px;
      font-weight: 700;
      color: #3b82f6;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
    }
    
    /* Instruction */
    .instruction-text {
      font-size: 15px;
      color: #475569;
      margin-bottom: 8px;
    }
    .instruction-jp {
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 20px;
    }
    
    /* Vocabulary Cards */
    .vocab-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .vocab-card {
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      border: 1px solid #bae6fd;
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .vocab-word {
      font-size: 20px;
      font-weight: 700;
      color: #0369a1;
      margin-bottom: 4px;
    }
    .vocab-reading {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 8px;
    }
    .vocab-meaning {
      font-size: 14px;
      color: #334155;
      font-weight: 500;
    }
    .vocab-image {
      width: 80px;
      height: 80px;
      object-fit: cover;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    
    /* Grammar Rules */
    .grammar-rule {
      background: #fefce8;
      border-left: 4px solid #eab308;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .grammar-pattern {
      font-size: 16px;
      font-weight: 700;
      color: #854d0e;
      margin-bottom: 8px;
    }
    .grammar-meaning {
      font-size: 14px;
      color: #713f12;
      margin-bottom: 8px;
    }
    .grammar-example {
      font-size: 14px;
      color: #92400e;
      font-style: italic;
    }
    
    /* Dialogue */
    .dialogue-container {
      margin-top: 16px;
    }
    .dialogue-line {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .dialogue-speaker {
      font-weight: 700;
      color: #3b82f6;
      min-width: 80px;
    }
    .dialogue-text {
      flex: 1;
    }
    .dialogue-en {
      font-size: 15px;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .dialogue-jp {
      font-size: 13px;
      color: #64748b;
    }
    
    /* Practice Items */
    .practice-example {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .practice-example-label {
      font-size: 12px;
      font-weight: 700;
      color: #16a34a;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .practice-question {
      font-size: 15px;
      color: #334155;
    }
    .practice-answer {
      font-size: 15px;
      color: #15803d;
      margin-top: 8px;
      font-weight: 600;
    }
    .practice-items {
      margin-top: 16px;
    }
    .practice-item {
      display: flex;
      gap: 12px;
      padding: 12px;
      background: #f8fafc;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .practice-number {
      font-weight: 700;
      color: #3b82f6;
      min-width: 24px;
    }
    
    /* Challenge Section */
    .challenge-badge {
      display: inline-block;
      background: #dc2626;
      color: #fff;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .optional-badge {
      display: inline-block;
      background: #f59e0b;
      color: #fff;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 8px;
    }
    .situation-box {
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .situation-label {
      font-size: 12px;
      font-weight: 700;
      color: #92400e;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .situation-text {
      font-size: 15px;
      color: #78350f;
    }
    
    /* Grammar Tip Box */
    .grammar-tip-box {
      background: #f0fdfa;
      border: 1px solid #5eead4;
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
    }
    .grammar-tip-title {
      font-size: 14px;
      font-weight: 700;
      color: #0f766e;
      margin-bottom: 12px;
    }
    .grammar-tip-item {
      font-size: 14px;
      color: #115e59;
      padding: 4px 0;
      padding-left: 16px;
      position: relative;
    }
    .grammar-tip-item::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #14b8a6;
    }
    
    /* Questions */
    .questions-list {
      margin-top: 16px;
    }
    .question-item {
      background: #f8fafc;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      border-left: 4px solid #3b82f6;
    }
    .question-text {
      font-size: 15px;
      color: #0f172a;
      margin-bottom: 8px;
    }
    .question-answer {
      font-size: 14px;
      color: #16a34a;
      font-weight: 600;
    }
    
    /* Trivia */
    .trivia-examples {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .trivia-card {
      background: #fdf4ff;
      border: 1px solid #e879f9;
      border-radius: 12px;
      padding: 16px;
    }
    .trivia-jp {
      font-size: 18px;
      font-weight: 700;
      color: #a21caf;
      margin-bottom: 8px;
    }
    .trivia-en {
      font-size: 14px;
      color: #86198f;
    }
    
    /* Listening Section */
    .script-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px;
      margin: 16px 0;
      font-size: 16px;
      line-height: 2;
      color: #334155;
    }
    .underlined {
      text-decoration: underline;
      text-decoration-color: #3b82f6;
      text-underline-offset: 4px;
    }
    
    /* Reading Section */
    .reading-dialogue {
      background: #f8fafc;
      border-radius: 12px;
      padding: 20px;
      margin: 16px 0;
    }
    .reading-line {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .reading-speaker {
      font-weight: 700;
      color: #7c3aed;
      min-width: 70px;
    }
    .reading-text {
      font-size: 15px;
      color: #334155;
    }
    
    /* Image Cards */
    .image-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .image-card {
      text-align: center;
    }
    .image-card img {
      width: 100%;
      height: 120px;
      object-fit: cover;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .image-card-label {
      font-size: 14px;
      font-weight: 600;
      color: #334155;
    }
    
    /* Pronunciation */
    .pronunciation-columns {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 24px;
      margin-top: 16px;
    }
    .pronunciation-column {
      background: #f8fafc;
      border-radius: 8px;
      padding: 16px;
    }
    .pronunciation-header {
      font-weight: 700;
      color: #3b82f6;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #3b82f6;
    }
    .pronunciation-item {
      padding: 8px 0;
      font-size: 15px;
      color: #334155;
    }
    
    /* Conversation Lines */
    .conversation-container {
      margin-top: 16px;
    }
    .conversation-line {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .conversation-role {
      font-weight: 700;
      color: #3b82f6;
      min-width: 70px;
    }
    .conversation-text {
      font-size: 15px;
      color: #334155;
    }
    .conversation-blank {
      display: inline-block;
      min-width: 80px;
      border-bottom: 2px dashed #94a3b8;
      margin: 0 4px;
    }
    
    /* Word Box */
    .word-box {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 16px;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .word-tag {
      background: #fff;
      border: 1px solid #0ea5e9;
      color: #0369a1;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
    }
    
    /* Topic Boxes */
    .topic-boxes {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-top: 16px;
    }
    .topic-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
    }
    .topic-title {
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #3b82f6;
    }
    .topic-item {
      padding: 6px 0;
      font-size: 14px;
      color: #475569;
    }
    
    /* Print Styles */
    @media print {
      body { background: #fff; }
      .lesson-body { padding: 20px; max-width: 100%; }
      .section-card { box-shadow: none; border: 1px solid #ccc; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header class="lesson-header">
    <div class="lesson-header-overlay"></div>
    <div class="lesson-header-content">
      <div class="lesson-header-top">
        <span class="level-badge">${escapeHtml(header?.levelBadge || '')}</span>
        <span class="header-divider">|</span>
        <span>${escapeHtml(header?.chapterLabel || '')}</span>
      </div>
      <h1 class="lesson-label">${escapeHtml(header?.lessonLabel || '')}</h1>
      <div class="goal-row">
        <span class="goal-badge">GOAL</span>
        <span class="goal-text">${escapeHtml(header?.goalText || '')}</span>
      </div>
      <p class="goal-subtext">${escapeHtml(header?.goalSubtext || '')}</p>
    </div>
  </header>
  <main class="lesson-body">
    ${sectionsHtml || '<div class="section-card"><div class="section-content"><p>No content available.</p></div></div>'}
  </main>
</body>
</html>`;
}

/**
 * Generate HTML for a single section based on its type
 */
function generateSectionHtml(section: any): string {
  const sectionNumber = section.sectionNumber || '';
  const sectionTitle = section.sectionTitle || '';
  const sectionType = section.sectionType || 'introduce';

  let contentHtml = '';

  // Common elements
  if (section.explanationEn) {
    contentHtml += `<p class="explanation-text">${escapeHtml(section.explanationEn)}</p>`;
  }
  if (section.explanationJp) {
    contentHtml += `<p class="explanation-jp">${escapeHtml(section.explanationJp)}</p>`;
  }
  if (section.sectionImage) {
    contentHtml += `<img src="${escapeHtml(section.sectionImage)}" alt="Section illustration" class="section-image" />`;
  }
  if (section.stepTitle) {
    contentHtml += `<div class="step-title">${escapeHtml(section.stepTitle)}</div>`;
  }
  if (section.instructionEn) {
    contentHtml += `<p class="instruction-text">${escapeHtml(section.instructionEn)}</p>`;
  }
  if (section.instructionJp) {
    contentHtml += `<p class="instruction-jp">${escapeHtml(section.instructionJp)}</p>`;
  }

  // Vocabulary cards
  if (section.vocabCards && section.vocabCards.length > 0) {
    const getVocabImage = (card: any): string => card?.imageUrl || card?.image || '';
    const getVocabWord = (card: any): string => card?.word || card?.wordEn || '';
    const getVocabReading = (card: any): string => card?.reading || card?.wordJp || '';
    const getVocabMeaning = (card: any): string => card?.meaning || card?.english || card?.definition || '';
    contentHtml += `<div class="vocab-grid">
      ${section.vocabCards.map((card: any) => `
        <div class="vocab-card">
          ${getVocabImage(card) ? `<img src="${escapeHtml(getVocabImage(card))}" alt="${escapeHtml(getVocabWord(card))}" class="vocab-image" />` : ''}
          <div class="vocab-word">${escapeHtml(getVocabWord(card))}</div>
          ${getVocabReading(card) ? `<div class="vocab-reading">${escapeHtml(getVocabReading(card))}</div>` : ''}
          ${getVocabMeaning(card) ? `<div class="vocab-meaning">${escapeHtml(getVocabMeaning(card))}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  // Image cards (for question sections)
  if (section.imageCards && section.imageCards.length > 0) {
    const getImageCardUrl = (card: any): string => card?.imageUrl || card?.image || '';
    contentHtml += `<div class="image-cards-grid">
      ${section.imageCards.map((card: any) => `
        <div class="image-card">
          ${getImageCardUrl(card) ? `<img src="${escapeHtml(getImageCardUrl(card))}" alt="${escapeHtml(card.label || '')}" />` : ''}
          <div class="image-card-label">${escapeHtml(card.label || '')}</div>
        </div>
      `).join('')}
    </div>`;
  }

  // Pronunciation columns
  if (section.pronunciationColumns && section.pronunciationColumns.length > 0) {
    contentHtml += `<div class="pronunciation-columns">
      ${section.pronunciationColumns.map((col: any) => `
        <div class="pronunciation-column">
          <div class="pronunciation-header">${escapeHtml(col.soundLabel || col.header || '')}</div>
          ${col.image ? `<img src="${escapeHtml(col.image)}" alt="Mouth position" class="section-image" />` : ''}
          ${(col.words || col.items || []).map((item: any) => {
            if (typeof item === 'string') {
              return `<div class="pronunciation-item">${escapeHtml(item)}</div>`;
            }
            const en = item?.wordEn || item?.text || item?.word || '';
            const jp = item?.wordJp || item?.reading || '';
            return `<div class="pronunciation-item">${escapeHtml(en)}${jp ? ` <span style="opacity:0.75;">(${escapeHtml(jp)})</span>` : ''}</div>`;
          }).join('')}
        </div>
      `).join('')}
    </div>`;
  }

  // Grammar rules
  if (section.grammarRules && section.grammarRules.length > 0) {
    contentHtml += section.grammarRules.map((rule: any) => {
      const ruleEn = rule?.ruleEn || rule?.pattern || rule?.structure || '';
      const ruleJp = rule?.ruleJp || '';
      const meaning = rule?.meaning || '';
      const example = rule?.example || '';
      const examples = Array.isArray(rule?.examples) ? rule.examples : [];
      const examplesHtml = examples.length
        ? `<div class="questions-list">${examples.map((ex: any) => {
            const en = ex?.sentenceEn || ex?.textEn || ex?.english || '';
            const jp = ex?.sentenceJp || ex?.textJp || ex?.japanese || '';
            return `<div class="question-item"><div class="question-text">${escapeHtml(en)}</div>${jp ? `<div class="question-answer">${escapeHtml(jp)}</div>` : ''}</div>`;
          }).join('')}</div>`
        : '';

      return `
        <div class="grammar-rule">
          ${ruleEn ? `<div class="grammar-pattern">${escapeHtml(ruleEn)}</div>` : ''}
          ${ruleJp ? `<div class="grammar-meaning">${escapeHtml(ruleJp)}</div>` : ''}
          ${meaning && !ruleJp ? `<div class="grammar-meaning">${escapeHtml(meaning)}</div>` : ''}
          ${example ? `<div class="grammar-example">${escapeHtml(example)}</div>` : ''}
          ${examplesHtml}
        </div>
      `;
    }).join('');
  }

  // Dialogue lines
  if (section.dialogueLines && section.dialogueLines.length > 0) {
    if (section.dialogueImage) {
      contentHtml += `<img src="${escapeHtml(section.dialogueImage)}" alt="Dialogue scene" class="section-image" />`;
    }
    contentHtml += `<div class="dialogue-container">
      ${section.dialogueLines.map((line: any) => `
        <div class="dialogue-line">
          <span class="dialogue-speaker">${escapeHtml(line.speaker || '')}</span>
          <div class="dialogue-text">
            <div class="dialogue-en">${escapeHtml(line.textEn || line.lineEn || '')}</div>
            ${line.textJp || line.lineJp ? `<div class="dialogue-jp">${escapeHtml(line.textJp || line.lineJp || '')}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>`;
  }

  // Trivia examples
  if (section.triviaExamples && section.triviaExamples.length > 0) {
    if (section.triviaImage) {
      contentHtml += `<img src="${escapeHtml(section.triviaImage)}" alt="Trivia" class="section-image" />`;
    }
    contentHtml += `<div class="trivia-examples">
      ${section.triviaExamples.map((ex: any) => `
        <div class="trivia-card">
          ${ex.speakerA || ex.lineA ? `<div class="trivia-en"><strong>${escapeHtml(ex.speakerA || 'A')}:</strong> ${escapeHtml(ex.lineA || '')}</div>` : ''}
          ${ex.speakerB || ex.lineB ? `<div class="trivia-en"><strong>${escapeHtml(ex.speakerB || 'B')}:</strong> ${escapeHtml(ex.lineB || '')}</div>` : ''}
          ${(ex.lineAJp || ex.lineBJp) ? `<div class="trivia-jp">${[ex.lineAJp, ex.lineBJp].filter(Boolean).map((t: string) => escapeHtml(t)).join('<br/>')}</div>` : ''}
          ${typeof ex.isCorrect === 'boolean' ? `<div class="trivia-en" style="margin-top:8px;font-weight:700;">${ex.isCorrect ? '✓ Correct' : '✗ Wrong'}</div>` : ''}
          ${(!ex.speakerA && !ex.lineA && !ex.speakerB && !ex.lineB) ? `<div class="trivia-jp">${escapeHtml(ex.textJp || ex.japanese || '')}</div><div class="trivia-en">${escapeHtml(ex.textEn || ex.english || '')}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  // Practice section
  if (section.practiceExample) {
    contentHtml += `<div class="practice-example">
      <div class="practice-example-label">Example</div>
      <div class="practice-question">${escapeHtml(section.practiceExample)}</div>
      ${section.practiceExampleAnswer ? `<div class="practice-answer">${escapeHtml(section.practiceExampleAnswer)}</div>` : ''}
    </div>`;
  }
  if (section.practiceItems && section.practiceItems.length > 0) {
    if (section.practiceImage) {
      contentHtml += `<img src="${escapeHtml(section.practiceImage)}" alt="Practice" class="section-image" />`;
    }
    contentHtml += `<div class="practice-items">
      ${section.practiceItems.map((item: any, idx: number) => `
        <div class="practice-item">
          <span class="practice-number">${idx + 1}.</span>
          <span>${escapeHtml(item.question || item.text || '')}</span>
        </div>
      `).join('')}
    </div>`;
  }

  // Word box
  if (section.wordBox && section.wordBox.length > 0) {
    contentHtml += `<div class="word-box">
      ${section.wordBox.map((word: string) => `<span class="word-tag">${escapeHtml(word)}</span>`).join('')}
    </div>`;
  }

  // Conversation lines
  if (section.conversationLines && section.conversationLines.length > 0) {
    contentHtml += `<div class="conversation-container">
      ${section.conversationLines.map((line: any) => `
        <div class="conversation-line">
          <span class="conversation-role">${escapeHtml(line.role || line.speaker || '')}</span>
          <span class="conversation-text">${escapeHtml(line.text || '').replace(/___+/g, '<span class="conversation-blank"></span>')}</span>
        </div>
      `).join('')}
    </div>`;
  }

  // Challenge section
  if (section.challengeTitle) {
    contentHtml = `<span class="challenge-badge">${escapeHtml(section.challengeTitle)}</span>
      ${section.isOptional ? '<span class="optional-badge">If Time Allows</span>' : ''}` + contentHtml;
  }
  if (section.situationEn || section.situationJp) {
    contentHtml += `<div class="situation-box">
      <div class="situation-label">Situation</div>
      ${section.situationEn ? `<div class="situation-text">${escapeHtml(section.situationEn)}</div>` : ''}
      ${section.situationJp ? `<div class="situation-text" style="margin-top:8px;font-size:13px;color:#92400e;">${escapeHtml(section.situationJp)}</div>` : ''}
    </div>`;
  }
  if (section.grammarTipTitle || (section.grammarTipItems && section.grammarTipItems.length > 0)) {
    contentHtml += `<div class="grammar-tip-box">
      ${section.grammarTipTitle ? `<div class="grammar-tip-title">${escapeHtml(section.grammarTipTitle)}</div>` : ''}
      ${(section.grammarTipItems || []).map((item: string) => `<div class="grammar-tip-item">${escapeHtml(item)}</div>`).join('')}
    </div>`;
  }
  if (section.challengeQuestions && section.challengeQuestions.length > 0) {
    contentHtml += `<div class="questions-list">
      ${section.challengeQuestions.map((q: any, idx: number) => `
        <div class="question-item">
          <div class="question-text">${idx + 1}. ${escapeHtml(q.question || q.text || '')}</div>
        </div>
      `).join('')}
    </div>`;
  }

  // Topic boxes (Challenge 2)
  if (section.topicBoxes && section.topicBoxes.length > 0) {
    contentHtml += `<div class="topic-boxes">
      ${section.topicBoxes.map((box: any) => `
        <div class="topic-box">
          <div class="topic-title">${escapeHtml(box.topicTitle || box.title || '')}</div>
          ${(box.questions || box.items || []).map((item: any) => {
            if (typeof item === 'string') return `<div class="topic-item">• ${escapeHtml(item)}</div>`;
            const q = item?.question || item?.text || '';
            const subs = Array.isArray(item?.subQuestions) ? item.subQuestions : [];
            return `<div class="topic-item">• ${escapeHtml(q)}${subs.length ? `<div style="margin-left:14px;opacity:0.8;">${subs.map((s: string) => `- ${escapeHtml(s)}`).join('<br/>')}</div>` : ''}</div>`;
          }).join('')}
        </div>
      `).join('')}
    </div>`;
  }

  // Listening section
  if (section.listeningScript && section.listeningScript.length > 0) {
    const scriptText = section.listeningScript.map((word: any) => {
      if (typeof word === 'string') return escapeHtml(word);
      const rawWord = word?.word || word?.text || '';
      const isUnderlined = Boolean(word?.isUnderlined || word?.underline || word?.isUnderline);
      return isUnderlined ? `<span class="underlined">${escapeHtml(rawWord)}</span>` : escapeHtml(rawWord);
    }).join(' ');
    contentHtml += `<div class="script-box">${scriptText}</div>`;
  }
  if (section.listeningQuestions && section.listeningQuestions.length > 0) {
    contentHtml += `<div class="questions-list">
      ${section.listeningQuestions.map((q: any, idx: number) => `
        <div class="question-item">
          <div class="question-text">${idx + 1}. ${escapeHtml(q.question || q.questionEn || '')}</div>
          ${q.answer ? `<div class="question-answer">Answer: ${escapeHtml(q.answer)}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  // Reading section
  if (section.readingImage) {
    contentHtml += `<img src="${escapeHtml(section.readingImage)}" alt="Reading scene" class="section-image" />`;
  }
  if (section.readingDialogueLines && section.readingDialogueLines.length > 0) {
    contentHtml += `<div class="reading-dialogue">
      ${section.readingDialogueLines.map((line: any) => `
        <div class="reading-line">
          <span class="reading-speaker">${escapeHtml(line.speaker || '')}</span>
          <span class="reading-text">${escapeHtml(line.lineEn || line.text || '')}</span>
        </div>
      `).join('')}
    </div>`;
  }
  if (section.readingQuestions && section.readingQuestions.length > 0) {
    contentHtml += `<div class="questions-list">
      ${section.readingQuestions.map((q: any, idx: number) => `
        <div class="question-item">
          <div class="question-text">${idx + 1}. ${escapeHtml(q.questionEn || q.question || '')}</div>
          ${q.answer ? `<div class="question-answer">Answer: ${escapeHtml(q.answer)}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  // Roleplay section
  if (section.roleplaySetupLines && section.roleplaySetupLines.length > 0) {
    contentHtml += `<div style="margin-bottom:16px;">
      ${section.roleplaySetupLines.map((line: string) => `<p style="margin-bottom:8px;">${escapeHtml(line)}</p>`).join('')}
    </div>`;
  }
  if (section.roleplayScript) {
    contentHtml += `<div class="script-box">${escapeHtml(section.roleplayScript)}</div>`;
  }
  if (section.roleplayConversation && section.roleplayConversation.length > 0) {
    contentHtml += `<div class="conversation-container">
      ${section.roleplayConversation.map((line: any) => `
        <div class="conversation-line">
          <span class="conversation-role">${escapeHtml(line.number ? `${line.number}` : (line.role || ''))}</span>
          <span class="conversation-text">${escapeHtml(line.text || '')}${line.comment ? ` <span style="opacity:0.75;"><i>${escapeHtml(line.comment)}</i></span>` : ''}</span>
        </div>
      `).join('')}
    </div>`;
  }

  return `
    <div class="section-card">
      <div class="section-header">
        <div class="section-number">${sectionNumber}</div>
        <div class="section-title">${escapeHtml(sectionTitle)}</div>
      </div>
      <div class="section-content">
        ${contentHtml || '<p>Section content</p>'}
      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateSlug(title: string): string {
  return (title || 'lesson')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'lesson';
}

// Auth is now imported from ../utils/refreshCookie
// getAuthFromCookie(cookie) - accepts Elysia cookie object and returns { sub, userId, role } or null

// Get display name from auth payload
function getDisplayName(auth: JwtAuthPayload): string | undefined {
  return auth.firstName || auth.givenName || auth.email?.split('@')[0];
}

/**
 * Process all uploaded images from form data and replace placeholders in lesson data
 * Placeholders look like: "__UPLOAD__:keyName"
 * Images are uploaded to SeaweedFS and URLs are inserted back into the data
 */
async function processUploadedImages(
  form: any, 
  lessonData: any, 
  basePath: string
): Promise<{ lessonData: any; uploadedCount: number }> {
  let uploadedCount = 0;
  
  // Log all form keys for debugging
  const formKeys: string[] = [];
  for (const [key] of form.entries()) {
    formKeys.push(key);
  }
  
  // Recursively process an object/array to find and replace upload placeholders
  const processValue = async (obj: any, key: string, parentPath: string): Promise<void> => {
    const value = obj[key];
    
    if (typeof value === 'string' && value.startsWith('__UPLOAD__:')) {
      const imageKey = value.replace('__UPLOAD__:', '');
      const file = form.get(imageKey);
      
      if (file instanceof File && file.size > 0) {
        // Validate it's an image
        if (!file.type.startsWith('image/')) {
          console.warn(`Skipping non-image file: ${imageKey}`);
          obj[key] = '';
          return;
        }
        
        // Limit file size (10MB)
        if (file.size > 10 * 1024 * 1024) {
          console.warn(`Skipping oversized image: ${imageKey}`);
          obj[key] = '';
          return;
        }
        
        // Upload to SeaweedFS
        const ext = file.name?.split('.').pop() || 'jpg';
        const imagePath = `${basePath}/images/${imageKey}.${ext}`;
        
        try {
          const url = await uploadToSeaweed(imagePath, file, file.type);
          obj[key] = url;
          uploadedCount++;
        } catch (err) {
          console.error(`Failed to upload image ${imageKey}:`, err);
          obj[key] = '';
        }
      } else {
        // No file found for placeholder - log warning but clear placeholder
        console.warn(`⚠️ No file found in FormData for placeholder: ${imageKey}`);
        console.warn(`   Available keys: ${formKeys.join(', ')}`);
        obj[key] = ''; // Clear placeholder so it doesn't persist
      }
    } else if (Array.isArray(value)) {
      // Process array items
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === 'object' && value[i] !== null) {
          await processObject(value[i], `${parentPath}[${i}]`);
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Process nested object
      await processObject(value, `${parentPath}.${key}`);
    }
  };
  
  const processObject = async (obj: any, path: string): Promise<void> => {
    for (const key of Object.keys(obj)) {
      await processValue(obj, key, path);
    }
  };
  
  // Process the entire lesson data
  await processObject(lessonData, 'root');
  
  return { lessonData, uploadedCount };
}

export default new Elysia({ prefix: '/lesson' })
  /**
   * Create a new lesson (with database tracking)
   * Expects multipart form data with:
   * - lessonData: JSON string of LessonMaterial
   * - headerImage: (optional) image file for header background
   */
  .post('/create', async ({ request, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const form = await request.formData();
      
      // Get lesson data
      const lessonDataStr = form.get('lessonData');
      if (!lessonDataStr || typeof lessonDataStr !== 'string') {
        return { success: false, error: 'Missing lesson data' };
      }
      
      let lessonData: LessonMaterial;
      try {
        lessonData = JSON.parse(lessonDataStr);
      } catch {
        return { success: false, error: 'Invalid lesson data JSON' };
      }

      // Create lesson in database (initial save without images)
      const { lesson, version } = await lessonService.createLesson(
        lessonData,
        auth.userId,
        getDisplayName(auth)
      );

      const basePath = lesson.storagePath;

      // Process ALL uploaded images (header, section images, vocab images, etc.)
      // This replaces __UPLOAD__:key placeholders with actual URLs
      const { lessonData: processedData, uploadedCount } = await processUploadedImages(
        form,
        lessonData,
        basePath
      );
      lessonData = processedData;
      
      if (uploadedCount > 0) {
        // Update the version in database with the final lessonData (including image URLs)
        await lessonService.updateVersionData(lesson.id, version.versionNumber, lessonData);
      }

      // Generate and upload HTML
      const headerImageUrl = lessonData.header?.backgroundImage || undefined;
      const html = generateLessonHtml(lessonData, headerImageUrl);
      const htmlPath = `${basePath}/index.html`;
      const lessonUrl = await uploadToSeaweed(htmlPath, html, 'text/html');
      const lessonUrlWithVersion = `${lessonUrl}?v=${version.versionNumber}`;

      // Save tutor JSON data (full version with hints) - now includes all image URLs
      const tutorJsonPath = `${basePath}/tutor-data.json`;
      await uploadToSeaweed(tutorJsonPath, JSON.stringify(lessonData, null, 2), 'application/json');
      
      // Also save as data.json for backwards compatibility
      const jsonPath = `${basePath}/data.json`;
      await uploadToSeaweed(jsonPath, JSON.stringify(lessonData, null, 2), 'application/json');

      // Generate and save student version (stripped of tutor hints)
      const studentData = generateStudentMaterial(lessonData as any);
      const studentJsonPath = `${basePath}/student-data.json`;
      await uploadToSeaweed(studentJsonPath, JSON.stringify(studentData, null, 2), 'application/json');
      
      const sizeReduction = getMaterialSizeReduction(lessonData, studentData);

      // Return the version with the PROCESSED lessonData (image URLs, not placeholders)
      const processedVersion = {
        ...version,
        lessonData: lessonData // Use the processed data with actual URLs
      };

      return {
        success: true,
        lesson,
        version: processedVersion,
        url: lessonUrlWithVersion,
        headerImageUrl,
        studentDataUrl: `${API_BASE}/lesson/files${studentJsonPath}`,
        tutorDataUrl: `${API_BASE}/lesson/files${tutorJsonPath}`,
        message: 'Lesson created successfully'
      };
    } catch (error) {
      console.error('Error creating lesson:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to create lesson' 
      };
    }
  })

  /**
   * Update a lesson (creates new version)
   */
  .put('/update/:lessonId', async ({ request, params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const { lessonId } = params;
      const form = await request.formData();
      
      const lessonDataStr = form.get('lessonData');
      if (!lessonDataStr || typeof lessonDataStr !== 'string') {
        return { success: false, error: 'Missing lesson data' };
      }
      
      let lessonData: LessonMaterial;
      try {
        lessonData = JSON.parse(lessonDataStr);
      } catch {
        return { success: false, error: 'Invalid lesson data JSON' };
      }

      const changeSummary = form.get('changeSummary')?.toString() || undefined;

      // Update lesson in database (creates new version)
      const { lesson, version } = await lessonService.updateLesson(
        lessonId,
        lessonData,
        auth.userId,
        getDisplayName(auth),
        changeSummary
      );

      const basePath = lesson.storagePath;

      // Process ALL uploaded images (header, section images, vocab images, etc.)
      // This replaces __UPLOAD__:key placeholders with actual URLs
      const { lessonData: processedData, uploadedCount } = await processUploadedImages(
        form,
        lessonData,
        basePath
      );
      lessonData = processedData;
      
      if (uploadedCount > 0) {
      }
      
      // Always update the version in database with the final lessonData
      await lessonService.updateVersionData(lesson.id, version.versionNumber, lessonData);

      // Update HTML file
      const headerImageUrl = lessonData.header?.backgroundImage || undefined;
      const html = generateLessonHtml(lessonData, headerImageUrl);
      const htmlPath = `${basePath}/index.html`;
      const lessonUrl = await uploadToSeaweed(htmlPath, html, 'text/html');
      const lessonUrlWithVersion = `${lessonUrl}?v=${version.versionNumber}`;

      // Save tutor JSON data (full version with hints) - includes all image URLs
      const tutorJsonPath = `${basePath}/tutor-data.json`;
      await uploadToSeaweed(tutorJsonPath, JSON.stringify(lessonData, null, 2), 'application/json');
      
      // Also save as data.json for backwards compatibility
      const jsonPath = `${basePath}/data.json`;
      await uploadToSeaweed(jsonPath, JSON.stringify(lessonData, null, 2), 'application/json');

      // Generate and save student version (stripped of tutor hints)
      const studentData = generateStudentMaterial(lessonData as any);
      const studentJsonPath = `${basePath}/student-data.json`;
      await uploadToSeaweed(studentJsonPath, JSON.stringify(studentData, null, 2), 'application/json');

      // Return the version with the PROCESSED lessonData (image URLs, not placeholders)
      const processedVersion = {
        ...version,
        lessonData: lessonData // Use the processed data with actual URLs
      };

      return {
        success: true,
        lesson,
        version: processedVersion,
        url: lessonUrlWithVersion,
        message: 'Lesson updated successfully'
      };
    } catch (error) {
      console.error('Error updating lesson:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to update lesson' 
      };
    }
  })

  /**
   * Fork a lesson (admin forks a draft to work on their own version)
   */
  .post('/fork/:lessonId', async ({ request, params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const { lessonId } = params;

      // Fork the lesson
      const { lesson, version } = await lessonService.forkLesson(
        lessonId,
        auth.userId,
        getDisplayName(auth)
      );

      // Get the original lesson's data to copy to new storage
      const originalJsonUrl = `${FILER_BASE}/lessons/${lessonId}/data.json`;
      const originalRes = await fetch(originalJsonUrl);
      
      if (originalRes.ok) {
        const originalData = await originalRes.json() as LessonMaterial;
        
        // Create storage for the fork
        const basePath = lesson.storagePath;
        
        // Generate and upload HTML for the fork
        const html = generateLessonHtml(originalData);
        const htmlPath = `${basePath}/index.html`;
        await uploadToSeaweed(htmlPath, html, 'text/html');

        // Save JSON data for the fork
        const jsonPath = `${basePath}/data.json`;
        await uploadToSeaweed(jsonPath, JSON.stringify(originalData, null, 2), 'application/json');
      }

      return {
        success: true,
        lesson,
        version,
        message: `Forked lesson successfully. You can now edit your fork.`
      };
    } catch (error) {
      console.error('Error forking lesson:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fork lesson' 
      };
    }
  })

  /**
   * Get forks of a lesson
   */
  .get('/forks/:lessonId', async ({ params }) => {
    try {
      const { lessonId } = params;
      const forks = await lessonService.getLessonForks(lessonId);
      
      return { success: true, forks };
    } catch (error) {
      console.error('Error fetching forks:', error);
      return { success: false, error: 'Failed to fetch forks' };
    }
  })

  /**
   * Create a merge request (fork author submits to original)
   */
  .post('/merge-request', async ({ request, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const body = await request.json() as {
        sourceLessonId: string;
        title: string;
        description?: string;
      };

      const mergeRequest = await lessonService.createMergeRequest(
        body.sourceLessonId,
        body.title,
        body.description || null,
        auth.userId,
        getDisplayName(auth)
      );

      return {
        success: true,
        mergeRequest,
        message: 'Merge request created successfully'
      };
    } catch (error) {
      console.error('Error creating merge request:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to create merge request' 
      };
    }
  })

  /**
   * Get merge requests for a lesson (original author views incoming requests)
   */
  .get('/merge-requests/:lessonId', async ({ params, query }) => {
    try {
      const { lessonId } = params;
      const status = query.status as string | undefined;
      
      const mergeRequests = await lessonService.getMergeRequestsForLesson(lessonId, status);
      
      return { success: true, mergeRequests };
    } catch (error) {
      console.error('Error fetching merge requests:', error);
      return { success: false, error: 'Failed to fetch merge requests' };
    }
  })

  /**
   * Get a specific merge request with details
   */
  .get('/merge-request/:mrId', async ({ params }) => {
    try {
      const { mrId } = params;
      const mergeRequest = await lessonService.getMergeRequestById(mrId);
      
      if (!mergeRequest) {
        return { success: false, error: 'Merge request not found' };
      }
      
      return { success: true, mergeRequest };
    } catch (error) {
      console.error('Error fetching merge request:', error);
      return { success: false, error: 'Failed to fetch merge request' };
    }
  })

  /**
   * Review a merge request (approve, reject, or merge)
   */
  .post('/merge-request/:mrId/review', async ({ request, params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const { mrId } = params;
      const body = await request.json() as {
        action: 'approve' | 'reject' | 'merge';
        comment?: string;
      };

      if (!['approve', 'reject', 'merge'].includes(body.action)) {
        return { success: false, error: 'Invalid action. Must be approve, reject, or merge' };
      }

      const mergeRequest = await lessonService.reviewMergeRequest(
        mrId,
        body.action,
        auth.userId,
        getDisplayName(auth),
        body.comment
      );

      // If merged, update the target lesson's storage files
      if (body.action === 'merge' && mergeRequest.sourceLesson && mergeRequest.targetLesson) {
        const sourceVersion = await lessonService.getVersion(
          mergeRequest.sourceLessonId, 
          mergeRequest.sourceVersion
        );
        
        if (sourceVersion) {
          const basePath = mergeRequest.targetLesson.storagePath;
          
          // Update HTML
          const html = generateLessonHtml(sourceVersion.lessonData);
          await uploadToSeaweed(`${basePath}/index.html`, html, 'text/html');
          
          // Update JSON
          await uploadToSeaweed(
            `${basePath}/data.json`, 
            JSON.stringify(sourceVersion.lessonData, null, 2), 
            'application/json'
          );
        }
      }

      return {
        success: true,
        mergeRequest,
        message: `Merge request ${body.action}${body.action === 'merge' ? 'd' : 'ed'} successfully`
      };
    } catch (error) {
      console.error('Error reviewing merge request:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to review merge request' 
      };
    }
  })

  /**
   * Publish a lesson
   */
  .post('/publish/:lessonId', async ({ request, params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const { lessonId } = params;
      const lesson = await lessonService.publishLesson(lessonId, auth.userId);

      return {
        success: true,
        lesson,
        message: 'Lesson published successfully'
      };
    } catch (error) {
      console.error('Error publishing lesson:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to publish lesson' 
      };
    }
  })

  /**
   * Get version history for a lesson
   */
  .get('/versions/:lessonId', async ({ params }) => {
    try {
      const { lessonId } = params;
      const versions = await lessonService.getVersionHistory(lessonId);
      
      return { success: true, versions };
    } catch (error) {
      console.error('Error fetching versions:', error);
      return { success: false, error: 'Failed to fetch version history' };
    }
  })

  /**
   * Get a specific version
   */
  .get('/version/:lessonId/:versionNumber', async ({ params }) => {
    try {
      const { lessonId, versionNumber } = params;
      const version = await lessonService.getVersion(lessonId, parseInt(versionNumber, 10));
      
      if (!version) {
        return { success: false, error: 'Version not found' };
      }
      
      return { success: true, version };
    } catch (error) {
      console.error('Error fetching version:', error);
      return { success: false, error: 'Failed to fetch version' };
    }
  })

  /**
   * Legacy save endpoint (backwards compatible, creates new lesson)
   * Expects multipart form data with:
   * - lessonData: JSON string of LessonMaterial
   * - headerImage: (optional) image file for header background
   */
  .post('/save', async ({ request }) => {
    try {
      const form = await request.formData();
      
      // Get lesson data
      const lessonDataStr = form.get('lessonData');
      if (!lessonDataStr || typeof lessonDataStr !== 'string') {
        return { success: false, error: 'Missing lesson data' };
      }
      
      let lessonData: LessonMaterial;
      try {
        lessonData = JSON.parse(lessonDataStr);
      } catch {
        return { success: false, error: 'Invalid lesson data JSON' };
      }

      // Generate unique ID and slug
      const timestamp = Date.now();
      const slug = generateSlug(lessonData.header.lessonLabel);
      const lessonId = `${slug}-${timestamp}`;
      const basePath = `/lessons/${lessonId}`;

      // Handle header image upload if present
      let headerImageUrl: string | undefined;
      const headerImage = form.get('headerImage');
      
      if (headerImage instanceof File && headerImage.size > 0) {
        // Validate image
        if (!headerImage.type.startsWith('image/')) {
          return { success: false, error: 'Header image must be an image file' };
        }
        
        // Max 10MB for images
        if (headerImage.size > 10 * 1024 * 1024) {
          return { success: false, error: 'Header image too large. Max 10MB' };
        }

        const ext = headerImage.name?.split('.').pop() || 'jpg';
        const imagePath = `${basePath}/header.${ext}`;
        
        // Upload image to SeaweedFS
        headerImageUrl = await uploadToSeaweed(
          imagePath, 
          headerImage, 
          headerImage.type
        );
      }

      // Generate HTML with the uploaded image URL (if any)
      const html = generateLessonHtml(lessonData, headerImageUrl);
      
      // Upload HTML to SeaweedFS
      const htmlPath = `${basePath}/index.html`;
      const lessonUrl = await uploadToSeaweed(htmlPath, html, 'text/html');

      // Also save the JSON data for potential future editing
      const jsonPath = `${basePath}/data.json`;
      await uploadToSeaweed(jsonPath, JSON.stringify(lessonData, null, 2), 'application/json');

      return {
        success: true,
        lessonId,
        url: lessonUrl,
        headerImageUrl,
        message: 'Lesson saved successfully'
      };
    } catch (error) {
      console.error('Error saving lesson:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to save lesson' 
      };
    }
  })

  /**
   * Get student material for a lesson (stripped of tutor hints)
   * This endpoint is for student apps - returns material without tutor content
   */
  .get('/:lessonId/student', async ({ params }) => {
    try {
      const { lessonId } = params;
      const dashboardBase = getDashboardPublicUrl();
      
      // First try to get from database
      const dbLesson = await lessonService.getLessonById(lessonId);
      
      if (dbLesson) {
        // Try to get pre-generated student data from SeaweedFS
        const studentData = await fetchFromSeaweed(`${dbLesson.storagePath}/student-data.json`);
        
        // Construct the student view URL for the dashboard
        const studentDataUrl = `${API_BASE}/lesson/files${dbLesson.storagePath}/student-data.json`;
        const viewUrl = `${dashboardBase}/lesson-material-maker?src=${encodeURIComponent(studentDataUrl)}&studentView=1&preview=1`;
        
        if (studentData) {
          return {
            success: true,
            lesson: {
              id: dbLesson.id,
              title: dbLesson.title,
              status: dbLesson.status,
            },
            lessonData: studentData,
            materialType: 'student',
            viewUrl
          };
        }
        
        // Fallback: Generate student material on-the-fly from tutor data
        const latestVersion = await lessonService.getLatestVersion(lessonId);
        if (latestVersion?.lessonData) {
          const generatedStudentData = generateStudentMaterial(latestVersion.lessonData as any);
          return {
            success: true,
            lesson: {
              id: dbLesson.id,
              title: dbLesson.title,
              status: dbLesson.status,
            },
            lessonData: generatedStudentData,
            materialType: 'student',
            generatedOnFly: true,
            viewUrl
          };
        }
      }
      
      // Fallback to SeaweedFS only (for legacy lessons)
      const studentJsonUrl = `${FILER_BASE}/lessons/${lessonId}/student-data.json`;
      const res = await fetch(studentJsonUrl);
      
      // Legacy URL construction
      const legacyStudentDataUrl = `${API_BASE}/lesson/files/lessons/${lessonId}/student-data.json`;
      const legacyViewUrl = `${dashboardBase}/lesson-material-maker?src=${encodeURIComponent(legacyStudentDataUrl)}&studentView=1&preview=1`;
      
      if (res.ok) {
        const studentData = await res.json();
        return {
          success: true,
          lesson: null,
          lessonData: studentData,
          materialType: 'student',
          viewUrl: legacyViewUrl
        };
      }
      
      // Last fallback: Get tutor data and strip it
      const tutorJsonUrl = `${FILER_BASE}/lessons/${lessonId}/data.json`;
      const tutorRes = await fetch(tutorJsonUrl);
      
      if (tutorRes.ok) {
        const tutorData = await tutorRes.json() as any;
        const generatedStudentData = generateStudentMaterial(tutorData);
        return {
          success: true,
          lesson: null,
          lessonData: generatedStudentData,
          materialType: 'student',
          generatedOnFly: true,
          viewUrl: legacyViewUrl
        };
      }
      
      return { success: false, error: 'Lesson not found' };
    } catch (error) {
      console.error('Error fetching student material:', error);
      return { success: false, error: 'Failed to fetch student material' };
    }
  })

  /**
   * Get tutor material for a lesson (full version with hints)
   * This endpoint is for tutor/dashboard apps - returns full material
   */
  .get('/:lessonId/tutor', async ({ params, request, cookie }) => {
    try {
      const { lessonId } = params;
      const dashboardBase = getDashboardPublicUrl();
      
      // Verify auth - only tutors/admins should access tutor material
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized - tutor material requires authentication' };
      }
      
      // First try to get from database
      const dbLesson = await lessonService.getLessonById(lessonId);
      
      if (dbLesson) {
        // Construct the tutor view URL for the dashboard (no studentView param = tutor view)
        const tutorDataUrl = `${API_BASE}/lesson/files${dbLesson.storagePath}/tutor-data.json`;
        const viewUrl = `${dashboardBase}/lesson-material-maker?src=${encodeURIComponent(tutorDataUrl)}&preview=1`;
        
        // Try to get tutor data from SeaweedFS
        const tutorData = await fetchFromSeaweed(`${dbLesson.storagePath}/tutor-data.json`);
        
        if (tutorData) {
          return {
            success: true,
            lesson: dbLesson,
            lessonData: tutorData,
            materialType: 'tutor',
            viewUrl
          };
        }
        
        // Fallback to data.json (backwards compatibility)
        const legacyData = await fetchFromSeaweed(`${dbLesson.storagePath}/data.json`);
        if (legacyData) {
          return {
            success: true,
            lesson: dbLesson,
            lessonData: legacyData,
            materialType: 'tutor',
            viewUrl
          };
        }
        
        // Fallback to database version data
        const latestVersion = await lessonService.getLatestVersion(lessonId);
        if (latestVersion?.lessonData) {
          return {
            success: true,
            lesson: dbLesson,
            lessonData: latestVersion.lessonData,
            materialType: 'tutor',
            viewUrl
          };
        }
      }
      
      // Fallback to SeaweedFS only (for legacy lessons)
      const legacyTutorDataUrl = `${API_BASE}/lesson/files/lessons/${lessonId}/tutor-data.json`;
      const legacyViewUrl = `${dashboardBase}/lesson-material-maker?src=${encodeURIComponent(legacyTutorDataUrl)}&preview=1`;
      
      const tutorJsonUrl = `${FILER_BASE}/lessons/${lessonId}/tutor-data.json`;
      let res = await fetch(tutorJsonUrl);
      
      if (!res.ok) {
        // Try legacy data.json
        res = await fetch(`${FILER_BASE}/lessons/${lessonId}/data.json`);
      }
      
      if (!res.ok) {
        return { success: false, error: 'Lesson not found' };
      }
      
      const tutorData = await res.json();
      return {
        success: true,
        lesson: null,
        lessonData: tutorData,
        materialType: 'tutor',
        viewUrl: legacyViewUrl
      };
    } catch (error) {
      console.error('Error fetching tutor material:', error);
      return { success: false, error: 'Failed to fetch tutor material' };
    }
  })

  /**
   * Get lesson by ID (enhanced - with database info)
   */
  .get('/:lessonId', async ({ params }) => {
    try {
      const { lessonId } = params;
      
      // First try to get from database
      const dbLesson = await lessonService.getLessonById(lessonId);
      
      if (dbLesson) {
        // Get the latest version data
        const latestVersion = await lessonService.getLatestVersion(lessonId);
        // Return proxy URL, not internal SeaweedFS URL
        const htmlUrl = `${API_BASE}/lesson/files${dbLesson.storagePath}/index.html`;
        
        return {
          success: true,
          lesson: dbLesson,
          lessonData: latestVersion?.lessonData,
          url: htmlUrl
        };
      }
      
      // Fallback to SeaweedFS only (for legacy lessons)
      const jsonUrl = `${FILER_BASE}/lessons/${lessonId}/data.json`;
      
      const res = await fetch(jsonUrl);
      if (!res.ok) {
        return { success: false, error: 'Lesson not found' };
      }
      
      const lessonData = await res.json();
      // Return proxy URL for legacy lessons too
      const htmlUrl = `${API_BASE}/lesson/files/lessons/${lessonId}/index.html`;
      
      return {
        success: true,
        lesson: null, // No database record for legacy lessons
        lessonData,
        url: htmlUrl
      };
    } catch (error) {
      console.error('Error fetching lesson:', error);
      return { success: false, error: 'Failed to fetch lesson' };
    }
  })

  /**
   * List all lessons (enhanced - with database info and filters)
   */
  .get('/list', async ({ query }) => {
    try {
      const status = query.status as 'draft' | 'finished' | 'published' | 'archived' | undefined;
      const createdBy = query.createdBy as string | undefined;
      const includeForks = query.includeForks !== 'false';
      const limit = parseInt(query.limit as string, 10) || 50;
      const offset = parseInt(query.offset as string, 10) || 0;
      
      const { lessons, total } = await lessonService.getLessons({
        status,
        createdBy,
        includeForks,
        limit,
        offset
      });
      
      // Enrich with URLs (using API proxy, not internal SeaweedFS)
      const enrichedLessons = lessons.map(lesson => ({
        ...lesson,
        url: `${API_BASE}/lesson/files${lesson.storagePath}/index.html?v=${lesson.currentVersion || ''}`
      }));
      
      return { 
        success: true, 
        lessons: enrichedLessons,
        total,
        limit,
        offset 
      };
    } catch (error) {
      console.error('Error listing lessons:', error);
      return { success: true, lessons: [], total: 0 };
    }
  })

  /**
   * Get my lessons (lessons created by authenticated user)
   */
  .get('/my-lessons', async ({ request, query, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const status = query.status as 'draft' | 'finished' | 'published' | 'archived' | undefined;
      const includeForks = query.includeForks !== 'false';
      const limit = parseInt(query.limit as string, 10) || 50;
      const offset = parseInt(query.offset as string, 10) || 0;
      
      const { lessons, total } = await lessonService.getLessons({
        status,
        createdBy: auth.userId,
        includeForks,
        limit,
        offset
      });
      
      // Enrich with URLs (using API proxy, not internal SeaweedFS)
      const enrichedLessons = lessons.map(lesson => ({
        ...lesson,
        url: `${API_BASE}/lesson/files${lesson.storagePath}/index.html?v=${lesson.currentVersion || ''}`
      }));
      
      return { 
        success: true, 
        lessons: enrichedLessons,
        total,
        limit,
        offset 
      };
    } catch (error) {
      console.error('Error fetching my lessons:', error);
      return { success: false, error: 'Failed to fetch lessons' };
    }
  })

  /**
   * Get pending merge requests for my lessons
   */
  .get('/my-merge-requests', async ({ request, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      // Get all lessons created by user
      const { lessons } = await lessonService.getLessons({
        createdBy: auth.userId,
        includeForks: false
      });
      
      // Get pending merge requests for each lesson
      const allMergeRequests = [];
      for (const lesson of lessons) {
        const mrs = await lessonService.getMergeRequestsForLesson(lesson.id, 'pending');
        allMergeRequests.push(...mrs);
      }
      
      return { success: true, mergeRequests: allMergeRequests };
    } catch (error) {
      console.error('Error fetching merge requests:', error);
      return { success: false, error: 'Failed to fetch merge requests' };
    }
  })

  /**
   * Delete a lesson
   */
  .delete('/:lessonId', async ({ params }) => {
    try {
      const { lessonId } = params;
      const lessonPath = `/lessons/${lessonId}`;
      
      // Delete the entire lesson folder
      const deleteUrl = `${FILER_BASE}${lessonPath}?recursive=true`;
      const res = await fetch(deleteUrl, { method: 'DELETE' });
      
      if (!res.ok) {
        return { success: false, error: 'Failed to delete lesson' };
      }
      
      return { success: true, message: 'Lesson deleted' };
    } catch (error) {
      console.error('Error deleting lesson:', error);
      return { success: false, error: 'Failed to delete lesson' };
    }
  })
  
  // ============= IMPROVEMENT ENDPOINTS =============
  
  // Restore a specific version
  .post('/restore/:lessonId/:versionNumber', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { lessonId, versionNumber } = params;
      const result = await lessonService.restoreVersion(
        lessonId, 
        parseInt(versionNumber), 
        auth.sub
      );
      
      return result;
    } catch (error) {
      console.error('Error restoring version:', error);
      return { success: false, error: 'Failed to restore version' };
    }
  })
  
  /**
   * Get published lessons for a specific course (for student/tutor apps)
   * Returns lessons with their content
   */
  .get('/published/:courseSlug', async ({ params, query }) => {
    try {
      const { courseSlug } = params;
      const limit = parseInt(query.limit as string, 10) || 50;
      const offset = parseInt(query.offset as string, 10) || 0;
      
      // Get all published lessons
      const { lessons, total } = await lessonService.getLessons({
        status: 'published',
        includeForks: false,
        limit: 200, // Get more to filter by course
        offset: 0
      });
      
      
      // Map course slugs to match the materials page course IDs
      const courseSlugMap: Record<string, string[]> = {
        'conversational-skills': ['Conversational Skills', 'conversational-skills', 'Conversation', 'conversation'],
        'business-english': ['Business English', 'business-english', 'Business'],
        'job-interview-prep': ['Job Interview', 'job-interview-prep', 'Career'],
        'travel-english': ['Travel English', 'travel-english', 'Travel'],
        'academic-english': ['Academic English', 'academic-english', 'Academic'],
        'pronunciation': ['Pronunciation', 'pronunciation', 'Speaking'],
        'grammar-improvement': ['Grammar', 'grammar-improvement', 'grammar'],
        'vocabulary-building': ['Vocabulary', 'vocabulary-building']
      };
      
      const matchingCourseNames = courseSlugMap[courseSlug] || [courseSlug];
      
      // If courseSlug is 'all', return all published lessons without filtering
      if (courseSlug === 'all') {
        const allLessons = [];
        for (const lesson of lessons) {
          const latestVersion = await lessonService.getLatestVersion(lesson.id);
          if (!latestVersion) continue;
          allLessons.push({
            ...lesson,
            url: `${API_BASE}/lesson/files${lesson.storagePath}/index.html?v=${lesson.currentVersion || ''}`,
            lessonData: latestVersion.lessonData
          });
        }
        return { 
          success: true, 
          lessons: allLessons.slice(offset, offset + limit),
          total: allLessons.length,
          limit,
          offset 
        };
      }
      
      // Filter lessons that belong to the requested course
      // We need to check the lesson data for course info
      const filteredLessons = [];
      
      for (const lesson of lessons) {
        // Get latest version data to check course
        const latestVersion = await lessonService.getLatestVersion(lesson.id);
        if (!latestVersion) continue;
        
        const lessonData = latestVersion.lessonData;
        
        // Check if lesson belongs to this course (check various fields)
        const lessonCourse = (lessonData as any).course || 
                           (lessonData as any).category ||
                           (lessonData as any).templateCourse ||
                           '';
        
        // Also check header.chapterLabel for course indication
        const chapterLabel = lessonData.header?.chapterLabel || '';
        const lessonLabel = lessonData.header?.lessonLabel || '';
        
        
        const isMatch = matchingCourseNames.some(name => 
          lessonCourse.toLowerCase().includes(name.toLowerCase()) ||
          chapterLabel.toLowerCase().includes(name.toLowerCase()) ||
          lessonLabel.toLowerCase().includes(name.toLowerCase()) ||
          lesson.title.toLowerCase().includes(name.toLowerCase())
        );
        
        if (isMatch) {
          filteredLessons.push({
            ...lesson,
            url: `${API_BASE}/lesson/files${lesson.storagePath}/index.html?v=${lesson.currentVersion || ''}`,
            lessonData
          });
        }
      }
      
      
      // Apply pagination to filtered results
      const paginatedLessons = filteredLessons.slice(offset, offset + limit);
      
      return { 
        success: true, 
        lessons: paginatedLessons,
        total: filteredLessons.length,
        limit,
        offset 
      };
    } catch (error) {
      console.error('Error fetching published lessons for course:', error);
      return { success: true, lessons: [], total: 0 };
    }
  })

  // Unpublish a lesson (set back to draft)
  .post('/unpublish/:lessonId', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { lessonId } = params;
      const result = await lessonService.unpublishLesson(lessonId, auth.sub);
      
      return result;
    } catch (error) {
      console.error('Error unpublishing lesson:', error);
      return { success: false, error: 'Failed to unpublish lesson' };
    }
  })
  
  // Archive a lesson
  .post('/archive/:lessonId', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { lessonId } = params;
      const result = await lessonService.archiveLesson(lessonId, auth.sub);
      
      return result;
    } catch (error) {
      console.error('Error archiving lesson:', error);
      return { success: false, error: 'Failed to archive lesson' };
    }
  })

  // Mark a lesson as finished
  .post('/mark-finished/:lessonId', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { lessonId } = params;
      const result = await lessonService.markAsFinished(lessonId, auth.sub);
      
      return { success: true, lesson: result };
    } catch (error) {
      console.error('Error marking lesson as finished:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to mark lesson as finished' };
    }
  })

  // Mark a lesson back to draft
  .post('/mark-draft/:lessonId', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { lessonId } = params;
      const result = await lessonService.markAsDraft(lessonId, auth.sub);
      
      return { success: true, lesson: result };
    } catch (error) {
      console.error('Error marking lesson as draft:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to mark lesson as draft' };
    }
  })
  
  // Save lesson as template
  .post('/save-as-template/:lessonId', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { lessonId } = params;
      const result = await lessonService.saveAsTemplate(lessonId);
      
      return result;
    } catch (error) {
      console.error('Error saving as template:', error);
      return { success: false, error: 'Failed to save as template' };
    }
  })
  
  // Get merge request comments
  .get('/merge-request/:mrId/comments', async ({ params }) => {
    try {
      const { mrId } = params;
      const result = await lessonService.getMergeRequestComments(mrId);
      
      return result;
    } catch (error) {
      console.error('Error fetching comments:', error);
      return { success: false, error: 'Failed to fetch comments' };
    }
  })
  
  // Add comment to merge request
  .post('/merge-request/:mrId/comments', async ({ params, body, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { mrId } = params;
      const { content } = body as { content: string };
      
      if (!content || !content.trim()) {
        return { success: false, error: 'Comment content is required' };
      }
      
      // Get author name from token or use username
      const authorName = auth.name || auth.sub;
      
      const result = await lessonService.addMergeRequestComment(
        mrId,
        auth.sub,
        authorName,
        content.trim()
      );
      
      return result;
    } catch (error) {
      console.error('Error adding comment:', error);
      return { success: false, error: 'Failed to add comment' };
    }
  })
  
  // Update merge request status
  .patch('/merge-request/:mrId/status', async ({ params, body, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { mrId } = params;
      const { status } = body as { status: 'pending' | 'approved' | 'rejected' | 'merged' };
      
      if (!status || !['pending', 'approved', 'rejected', 'merged'].includes(status)) {
        return { success: false, error: 'Invalid status' };
      }
      
      const result = await lessonService.updateMergeRequestStatus(mrId, status, auth.sub);
      
      return result;
    } catch (error) {
      console.error('Error updating merge request status:', error);
      return { success: false, error: 'Failed to update status' };
    }
  })
  
  // Get forks of a lesson
  .get('/forks/:lessonId', async ({ params }) => {
    try {
      const { lessonId } = params;
      const result = await lessonService.getLessonForks(lessonId);
      
      return result;
    } catch (error) {
      console.error('Error fetching forks:', error);
      return { success: false, error: 'Failed to fetch forks' };
    }
  })
  
  // Search lessons with filters
  .get('/search', async ({ query }) => {
    try {
      const {
        q,
        status,
        authorId,
        language,
        level,
        isTemplate,
        isFork,
        sortBy,
        sortOrder,
        limit,
        offset
      } = query as {
        q?: string;
        status?: string;
        authorId?: string;
        language?: string;
        level?: string;
        isTemplate?: string;
        isFork?: string;
        sortBy?: string;
        sortOrder?: string;
        limit?: string;
        offset?: string;
      };
      
      const result = await lessonService.searchLessons({
        query: q,
        status: status as 'draft' | 'finished' | 'published' | 'archived' | undefined,
        createdBy: authorId,
        sortBy: (sortBy as 'created' | 'updated' | 'title') || 'updated',
        sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
        limit: limit ? parseInt(limit) : 20,
        offset: offset ? parseInt(offset) : 0
      });
      
      return result;
    } catch (error) {
      console.error('Error searching lessons:', error);
      return { success: false, error: 'Failed to search lessons' };
    }
  })
  
  // Bulk actions
  .post('/bulk-action', async ({ body, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { action, lessonIds } = body as { 
        action: 'publish' | 'unpublish' | 'archive' | 'delete';
        lessonIds: string[];
      };
      
      if (!action || !lessonIds || !Array.isArray(lessonIds) || lessonIds.length === 0) {
        return { success: false, error: 'Invalid request: action and lessonIds required' };
      }
      
      const results: { lessonId: string; success: boolean; error?: string }[] = [];
      
      for (const lessonId of lessonIds) {
        try {
          switch (action) {
            case 'publish':
              await lessonService.publishLesson(lessonId, auth.sub);
              break;
            case 'unpublish':
              await lessonService.unpublishLesson(lessonId, auth.sub);
              break;
            case 'archive':
              await lessonService.archiveLesson(lessonId, auth.sub);
              break;
            case 'delete':
              await lessonService.deleteLesson(lessonId, auth.sub);
              break;
            default:
              throw new Error('Unknown action');
          }
          results.push({ lessonId, success: true });
        } catch (err) {
          results.push({ lessonId, success: false, error: err instanceof Error ? err.message : 'Operation failed' });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      
      return {
        success: true,
        message: `Completed ${successCount}/${lessonIds.length} operations`,
        results
      };
    } catch (error) {
      console.error('Error performing bulk action:', error);
      return { success: false, error: 'Failed to perform bulk action' };
    }
  })
  
  /**
   * Proxy endpoint to serve lesson files and public profile media from SeaweedFS
   * This keeps SeaweedFS internal and secure
   * Path: /lesson/files/lessons/{lessonId}/{filename}
   */
  .get('/files/*', async ({ params, set, request }) => {
    // Do not let the CDN cache missing files or transient storage failures.
    set.headers['cache-control'] = 'no-store';
    try {
      let filePath: string | null;
      try { filePath = publicFilePath(params['*'] || ''); } catch { set.status = 400; return { error: 'Invalid file path' }; }
      if (!filePath) {
        set.status = 404;
        return { error: 'File not found' };
      }

      // Pixel-perfect view: serve index.html by redirecting into the dashboard renderer.
      // This avoids relying on the stored standalone HTML (which will never match the app preview).
      if (filePath.endsWith('/index.html')) {
        const dashboardBase = getDashboardPublicUrl();
        const reqUrl = new URL(request.url);
        const tutorDataUrl = new URL(reqUrl.toString());
        tutorDataUrl.pathname = `/lesson/files${filePath.replace(/\/index\.html$/, '/tutor-data.json')}`;

        const viewer = new URL(dashboardBase);
        viewer.pathname = (viewer.pathname || '/').replace(/\/$/, '') + '/lesson-material-maker';
        viewer.searchParams.set('src', tutorDataUrl.toString());
        viewer.searchParams.set('preview', '1');
        if (reqUrl.searchParams.get('print') === '1') {
          viewer.searchParams.set('print', '1');
        }

        set.headers['content-type'] = 'text/html; charset=utf-8';
        set.headers['cache-control'] = 'no-store, max-age=0';
        set.headers['pragma'] = 'no-cache';
        set.headers['expires'] = '0';

        return new Response(
          `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Opening lesson…</title></head><body><p>Opening lesson…</p><script>location.replace(${JSON.stringify(
            viewer.toString()
          )});</script></body></html>`,
          {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store, max-age=0',
              Pragma: 'no-cache',
              Expires: '0'
            }
          }
        );
      }
      
      // Fetch from internal SeaweedFS
      const seaweedUrl = `${FILER_BASE}${filePath}`;
      const res = await fetch(seaweedUrl);
      
      if (!res.ok) {
        set.status = res.status;
        return { error: 'File not found' };
      }
      
      // Get content type from SeaweedFS response
      const contentType = res.headers.get('content-type') || 'application/octet-stream';

      const isHtml = filePath.endsWith('.html');
      const isJson = filePath.endsWith('.json');
      const cacheControl = (isHtml || isJson)
        ? 'no-store, max-age=0'
        : 'public, max-age=31536000';
      
      // Set appropriate headers
      set.headers['content-type'] = contentType;
      set.headers['cache-control'] = cacheControl;
      if (isHtml || isJson) {
        set.headers['pragma'] = 'no-cache';
        set.headers['expires'] = '0';
      }
      
      // Stream the response body
      return new Response(res.body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          ...(isHtml || isJson
            ? {
                Pragma: 'no-cache',
                Expires: '0'
              }
            : {})
        }
      });
    } catch (error) {
      console.error('Error proxying file:', error);
      set.status = 500;
      return { error: 'Failed to retrieve file' };
    }
  });
