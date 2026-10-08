import { createClient } from "@supabase/supabase-js";

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnon);

// ─── Types ────────────────────────────────────────────────────────────────────

export type LeaderboardEntry = {
  wallet:        string;
  username:      string;
  avatar_cid:    string;
  total_bets:    number;
  correct_bets:  number;
  total_winnings: number; // USDC (6 decimals)
  accuracy:      number;  // 0-100
};

export type PollIdea = {
  id:          number;
  submitter:   string;
  title:       string;
  description: string;
  votes:       number;
  submitted_at: string;
  promoted:    boolean;
};

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .order("total_winnings", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ─── Poll Ideas ───────────────────────────────────────────────────────────────

export async function getPollIdeas(roundId: number): Promise<PollIdea[]> {
  const { data, error } = await supabase
    .from("poll_ideas")
    .select("*")
    .eq("round_id", roundId)
    .order("votes", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ─── Profile (off-chain metadata cache) ──────────────────────────────────────

export async function getProfileMeta(wallet: string) {
  const { data } = await supabase
    .from("profiles")
    .select("username, avatar_url, bio")
    .eq("wallet", wallet.toLowerCase())
    .single();

  return data;
}
