import { appArtworkSrc } from '../appArtwork';
import { parseDispatchSource } from '../dispatchSources';
import { learningCategoryLabel } from '../learningTerminology';

export type DispatchTheme = 'light' | 'dark';
export type DispatchView = 'student' | 'tutor';
interface Vocabulary {
  word: string;
  pronunciation: string;
  partOfSpeech: string;
  definition: string;
  exampleSentence: string;
  additionalInfo?: string | null;
}
interface Discussion { topic: string; questions: string[] }
export interface DispatchArticle {
  id: string;
  title: string;
  createdAt: string;
  category: string;
  topic: string;
  warmUpQuestions: string[];
  vocabulary: Vocabulary[];
  articleContent: {
    source: string;
    paragraphs: { text: string; comprehensionQuestion?: { question: string; answer: string } | null }[];
  };
  summaryQuestion: string;
  discussionA: Discussion;
  discussionB: Discussion;
}
export interface DispatchRendererOptions {
  apiBase: string;
  articleId: string;
  view: DispatchView;
  allowViewSwitch?: boolean;
  theme: DispatchTheme;
  libraryURL: string;
  archiveURL: (month: string) => string;
}
const categories = ['Technology', 'Business', 'Science', 'Entertainment', 'Sports', 'Health & Wellness', 'Environment', 'Lifestyle', 'Education'];
const rendererVersion = 'dispatch-shared-v1';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function link(text: string, href: string, className = '') {
  const node = element('a', className, text);
  node.href = href;
  return node;
}
function button(text: string, className: string, action: () => void) {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function section(title: string, instruction?: string) {
  const node = element('section', 'ddp-section');
  const heading = element('div', 'ddp-section-header');
  heading.append(element('div', 'ddp-section-line'), element('h2', '', title), element('div', 'ddp-section-line'));
  node.append(heading);
  if (instruction) node.append(element('p', 'ddp-instruction', instruction));
  return node;
}
function list(items: string[], className: string) {
  const node = element('ul', className);
  items.filter(item => item.trim()).forEach(item => node.append(element('li', '', item)));
  return node;
}

// Framework-neutral DOM keeps the Solid apps and Preact dashboard on one template.
// All article text uses textContent; only validated citation URLs become anchors.
export function mountDispatchArticle(host: HTMLElement, options: DispatchRendererOptions) {
  let article: DispatchArticle | null = null;
  let archives: { month: string; count: number }[] = [];
  let view = options.view, theme = options.theme, fontSize = 'M', searchQuery = '';
  let root: HTMLElement, disposed = false, request: AbortController | undefined;
  const priorTitle = document.title;
  const framed = window.self !== window.top;
  let parentRoot: HTMLElement | undefined;
  try { if (framed) parentRoot = window.parent.document.documentElement; } catch { /* Cross-origin frames use the app theme. */ }
  const resolvedTheme = (): DispatchTheme => {
    const parent = parentRoot?.dataset.theme || parentRoot?.dataset.adminTheme;
    return parent === 'light' || parent === 'dark' ? parent : theme;
  };
  const applyTheme = () => {
    if (!root) return;
    root.dataset.theme = resolvedTheme();
    if (framed) {
      [document.documentElement, document.body].forEach(node => {
        node.classList.add('classroom-mode');
        node.dataset.dispatchTheme = resolvedTheme();
      });
    }
  };
  const observer = parentRoot ? new MutationObserver(applyTheme) : undefined;
  if (parentRoot) observer?.observe(parentRoot, { attributes: true, attributeFilter: ['data-theme', 'data-admin-theme'] });

  function show(node: HTMLElement) {
    root = node;
    root.dataset.dispatchRenderer = rendererVersion;
    host.replaceChildren(root);
    applyTheme();
  }

  function render() {
    if (!article || disposed) return;
    const tutor = view === 'tutor';
    const container = element('div', `ddp-container ${tutor ? '' : 'dds-container '}ddp-font-${fontSize.toLowerCase()}`);
    container.dataset.view = view;
    const nav = element('nav', 'ddp-header-bar no-print');
    const navInner = element('div', 'ddp-header-bar-inner');
    const brand = link('', options.libraryURL, 'ddp-toolbar-brand');
    const logo = element('img', 'ddp-logo');
    logo.src = appArtworkSrc('dispatch'); logo.alt = 'Daily Dispatch'; logo.width = logo.height = 26;
    brand.append(logo, element('span', '', 'Daily Dispatch'));
    const navCategories = element('div', 'ddp-categories-list');
    categories.forEach(category => navCategories.append(element('span', `ddp-category-item ${article!.category === category ? 'active' : ''}`, learningCategoryLabel(category))));
    navInner.append(brand, navCategories);
    if (options.allowViewSwitch) navInner.append(button(`Switch to ${tutor ? 'Student' : 'Tutor'} View`, 'ddp-view-toggle', () => {
      view = tutor ? 'student' : 'tutor'; render();
    }));
    nav.append(navInner);
    const layout = element('div', 'ddp-layout');
    const content = element('div', 'ddp-content');
    const header = element('header', 'ddp-header');
    const date = new Date(article.createdAt);
    const formattedDate = Number.isNaN(date.getTime()) ? 'Date not set' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const meta = element('div', 'ddp-meta');
    meta.append(element('span', 'ddp-date', formattedDate), element('span', 'ddp-divider', '|'), element('span', 'ddp-topic', article.topic || 'Topic not set'), element('span', 'ddp-divider', '|'), element('span', 'ddp-category', learningCategoryLabel(article.category || 'Uncategorized')));
    header.append(element('div', `ddp-view-badge ${view}`, tutor ? 'TUTOR VIEW' : 'STUDENT VIEW'), element('h1', 'ddp-title', article.title || 'Untitled Article'), meta);
    content.append(header);

    const warmup = section(tutor ? 'CONVERSATION STARTERS' : 'WARM-UP QUESTIONS', tutor ? 'Ask the student these warm-up questions to introduce the topic:' : undefined);
    warmup.append(list(article.warmUpQuestions, 'ddp-list ddp-indent'));
    content.append(warmup);
    const vocabulary = section('KEY VOCABULARY', tutor ? 'Have the student read each word aloud, explain its meaning, and practice using it in a sentence:' : undefined);
    const grid = element('div', 'ddp-vocabulary');
    article.vocabulary.filter(word => word.word.trim()).forEach(word => {
      const item = element('div', 'ddp-vocab-item'), heading = element('div', 'ddp-vocab-header'), body = element('div', 'ddp-vocab-body');
      heading.append(element('span', 'ddp-vocab-word', word.word));
      if (word.pronunciation) heading.append(element('span', 'ddp-vocab-pronunciation', word.pronunciation));
      if (word.partOfSpeech) heading.append(element('span', 'ddp-vocab-pos', `(${word.partOfSpeech})`));
      for (const [label, value] of [['Meaning:', word.definition], [tutor ? 'Usage:' : 'Example:', word.exampleSentence], ['Note:', word.additionalInfo]] as const) {
        if (!value) continue;
        const paragraph = element('p'); paragraph.append(element('strong', '', label), document.createTextNode(' ' + value)); body.append(paragraph);
      }
      item.append(heading, body); grid.append(item);
    });
    if (!grid.childElementCount) grid.append(element('p', 'ddp-empty', 'No vocabulary words added'));
    vocabulary.append(grid); content.append(vocabulary);

    const reading = section('READING PASSAGE', tutor ? 'Have the student read the article aloud. Pause after each comprehension question to discuss:' : undefined);
    const passage = element('article', 'ddp-article');
    article.articleContent.paragraphs.filter(paragraph => paragraph.text.trim()).forEach(paragraph => {
      const block = element('div', 'ddp-paragraph'); block.append(element('p', '', paragraph.text));
      const question = paragraph.comprehensionQuestion;
      if (question?.question) {
        const qa = element('div', tutor ? 'ddp-qa' : 'ddp-qa dds-question-only');
        const prompt = element('p', 'ddp-question');
        prompt.append(element('span', 'ddp-qa-label', 'Q'), document.createTextNode(' ' + question.question));
        qa.append(prompt);
        if (tutor && question.answer) {
          const answer = element('p', 'ddp-answer'); answer.append(element('span', 'ddp-qa-label', 'A'), document.createTextNode(' ' + question.answer)); qa.append(answer);
        }
        block.append(qa);
      }
      passage.append(block);
    });
    if (!passage.childElementCount) passage.append(element('p', 'ddp-empty', 'No article content added'));
    reading.append(passage);
    const sources = parseDispatchSource(article.articleContent.source);
    if (sources.description || sources.links.length) {
      const credits = element('div', 'ddp-source dispatch-sources');
      credits.setAttribute('role', 'note'); credits.setAttribute('aria-label', 'Article sources');
      credits.append(element('span', 'dispatch-sources-label', 'Sources'));
      if (sources.description) credits.append(element('p', '', sources.description));
      if (sources.links.length) {
        const references = element('ul');
        sources.links.forEach(source => {
          const item = element('li'), anchor = link(source.label, source.href);
          anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; item.append(anchor); references.append(item);
        });
        credits.append(references);
      }
      reading.append(credits);
    }
    content.append(reading);
    if (article.summaryQuestion) {
      const summary = section(tutor ? 'COMPREHENSION CHECK' : 'SUMMARY QUESTION', tutor ? 'Ask the student to summarize the article by answering this question:' : undefined);
      const box = element('div', 'ddp-comprehension'); box.append(element('p', 'ddp-summary-question', article.summaryQuestion)); summary.append(box); content.append(summary);
    }
    const discussion = section('DISCUSSION TOPICS', tutor ? 'Guide the student through these discussion questions to practice expressing opinions:' : undefined);
    [article.discussionA, article.discussionB].forEach((topic, index) => {
      if (!topic?.topic) return;
      const block = element('div', 'ddp-discussion'), heading = element('h3');
      heading.append(element('span', 'ddp-discussion-badge', index === 0 ? 'A' : 'B'), document.createTextNode(topic.topic));
      block.append(heading, list(topic.questions, 'ddp-discussion-list')); discussion.append(block);
    });
    content.append(discussion);
    const footer = element('footer', 'ddp-footer'); footer.append(element('p', '', 'FluentXVerse Daily Dispatch')); content.append(footer);

    const sidebar = element('aside', 'ddp-sidebar no-print'); sidebar.setAttribute('aria-label', 'Article tools');
    const search = element('div', 'ddp-sidebar-section'), searchHeading = element('h3', 'ddp-sidebar-title');
    searchHeading.append(element('span', '', 'Search'), element('span', 'ddp-sidebar-subtitle', 'Search by title'));
    const form = element('form', 'ddp-sidebar-search'); form.setAttribute('role', 'search');
    const input = element('input'); input.type = 'search'; input.placeholder = 'search'; input.value = searchQuery; input.setAttribute('aria-label', 'Search article titles');
    input.addEventListener('input', () => { searchQuery = input.value; });
    const submit = element('button', 'ddp-sidebar-search-btn', 'Search'); submit.type = 'submit';
    form.addEventListener('submit', event => {
      event.preventDefault();
      const target = new URL(options.libraryURL, window.location.href);
      if (searchQuery.trim()) target.searchParams.set('search', searchQuery.trim());
      window.location.assign(target.href);
    });
    form.append(input, submit); search.append(searchHeading, form);
    const font = element('div', 'ddp-sidebar-section'), fontHeading = element('h3', 'ddp-sidebar-title');
    fontHeading.append(element('span', '', 'Font'), element('span', 'ddp-sidebar-subtitle', 'size'));
    const sizes = element('div', 'ddp-font-size-btns');
    ['S', 'M', 'L'].forEach(size => {
      const control = button(size, `ddp-font-size-btn ${fontSize === size ? 'active' : ''}`, () => {
        fontSize = size;
        container.classList.remove('ddp-font-s', 'ddp-font-m', 'ddp-font-l'); container.classList.add('ddp-font-' + size.toLowerCase());
        Array.from(sizes.children).forEach(node => { node.classList.toggle('active', node.textContent === size); node.setAttribute('aria-pressed', String(node.textContent === size)); });
      });
      control.setAttribute('aria-pressed', String(fontSize === size)); sizes.append(control);
    });
    font.append(fontHeading, sizes);
    const archive = element('div', 'ddp-sidebar-section'); archive.append(element('h3', 'ddp-sidebar-title', 'Archives'));
    if (archives.length) {
      const months = element('ul', 'ddp-archives-list');
      archives.forEach(month => {
        const item = element('li'); item.append(link(month.month, options.archiveURL(month.month)), element('span', 'ddp-archive-count', `(${month.count})`)); months.append(item);
      });
      archive.append(months);
    } else archive.append(element('p', 'ddp-sidebar-empty', 'No archives yet'));
    sidebar.append(search, font, archive); layout.append(content, sidebar); container.append(nav, layout); show(container);
  }

  async function load() {
    request?.abort();
    const controller = new AbortController(); request = controller;
    const loading = element('div', 'ddp-loading'); loading.append(element('div', 'ddp-loading-spinner'), element('p', '', 'Loading article...')); show(loading);
    try {
      const response = await fetch(`${options.apiBase}/dispatch/${encodeURIComponent(options.articleId)}`, { credentials: 'include', signal: controller.signal });
      if (!response.ok) throw Error('Article unavailable');
      const data = await response.json() as DispatchArticle;
      if (!data.articleContent || !Array.isArray(data.articleContent.paragraphs)) throw Error('Invalid article');
      if (disposed || controller.signal.aborted) return;
      article = data; document.title = `${data.title} | Daily Dispatch`; render();
    } catch {
      if (disposed || controller.signal.aborted) return;
      const error = element('div', 'ddp-error'); error.setAttribute('role', 'alert');
      error.append(element('h2', '', 'Article unavailable'), element('p', '', 'Failed to load article. Please try again.'), button('Try again', 'ddp-btn', () => void load()), link('Back to Articles', options.libraryURL, 'ddp-btn')); show(error);
    }
  }
  const archiveRequest = new AbortController();
  void fetch(`${options.apiBase}/dispatch/archives`, { credentials: 'include', signal: archiveRequest.signal }).then(async response => {
    if (!response.ok) return;
    const data = await response.json();
    if (disposed) return;
    archives = Array.isArray(data) ? data : Array.isArray(data.archives) ? data.archives : [];
    render();
  }).catch(() => { /* The article remains usable when archive metadata is unavailable. */ });
  void load();
  return {
    setTheme(value: DispatchTheme) { theme = value; applyTheme(); },
    destroy() {
      disposed = true; request?.abort(); archiveRequest.abort(); observer?.disconnect(); host.replaceChildren();
      if (framed) [document.documentElement, document.body].forEach(node => { node.classList.remove('classroom-mode'); delete node.dataset.dispatchTheme; });
      document.title = priorTitle;
    },
  };
}
