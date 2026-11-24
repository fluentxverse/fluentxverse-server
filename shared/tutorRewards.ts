export const initialRewardSymbols = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD', 'COIN', 'MSTR', 'PLTR', 'SPCX'] as const;
export type RewardCommand = 'create_period' | 'set_release' | 'register_tutor' | 'stage_counts' | 'finalize_period' | 'unlock_rewards' | 'approve_funding' | 'fund' | 'configure_asset' | 'disable_asset' | 'set_paused';
export interface RewardOperation {
  id: string; action: RewardCommand; status: string; createdAt: string; actorId: string; reason: string;
  engineTransactionId?: string; transactionHash?: string; error?: string;
}
export interface RewardPeriod {
  month: string; periodId: number; minimumLessons: number; rewardPerLessonUsd: string;
  releaseAt: string; finalized: boolean; totalUsd: string; exists: boolean;
}
export interface TutorRewardSummary {
  chainId: number; network: string; explorer: string; contract: string; settlementToken: string;
  settlementSymbol: string; operator: string; deployed: boolean; finalized: boolean;
  engineConfigured: boolean; operatorGasWei: string; treasuryUsd: string; reservedUsd: string; surplusUsd: string;
  claimsPaused: boolean; allocationsPaused: boolean; maxQuoteAgeSeconds: number; blockers: string[];
  periods: RewardPeriod[]; assets: Array<{ token: string; symbol: string; enabled: boolean; adapter: string; priceFeed: string;
    maxSlippageBps: number; maxPriceAgeSeconds: number; version: string }>;
  operations: RewardOperation[]; checkedAt: string;
}
export interface TutorRewardRow {
  tutorId: string; publicId: string | null; name: string; wallet: string | null;
  completedLessons: number; heldLessons: number; excludedLessons: number; amountUsd: string;
  registered: boolean; stagedLessons: number | null; stagedAmountUsd: string | null; availableUsd: string | null;
}
export interface TutorRewardPreview {
  month: string; period: RewardPeriod | null; rows: TutorRewardRow[]; totalUsd: string;
  heldLessons: number; snapshotDigest: string; canStage: boolean; canFinalize: boolean; blockers: string[];
}
