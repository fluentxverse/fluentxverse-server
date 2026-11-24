export interface DispatchSourceLink {
  href: string;
  label: string;
}

const publisherNames: Record<string, string> = {
  'nbcsports.com': 'NBC Sports',
  'uww.org': 'United World Wrestling',
  'insidethegames.biz': 'Inside the Games',
  'olympics.com': 'Olympics',
  'reuters.com': 'Reuters',
  'apnews.com': 'AP News',
  'bbc.com': 'BBC',
  'bbc.co.uk': 'BBC',
};

function cleanURL(value: string): URL | null {
  let text = value.replace(/[.,;]+$/, '');
  while (text.endsWith(')') && text.split(')').length > text.split('(').length) text = text.slice(0, -1);
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

// Older articles store prose and raw URLs together rather than structured citations.
export function parseDispatchSource(source: string | null | undefined): { description: string; links: DispatchSourceLink[] } {
  const links: DispatchSourceLink[] = [];
  const seen = new Set<string>();
  const description = (source || '').replace(/\[([^\]\n]+)\]\(<?(https?:\/\/[^\s<>]+?)>?\)|https?:\/\/[^\s<>"\]]+/gi, (match, title: string | undefined, target: string | undefined) => {
    const url = cleanURL(target || match);
    if (!url) return '';
    if (!seen.has(url.href)) {
      const host = url.hostname.replace(/^www\./, '');
      const publisher = Object.entries(publisherNames).find(([domain]) => host === domain || host.endsWith('.' + domain))?.[1];
      const explicitLabel = title?.trim();
      const label = explicitLabel && !/^https?:\/\//i.test(explicitLabel) ? explicitLabel : publisher || (host === 'news.google.com' ? `Reference ${links.length + 1}` : host);
      links.push({ href: url.href, label });
      seen.add(url.href);
    }
    return '';
  })
    .replace(/^\s*(?:source\s*:\s*|this article was provided by\s*)/i, '')
    .replace(/\bsource\s+urls?\s*:?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*[,;|]\s*)+$/, '')
    .replace(/([.!?])[\s.,;|]+$/, '$1')
    .trim();
  return { description: /^[\s.,;:|()\[\]-]*$/.test(description) ? '' : description, links };
}
