/**
 * Arc Calls — Contract ABIs
 */

export const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'transfer',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'transferFrom', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const

export const PROFILE_REGISTRY_ABI = [
  { name: 'mintProfile',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_name', type: 'string' }, { name: '_bio', type: 'string' }, { name: '_pfpHash', type: 'string' }, { name: '_xUsername', type: 'string' }], outputs: [] },
  { name: 'updateProfile', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_name', type: 'string' }, { name: '_bio', type: 'string' }, { name: '_pfpHash', type: 'string' }, { name: '_xUsername', type: 'string' }], outputs: [] },
  { name: 'getProfile',    type: 'function', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ name: 'name', type: 'string' }, { name: 'bio', type: 'string' }, { name: 'pfpHash', type: 'string' }, { name: 'xUsername', type: 'string' }, { name: 'mintedAt', type: 'uint256' }] },
  { name: 'hasProfile',    type: 'function', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'totalProfiles', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const

export const BETTING_POOL_ABI = [
  { name: 'createPrediction', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_title', type: 'string' }, { name: '_description', type: 'string' }, { name: '_bannerUrl', type: 'string' }, { name: '_deadline', type: 'uint256' }], outputs: [] },
  { name: 'placeBet',         type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'side', type: 'uint8' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'claimWinnings',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { name: 'claimRefund',      type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { name: 'declareWinner',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'winningSide', type: 'uint8' }], outputs: [] },
  { name: 'lockBetting',      type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { name: 'unlockBetting',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { name: 'refundPrediction', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { name: 'deletePrediction', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { name: 'extendDeadline',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'newDeadline', type: 'uint256' }], outputs: [] },
  { name: 'getPrediction',    type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'id', type: 'uint256' }, { name: 'title', type: 'string' }, { name: 'description', type: 'string' }, { name: 'bannerUrl', type: 'string' }, { name: 'deadline', type: 'uint256' }, { name: 'status', type: 'uint8' }, { name: 'yesPool', type: 'uint256' }, { name: 'noPool', type: 'uint256' }, { name: 'totalBettors', type: 'uint256' }, { name: 'createdAt', type: 'uint256' }] }] },
  { name: 'getUserBet',       type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }, { name: 'user', type: 'address' }], outputs: [{ name: 'side', type: 'uint8' }, { name: 'amount', type: 'uint256' }, { name: 'claimed', type: 'bool' }] },
  { name: 'isBettingLocked',  type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'getClaimableAmount', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }, { name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getAllIds',         type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256[]' }] },
  { name: 'totalPredictions', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getBetCount',      type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getBettors',       type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'address[]' }] },
  {
    name: 'BetPlaced', type: 'event',
    inputs: [
      { name: 'predictionId', type: 'uint256', indexed: true },
      { name: 'bettor', type: 'address', indexed: true },
      { name: 'side', type: 'uint8', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'PredictionCreated', type: 'event',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'title', type: 'string', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
      { name: 'createdAt', type: 'uint256', indexed: false },
    ],
  },
] as const

export const ACHIEVEMENT_REGISTRY_ABI = [
  { name: 'mintBadge',         type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'badge', type: 'uint8' }], outputs: [] },
  { name: 'hasBadge',          type: 'function', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }, { name: 'badge', type: 'uint8' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'getAllBadges',       type: 'function', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ name: 'starter', type: 'bool' }, { name: 'caller', type: 'bool' }, { name: 'oracle', type: 'bool' }, { name: 'og', type: 'bool' }] },
  { name: 'getEligibleBadges', type: 'function', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ name: 'eligible', type: 'uint256[]' }] },
  { name: 'getBadgeRecord',    type: 'function', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }, { name: 'badge', type: 'uint8' }], outputs: [{ name: 'minted', type: 'bool' }, { name: 'mintedAt', type: 'uint256' }, { name: 'mintedAtBet', type: 'uint256' }] },
  { name: 'getBetCount',       type: 'function', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalBadgesMinted', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'badgeCount',        type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

export const POLL_REGISTRY_ABI = [
  { name: 'submitPoll',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_title', type: 'string' }, { name: '_description', type: 'string' }], outputs: [] },
  { name: 'vote',              type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'pollId', type: 'uint256' }], outputs: [] },
  { name: 'deletePoll',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'pollId', type: 'uint256' }], outputs: [] },
  { name: 'closeRound',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'winnerIds', type: 'uint256[3]' }], outputs: [] },
  { name: 'getActivePolls',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'tuple[]', components: [{ name: 'id', type: 'uint256' }, { name: 'title', type: 'string' }, { name: 'description', type: 'string' }, { name: 'submittedBy', type: 'address' }, { name: 'voteCount', type: 'uint256' }, { name: 'round', type: 'uint256' }, { name: 'deleted', type: 'bool' }, { name: 'createdAt', type: 'uint256' }] }] },
  { name: 'getHistory',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'tuple[]', components: [{ name: 'round', type: 'uint256' }, { name: 'pollId', type: 'uint256' }, { name: 'title', type: 'string' }, { name: 'description', type: 'string' }, { name: 'submittedBy', type: 'address' }, { name: 'voteCount', type: 'uint256' }, { name: 'closedAt', type: 'uint256' }] }] },
  { name: 'hasVoted',          type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'currentRound',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalPolls',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    name: 'PollSubmitted', type: 'event',
    inputs: [
      { name: 'pollId', type: 'uint256', indexed: true },
      { name: 'submittedBy', type: 'address', indexed: true },
      { name: 'title', type: 'string', indexed: false },
      { name: 'round', type: 'uint256', indexed: false },
      { name: 'createdAt', type: 'uint256', indexed: false },
    ],
  },
] as const
