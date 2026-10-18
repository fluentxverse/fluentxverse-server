export const REVIEW_PROTOCOL = 'fluentxverse.anonymous-reviews.v1';
export const REVIEW_DEPTH = 8;
export const REVIEW_MIN_BATCH = 5;
export const REVIEW_MAX_MEMBERS = 2 ** REVIEW_DEPTH;
export const REVIEW_TOPICS = [
  { id: 'connection', label: 'Audio and connection quality', positive: true },
  { id: 'feedback', label: 'End-of-lesson feedback', positive: true },
  { id: 'corrections', label: 'Corrections and explanations', positive: true },
  { id: 'pace', label: "Tutor's speaking pace", positive: true },
  { id: 'difficulty', label: 'Lesson difficulty', positive: true },
  { id: 'engagement', label: 'Tutor focus and engagement', positive: false },
] as const;

export interface AnonymousReviewContent {
  rating: number;
  positive: string[];
  improvement: string[];
  salt: string;
}
export interface AnonymousReviewProof {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  nullifier: string;
  message: string;
  scope: string;
  points: [string, string, string, string, string, string, string, string];
}
export interface AnonymousReviewGroup {
  id: string;
  tutorId: string;
  period: string;
  opensAt: string;
  closesAt: string;
  root: string | null;
  scope: string;
  members: string[];
  depth: number;
  state: 'enrolling' | 'awaiting_activation' | 'open' | 'closed' | 'insufficient_members';
  chainId: number;
  contract: string;
  infrastructure?: 'bridge_only' | 'legacy_contracts';
  acceptanceEnforcement?: 'application' | 'contract';
  artifacts: { wasmUrl: string; zkeyUrl: string; wasmSha256: string; zkeySha256: string };
}
export interface AnonymousReviewEnrollment {
  groupId: string;
  tutorId: string;
  period: string;
  opensAt: string;
  closesAt: string;
  enrolled: boolean;
  commitment: string | null;
  canEnroll: boolean;
}

export function validateAnonymousContent(input: unknown): AnonymousReviewContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid review content');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['rating', 'positive', 'improvement', 'salt'].includes(key)))
    throw new Error('Only structured anonymous feedback is accepted');
  if (!Number.isInteger(value.rating) || Number(value.rating) < 1 || Number(value.rating) > 5)
    throw new Error('Choose a rating from 1 to 5');
  if (typeof value.salt !== 'string' || !/^[a-f0-9]{64}$/.test(value.salt)) throw new Error('Invalid review salt');
  const choices = (key: 'positive' | 'improvement') => {
    const items = value[key];
    if (!Array.isArray(items) || items.length > REVIEW_TOPICS.length || items.some(id =>
      typeof id !== 'string' || !REVIEW_TOPICS.some(topic => topic.id === id && (key !== 'positive' || topic.positive))))
      throw new Error('Choose valid review topics');
    if (new Set(items).size !== items.length) throw new Error('Duplicate review topics');
    return [...items].sort() as string[];
  };
  const positive = choices('positive'), improvement = choices('improvement');
  if (positive.some(id => improvement.includes(id))) throw new Error('Conflicting review topics');
  return { rating: Number(value.rating), positive, improvement, salt: value.salt };
}

export function reviewMessageJson(groupId: string, content: AnonymousReviewContent): string {
  const normalized = validateAnonymousContent(content);
  return JSON.stringify({ protocol: REVIEW_PROTOCOL, groupId, ...normalized });
}
export function reviewScopeJson(chainId: number, contract: string, groupId: string): string {
  return JSON.stringify({ protocol: REVIEW_PROTOCOL, chainId, contract: contract.toLowerCase(), groupId });
}

export function reviewPeriod(date: string | number): string {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid lesson date');
  return value.toISOString().slice(0, 7);
}
export function reviewWindow(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid review period');
  const [year, month] = period.split('-').map(Number) as [number, number];
  if (year < 2020 || year > 2100) throw new Error('Invalid review period');
  const opens = Date.UTC(year, month, 1);
  return { opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + 7 * 86400_000).toISOString() };
}

export function summarizeAnonymousReviews(contents: AnonymousReviewContent[]) {
  return { total: contents.length,
    average: contents.length ? Math.round(contents.reduce((sum, item) => sum + item.rating, 0) / contents.length * 10) / 10 : null,
    distribution: [1, 2, 3, 4, 5].map(rating => ({ rating, count: contents.filter(item => item.rating === rating).length })),
    topics: REVIEW_TOPICS.map(topic => ({ ...topic,
      positiveCount: contents.filter(item => item.positive.includes(topic.id)).length,
      improvementCount: contents.filter(item => item.improvement.includes(topic.id)).length })) };
}
