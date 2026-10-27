import type { PassMode } from '../../shared/lessonPasses';
import { trialLaunchMode, trialLessonLimit } from '../schedule.services/trialPolicy';

export class PassError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const privatePassMode = () => false;
export function requirePasses(): void {
  throw new PassError('Private lesson passes are disabled: contract-backed workflows are archived; existing records are preserved', 410);
}
export function publicPassMode(): PassMode {
  return trialLaunchMode() ? { mode: 'trial', trialLessonLimit: trialLessonLimit() } : { mode: 'legacy_erc1155' };
}
export function passConfig(): never {
  throw new PassError('Custom pass contracts are archived; no new contract configuration is accepted', 410);
}
