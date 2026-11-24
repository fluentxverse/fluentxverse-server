export const tutorRewardClaimTypes = { Claim: [
  { name: 'tutorId', type: 'bytes32' }, { name: 'wallet', type: 'address' }, { name: 'rewardToken', type: 'address' },
  { name: 'amountUsd', type: 'uint256' }, { name: 'minAmountOut', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
  { name: 'quotedAt', type: 'uint64' }, { name: 'deadline', type: 'uint64' }, { name: 'assetVersion', type: 'uint64' },
  { name: 'executionEpoch', type: 'uint64' }, { name: 'dataHash', type: 'bytes32' },
] } as const;
