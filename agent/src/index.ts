/**
 * Arc Calls — AI Resolution Agent
 *
 * An autonomous agent that holds its own Arc wallet (funded with USDC)
 * and automatically resolves prediction markets when their deadlines pass.
 *
 * The agent:
 *  1. Polls BettingPool for markets past their deadline
 *  2. Fetches outcome data from configured data sources
 *  3. Calls BettingPool.resolve() with the determined outcome
 *  4. Pays its own USDC gas — fully self-sustaining
 *
 * STATUS: 🔨 In Progress — data source integrations pending
 */

import * as dotenv from "dotenv";
import cron from "node-cron";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const ARC_RPC_URL       = process.env.ARC_RPC_URL || "https://rpc.arc.io";
const BETTING_POOL_ADDR = process.env.BETTING_POOL_ADDRESS as `0x${string}`;

if (!AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY not set in .env");

// ─── Wallet Setup ─────────────────────────────────────────────────────────────

const account = privateKeyToAccount(AGENT_PRIVATE_KEY);

// TODO: replace chainId/RPC with finalized Arc mainnet values
const client = createWalletClient({
  account,
  transport: http(ARC_RPC_URL),
}).extend(publicActions);

console.log(`[Agent] Wallet: ${account.address}`);

// ─── Types ────────────────────────────────────────────────────────────────────

type Market = {
  id:       bigint;
  title:    string;
  deadline: bigint;
  outcome:  number; // 0=Unresolved, 1=Yes, 2=No, 3=Cancelled
};

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Fetch all unresolved markets past their deadline.
 * TODO: replace with actual contract read using ABI
 */
async function getMarketsToResolve(): Promise<Market[]> {
  // TODO: readContract({ address: BETTING_POOL_ADDR, abi: BettingPoolABI, functionName: 'getUnresolvedMarkets' })
  console.log("[Agent] Fetching markets to resolve...");
  return [];
}

/**
 * Determine the outcome of a market from external data sources.
 * TODO: plug in data sources per market category (on-chain metrics, APIs)
 *
 * @param market  Market to resolve
 * @returns       1 (Yes), 2 (No), or 3 (Cancelled)
 */
async function determineOutcome(market: Market): Promise<1 | 2 | 3> {
  console.log(`[Agent] Determining outcome for market #${market.id}: "${market.title}"`);

  // TODO: route by market category
  // Official markets → read from Arc chain metrics (TVL, tx count, etc.)
  // Community lore   → aggregate community vote data from Supabase

  // Placeholder
  return 3; // Cancelled until logic is implemented
}

/**
 * Submit resolution on-chain via the agent's Arc wallet.
 * Gas is paid in USDC — no separate token needed.
 */
async function resolveMarket(marketId: bigint, outcome: 1 | 2 | 3): Promise<void> {
  console.log(`[Agent] Resolving market #${marketId} with outcome ${outcome}...`);

  // TODO: writeContract({ address: BETTING_POOL_ADDR, abi: BettingPoolABI, functionName: 'resolve', args: [marketId, outcome] })

  console.log(`[Agent] ✅ Market #${marketId} resolved.`);
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function runResolutionCycle(): Promise<void> {
  try {
    const markets = await getMarketsToResolve();

    if (markets.length === 0) {
      console.log("[Agent] No markets to resolve.");
      return;
    }

    for (const market of markets) {
      const outcome = await determineOutcome(market);
      await resolveMarket(market.id, outcome);
    }
  } catch (err) {
    console.error("[Agent] Error in resolution cycle:", err);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

console.log("[Agent] Starting Arc Calls resolution agent...");

// Run every 30 minutes
cron.schedule("*/30 * * * *", () => {
  console.log(`[Agent] Running resolution cycle at ${new Date().toISOString()}`);
  runResolutionCycle();
});

// Run immediately on start
runResolutionCycle();
