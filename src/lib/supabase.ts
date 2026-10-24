import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../constants'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ---- Types matching the corrected Supabase schema ----

export interface DbProfile {
  wallet_address: string
  name: string
  bio: string
  pfp_url: string
  x_username: string
  minted_at: string
}

export interface DbLeaderboard {
  wallet_address: string
  name: string
  pfp_url: string
  total_calls: number
  wins: number
  losses: number
  win_rate: number
  total_pnl: number
  total_volume: number
  is_agent: boolean
  updated_at: string
}

export interface DbPrediction {
  id: number
  title: string
  description: string
  banner_url: string | null
  deadline: string
  no_deadline: boolean
  status: 'open' | 'locked' | 'yes_wins' | 'no_wins' | 'refunded' | 'deleted'
  yes_pool: number
  no_pool: number
  category: string
  winner: string | null
  settled_at: string | null
  x_monitor: XMonitorConfig | null
  created_at: string
}

export interface XMonitorConfig {
  handle: string
  condition_type: string
  threshold: string | null
  tweet_id: string | null
  last_tweet_id: string | null
  last_pfp_url: string | null
  last_verified: boolean | null
  activation_timestamp: number
  tracking_tweet_id: string | null
}

export interface DbBet {
  id: number
  prediction_id: number
  wallet_address: string
  side: 'YES' | 'NO'
  amount: number
  result: 'pending' | 'won' | 'lost' | 'refunded'
  payout: number
  tx_hash: string
  created_at: string
}

export interface DbPoll {
  id: number
  title: string
  description: string
  created_by_wallet: string
  created_by_name: string
  vote_count: number
  status: 'active' | 'deleted'
  created_at: string
}

export interface DbPollVote {
  id: number
  poll_id: number
  wallet_address: string
  created_at: string
}

export interface DbPollHistory {
  id: string
  round_number: number
  poll_id: number
  poll_title: string
  description: string
  submitted_by_name: string
  final_vote_count: number
  closed_at: string
}

export interface DbTemplate {
  id: string
  title: string
  description: string
  created_at: string
}

export interface DbWalletTransaction {
  id: string
  wallet_address: string
  type: 'bet' | 'claim' | 'refund' | 'poll_submit' | 'vote' | 'deposit' | 'withdrawal' | 'profile_creation' | 'admin_action'
  label: string
  amount: number | null
  tx_hash: string
  created_at: string
}

export interface DbXMonitorLog {
  id: string
  prediction_id: number
  handle: string
  condition_type: string
  current_value: string
  threshold: string
  triggered: boolean
  action_taken: string
  error: string | null
  raw_data: unknown
  checked_at: string
}
