import { FLUENT_KIDS_NAME, fluentKidsLevels, fluentKidsLessonCount } from './curriculum';
import './roadmap.css';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

export function fluentKidsRoadmap(courseHref: string, legacyHref?: string) {
  return `<div class="fk-roadmap">
    <header class="fk-roadmap-header">
      <p class="fk-roadmap-label">English for ages 6–12</p>
      <h1>${FLUENT_KIDS_NAME}</h1>
      <p>Build confidence in English through illustrated stories, games, and conversations.</p>
      <p class="fk-roadmap-plan">3 levels · 24 units · ${fluentKidsLessonCount} lessons</p>
    </header>
    ${fluentKidsLevels.map(level => `
      <details class="fk-level"${level.number === 1 ? ' open' : ''}>
        <summary><span class="fk-roadmap-label">Level ${level.number}</span>
          <strong>${escapeHtml(level.name)}</strong><span>${escapeHtml(level.goal)}</span>
        </summary>
        <div class="fk-units">${level.units.map(unit => `
          <details class="fk-unit"${level.number === 1 && unit.number === 1 ? ' open' : ''}>
            <summary>Unit ${unit.number} · ${escapeHtml(unit.name)}</summary>
            <ol>${unit.lessons.map(item => `
              <li><span>${item.number}. ${escapeHtml(item.title)}${item.checkpoint ? ' <small>Checkpoint</small>' : ''}</span>
              ${item.available
                ? `<a href="${escapeHtml(courseHref)}/lesson/${item.id}" aria-label="Open ${escapeHtml(item.title)}">Open lesson</a>`
                : '<small>Planned</small>'}</li>`).join('')}
            </ol>
          </details>`).join('')}</div>
      </details>`).join('')}
    ${legacyHref ? `<a class="fk-legacy-link" href="${escapeHtml(legacyHref)}">Earlier Young Learners materials</a>` : ''}
  </div>`;
}
