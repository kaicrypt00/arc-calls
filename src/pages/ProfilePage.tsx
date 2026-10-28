import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useSessionWallet, publicClient, writeContract, getMaxFeePerGas } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { useToast } from '../contexts/ToastContext'
import { useSound } from '../contexts/SoundContext'
import { supabase, type DbBet } from '../lib/supabase'
import { BETTING_POOL_ADDRESS } from '../constants'
import { BETTING_POOL_ABI } from '../abis'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BadgesTab from '../components/BadgesTab'
import EditProfileModal from '../components/EditProfileModal'
import { buildXShareUrl, shortAddress, formatMonthYear } from '../utils/format'
import { EXPLORER_URL } from '../config'
import { formatUnits } from 'viem'
import { USDC_DECIMALS } from '../constants'

const PAGE_SIZE = 20
const STATS_CACHE_TTL = 5 * 60 * 1000

function GateConnect() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 52 }}>🔒</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Connect Your Wallet</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 340, lineHeight: 1.8 }}>Connect and set up a profile to view this page.</div>
      <ConnectButton label="Connect Wallet" showBalance={false} chainStatus="none" />
    </div>
  )
}

function GateActivate({ isCreating, createSessionWallet }: { isCreating: boolean; createSessionWallet: () => void }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 52 }}>⚡</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Activate Arc Calls Wallet</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 380, lineHeight: 1.8 }}>Sign a one-time message to generate your seamless session wallet. No gas needed — just a signature.</div>
      <button onClick={createSessionWallet} disabled={isCreating} style={{ background: 'linear-gradient(135deg, #062a51, #0d4a8a)', color: 'var(--text-primary)', border: '1px solid rgba(90,138,176,0.4)', borderRadius: 12, padding: '14px 44px', fontSize: 15, fontWeight: 700, cursor: isCreating ? 'not-allowed' : 'pointer', opacity: isCreating ? 0.7 : 1, boxShadow: '0 4px 20px rgba(54,97,132,0.3)' }}>
        {isCreating ? 'Waiting for signature…' : 'Activate Arc Calls Wallet'}
      </button>
    </div>
  )
}

function GateNoProfile({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 52 }}>🎭</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}>No Profile Yet</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.8 }}>Mint your Arc Calls profile to enter the arena and start tracking your calls.</div>
      <button onClick={onSetUp} style={{ background: 'linear-gradient(135deg, #062a51, #0d4a8a)', color: 'var(--text-primary)', border: '1px solid rgba(90,138,176,0.4)', borderRadius: 12, padding: '13px 40px', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(54,97,132,0.3)' }}>
        Set Up Profile
      </button>
    </div>
  )
}

function StatusBadge({ result }: { result: string }) {
  type StatusStyle = { label: string; bg: string; color: string; border: string }
  const map: Record<string, StatusStyle> = {
    won:      { label: 'WON',      bg: 'rgba(74,222,128,0.1)',  color: '#4ade80', border: 'rgba(74,222,128,0.25)' },
    lost:     { label: 'LOST',     bg: 'rgba(248,113,113,0.1)', color: '#f87171', border: 'rgba(248,113,113,0.25)' },
    pending:  { label: 'PENDING',  bg: 'rgba(90,138,176,0.08)', color: 'var(--text-secondary)', border: 'var(--border-default)' },
    refunded: { label: 'REFUNDED', bg: 'rgba(245,158,11,0.1)',  color: '#fbbf24', border: 'rgba(245,158,11,0.25)' },
  }
  const s: StatusStyle = map[result] || { label: result?.toUpperCase() || '—', bg: 'transparent', color: 'var(--text-tertiary)', border: 'var(--border-subtle)' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px 10px', borderRadius: 6, background: s.bg, color: s.color, border: '1px solid ' + s.border, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
      {s.label}
    </span>
  )
}

interface BetChainState {
  claimed: boolean
  canClaimWinnings: boolean
  canClaimRefund: boolean
  claimableAmount: string
  onChainStatus: number
}

function MyCalls({
  bets,
  betTitles,
  betsHasMore,
  chainStates,
  claimingId,
  onClaim,
  onLoadMore,
}: {
  bets: DbBet[]
  betTitles: Record<number, string>
  betsHasMore: boolean
  chainStates: Record<string, BetChainState>
  claimingId: number | null
  onClaim: (predictionId: number, isRefund?: boolean) => void
  onLoadMore: () => void
}) {
  const unclaimedItems = bets.filter(b => {
    const s = chainStates[String(b.prediction_id)]
    return s?.canClaimWinnings || s?.canClaimRefund
  })
  const totalUnclaimed = unclaimedItems.reduce((acc, b) => {
    const s = chainStates[String(b.prediction_id)]
    return acc + parseFloat(s?.claimableAmount || '0')
  }, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {unclaimedItems.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(54,97,132,0.18), rgba(6,18,38,0.75))',
          border: '1px solid rgba(90,138,176,0.35)',
          borderRadius: 14,
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          boxShadow: '0 4px 20px rgba(54,97,132,0.2)',
        }}>
          <div style={{ fontSize: 28 }}>💰</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--accent-bright)', marginBottom: 2 }}>
              You have unclaimed funds!
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {unclaimedItems.length} call{unclaimedItems.length > 1 ? 's' : ''} ready to claim
              {' '}· <span style={{ color: '#4ade80', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                +{totalUnclaimed.toFixed(2)} USDC
              </span> available
            </div>
          </div>
        </div>
      )}

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {bets.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>🎯</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No Calls Yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Head to Calls to place your first call!</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 110px 110px 96px', padding: '13px 20px', borderBottom: '1px solid var(--border-default)', background: 'rgba(6,18,38,0.6)' }}>
              {['MARKET', 'SIDE', 'STAKE', 'PAYOUT', 'STATUS'].map((h) => (
                <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-tertiary)', textTransform: 'uppercase' as const, textAlign: (['STAKE', 'PAYOUT', 'STATUS'].includes(h) ? 'right' : 'left') as 'right' | 'left' }}>{h}</span>
              ))}
            </div>
            {bets.map((b, i) => {
              const title = betTitles[b.prediction_id] || ('Prediction #' + b.prediction_id)
              const state = chainStates[String(b.prediction_id)]
              const isClaiming = claimingId === b.prediction_id
              const canClaimWinnings = !!state?.canClaimWinnings
              const canClaimRefund = !!state?.canClaimRefund
              const canClaim = canClaimWinnings || canClaimRefund
              const isClaimed = !!state?.claimed
              const isRefund = canClaimRefund || b.result === 'refunded' || state?.onChainStatus === 4

              return (
                <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 110px 110px 96px', padding: '17px 20px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center', transition: 'background 150ms', animation: 'fadeIn 250ms ease ' + Math.min(i * 20, 200) + 'ms both', background: canClaim ? 'rgba(54,97,132,0.06)' : 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = canClaim ? 'rgba(54,97,132,0.12)' : 'rgba(54,97,132,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = canClaim ? 'rgba(54,97,132,0.06)' : 'transparent')}>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280, fontWeight: 500 }}>{title.slice(0, 70)}</div>
                    {b.tx_hash && (<a href={EXPLORER_URL + '/tx/' + b.tx_hash} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.02em' }}>↗ on-chain</a>)}
                  </div>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: String(b.side).toUpperCase() === 'YES' ? '#e4e8ec' : '#f87171' }}>{String(b.side).toUpperCase()}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' as const, display: 'block' }}>{Number(b.amount).toFixed(2)} USDC</span>
                  <div style={{ textAlign: 'right' as const }}>
                    {canClaimWinnings ? (
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: '#4ade80' }}>+{parseFloat(state.claimableAmount).toFixed(2)} USDC</span>
                    ) : canClaimRefund ? (
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>+{Number(b.amount).toFixed(2)} USDC</span>
                    ) : isClaimed ? (
                      <span style={{ fontSize: 12, color: isRefund ? '#94a3b8' : '#4ade80', fontWeight: 600 }}>{isRefund ? '✓ Refunded' : '✓ Claimed'}</span>
                    ) : b.result === 'lost' ? (
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: '#f87171' }}>-{Number(b.amount).toFixed(2)} USDC</span>
                    ) : Number(b.payout) > 0 ? (
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: '#4ade80' }}>+{Number(b.payout).toFixed(2)} USDC</span>
                    ) : b.result === 'pending' ? (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Awaiting result</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>—</span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' as const }}>
                    {canClaimWinnings ? (
                      <button
                        onClick={() => onClaim(b.prediction_id, false)}
                        disabled={isClaiming}
                        style={{
                          background: isClaiming ? 'rgba(54,97,132,0.2)' : 'linear-gradient(135deg, rgba(90,138,176,0.3), rgba(54,97,132,0.2))',
                          border: '1px solid rgba(90,138,176,0.5)',
                          color: 'var(--accent-bright)',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '6px 12px',
                          borderRadius: 7,
                          cursor: isClaiming ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s ease',
                          letterSpacing: '0.04em',
                          boxShadow: isClaiming ? 'none' : '0 0 12px rgba(90,138,176,0.25)',
                          outline: 'none',
                        }}
                      >
                        {isClaiming ? '⏳…' : '💰 CLAIM'}
                      </button>
                    ) : canClaimRefund ? (
                      <button
                        onClick={() => onClaim(b.prediction_id, true)}
                        disabled={isClaiming}
                        style={{
                          background: isClaiming ? 'rgba(148,163,184,0.1)' : 'linear-gradient(135deg, rgba(148,163,184,0.2), rgba(100,116,139,0.15))',
                          border: '1px solid rgba(148,163,184,0.4)',
                          color: '#cbd5e1',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '6px 12px',
                          borderRadius: 7,
                          cursor: isClaiming ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s ease',
                          letterSpacing: '0.04em',
                          outline: 'none',
                        }}
                      >
                        {isClaiming ? '⏳…' : '💰 REFUND'}
                      </button>
                    ) : (
                      <StatusBadge result={isRefund ? 'refunded' : b.result} />
                    )}
                  </div>
                </div>
              )
            })}
            {betsHasMore && (<div style={{ textAlign: 'center', padding: '16px' }}><button onClick={onLoadMore} className="btn-secondary" style={{ fontSize: 12, padding: '7px 20px' }}>Load More</button></div>)}
          </>
        )}
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { sessionWallet, hasSessionWallet, createSessionWallet, isCreating, loadBalances, clearSessionWallet } = useSessionWallet()
  const { profile, setShowMintModal, refreshProfile } = useProfile()

  const [tab, setTab] = useState<'calls' | 'badges'>('calls')
  const [bets, setBets] = useState<DbBet[]>([])
  const [betTitles, setBetTitles] = useState<Record<number, string>>({})
  const [betCount, setBetCount] = useState(0)
  const [wins, setWins] = useState(0)
  const [pnl, setPnl] = useState(0)
  const [betsPage, setBetsPage] = useState(0)
  const [betsHasMore, setBetsHasMore] = useState(false)
  const [chainStates, setChainStates] = useState<Record<string, BetChainState>>({})
  const [copied, setCopied] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  const { showPending, showConfirmed, showFailed } = useToast()
  const { playClaimSound } = useSound()
  const [claimingId, setClaimingId] = useState<number | null>(null)

  const wallet = sessionWallet?.address ?? address

  const loadBets = useCallback(async (page: number) => {
    if (!wallet) return
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const cacheKey = 'arc_profile_stats_' + wallet.toLowerCase()
    if (page === 0) {
      try {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const { betCount: bc, wins: w, pnl: p, ts } = JSON.parse(cached) as { betCount: number; wins: number; pnl: number; ts: number }
          if (Date.now() - ts < STATS_CACHE_TTL) { setBetCount(bc); setWins(w); setPnl(p) }
        }
      } catch { /* ignore */ }
    }
    const { data } = await supabase.from('bets').select('*').eq('wallet_address', wallet.toLowerCase()).order('created_at', { ascending: false }).range(from, to)
    if (!data) return
    if (page === 0) {
      setBets(data as DbBet[])
      const { count } = await supabase.from('bets').select('*', { count: 'exact', head: true }).eq('wallet_address', wallet.toLowerCase())
      const allBets = count ?? 0

      // Fetch fresh stats from leaderboard (consistent with Rialo Calls)
      const { data: lb } = await supabase.from('leaderboard')
        .select('total_calls, wins, total_volume, total_pnl, win_rate')
        .eq('wallet_address', wallet.toLowerCase())
        .single()

      if (lb) {
        setBetCount(lb.total_calls ?? allBets)
        setWins(lb.wins ?? 0)
        setPnl(Number(lb.total_pnl ?? 0))
        try { localStorage.setItem(cacheKey, JSON.stringify({ betCount: lb.total_calls ?? allBets, wins: lb.wins ?? 0, pnl: Number(lb.total_pnl ?? 0), ts: Date.now() })) } catch { /* ignore */ }
      } else {
        const { data: allData } = await supabase.from('bets').select('result,amount,payout').eq('wallet_address', wallet.toLowerCase())
        if (allData) {
          const w = (allData as { result: string; amount: string; payout: string }[]).filter(b => b.result === 'won').length
          const p = (allData as { result: string; amount: string; payout: string }[]).reduce((s, b) => {
            if (b.result === 'won' && Number(b.payout) > 0) return s + (Number(b.payout) - Number(b.amount))
            if (b.result === 'lost') return s - Number(b.amount)
            return s
          }, 0)
          setBetCount(allBets)
          setWins(w)
          setPnl(p)
          try { localStorage.setItem(cacheKey, JSON.stringify({ betCount: allBets, wins: w, pnl: p, ts: Date.now() })) } catch { /* ignore */ }
        }
      }
    } else {
      setBets(prev => [...prev, ...(data as DbBet[])])
    }
    setBetsHasMore(data.length === PAGE_SIZE)
    const ids = [...new Set((data as DbBet[]).map(b => b.prediction_id))]
    if (ids.length > 0) {
      const { data: preds } = await supabase.from('predictions_display').select('id,title').in('id', ids)
      if (preds) {
        const map: Record<number, string> = {}
        ;(preds as { id: number; title: string }[]).forEach(p => { map[p.id] = p.title })
        setBetTitles(prev => ({ ...prev, ...map }))
      }
    }
  }, [wallet])

  useEffect(() => { loadBets(0) }, [loadBets])

  const checkClaimable = useCallback(async (betsToCheck: DbBet[]) => {
    if (!wallet) return
    const map: Record<string, BetChainState> = {}
    await Promise.all(betsToCheck.map(async b => {
      try {
        const [betData, predData] = await Promise.all([
          publicClient.readContract({
            address: BETTING_POOL_ADDRESS,
            abi: BETTING_POOL_ABI,
            functionName: 'getUserBet',
            args: [BigInt(b.prediction_id), wallet as `0x${string}`],
          }),
          publicClient.readContract({
            address: BETTING_POOL_ADDRESS,
            abi: BETTING_POOL_ABI,
            functionName: 'getPrediction',
            args: [BigInt(b.prediction_id)],
          }),
        ])
        const [, , claimed] = betData as [number, bigint, boolean]
        const predStatus = Number((predData as { status: number }).status)

        if (claimed) {
          map[String(b.prediction_id)] = {
            claimed: true,
            canClaimWinnings: false,
            canClaimRefund: false,
            claimableAmount: '0',
            onChainStatus: predStatus,
          }
        } else if (predStatus === 4 || b.result === 'refunded') {
          map[String(b.prediction_id)] = {
            claimed: false,
            canClaimWinnings: false,
            canClaimRefund: true,
            claimableAmount: Number(b.amount).toFixed(2),
            onChainStatus: 4,
          }
        } else if (predStatus === 2 || predStatus === 3) {
          const amt = await publicClient.readContract({
            address: BETTING_POOL_ADDRESS,
            abi: BETTING_POOL_ABI,
            functionName: 'getClaimableAmount',
            args: [BigInt(b.prediction_id), wallet as `0x${string}`],
          })
          const formatted = formatUnits(amt as bigint, USDC_DECIMALS)
          if (parseFloat(formatted) > 0) {
            map[String(b.prediction_id)] = {
              claimed: false,
              canClaimWinnings: true,
              canClaimRefund: false,
              claimableAmount: formatted,
              onChainStatus: predStatus,
            }
          } else {
            map[String(b.prediction_id)] = {
              claimed: false,
              canClaimWinnings: false,
              canClaimRefund: false,
              claimableAmount: '0',
              onChainStatus: predStatus,
            }
          }
        } else {
          map[String(b.prediction_id)] = {
            claimed: false,
            canClaimWinnings: false,
            canClaimRefund: false,
            claimableAmount: '0',
            onChainStatus: predStatus,
          }
        }
      } catch { /* ignore */ }
    }))
    setChainStates(map)
  }, [wallet])

  useEffect(() => { if (bets.length > 0) checkClaimable(bets) }, [bets, checkClaimable])

  const handleClaim = useCallback(async (predictionId: number, isRefund: boolean = false) => {
    if (!sessionWallet) return
    setClaimingId(predictionId)
    showPending(isRefund ? 'Claiming refund...' : 'Claiming winnings...')
    try {
      playClaimSound()
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: isRefund ? 'claimRefund' : 'claimWinnings',
        args: [BigInt(predictionId)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, isRefund ? 'Refund claimed! 🪙' : 'Winnings claimed! 🏆')

      const walletAddr = sessionWallet.address.toLowerCase()
      const betRow = bets.find(b => b.prediction_id === predictionId)
      const state = chainStates[String(predictionId)]
      const claimAmt = state?.claimableAmount || (betRow?.amount ? String(betRow.amount) : '0')
      const payoutVal = parseFloat(claimAmt)

      await supabase.from('bets').update({
        result: isRefund ? 'refunded' : 'won',
        payout: payoutVal,
      }).eq('prediction_id', predictionId).eq('wallet_address', walletAddr)

      const marketTitle = betTitles[predictionId] || `Prediction #${predictionId}`
      await supabase.from('wallet_transactions').insert({
        wallet_address: walletAddr,
        type: isRefund ? 'refund' : 'claim',
        label: isRefund ? `Claimed refund – ${marketTitle.slice(0, 40)}` : `Claimed winnings – ${marketTitle.slice(0, 40)}`,
        amount: payoutVal,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })

      setChainStates(prev => ({
        ...prev,
        [String(predictionId)]: {
          claimed: true,
          canClaimWinnings: false,
          canClaimRefund: false,
          claimableAmount: '0',
          onChainStatus: prev[String(predictionId)]?.onChainStatus ?? 0,
        }
      }))

      await loadBalances()
      await loadBets(0)
    } catch (e: unknown) {
      showFailed((e as Error)?.message?.slice(0, 80) ?? 'Claim failed')
    }
    setClaimingId(null)
  }, [sessionWallet, chainStates, bets, betTitles, loadBalances, loadBets, playClaimSound, showPending, showConfirmed, showFailed])

  const handleDisconnect = () => { disconnect(); clearSessionWallet(); navigate('/') }
  const handleCopy = async () => {
    if (wallet) { await navigator.clipboard.writeText(wallet); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }
  const handleShareStats = () => {
    const rate = betCount > 0 ? ((wins / betCount) * 100).toFixed(0) : '0'
    const text = "I've made " + betCount + " calls on Arc Calls with a " + rate + "% win rate 🎯\nJoin me: https://arccalls.xyz"
    window.open(buildXShareUrl(text), '_blank')
  }

  const winRate = betCount > 0 ? ((wins / betCount) * 100).toFixed(0) : '0'
  const mintedAtDisplay = profile?.minted_at ? formatMonthYear(profile.minted_at) : ''

  if (!isConnected) return (<div className="page" style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}><Navbar /><main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '40px 20px' }}><GateConnect /></main><Footer /></div>)
  if (!hasSessionWallet) return (<div className="page" style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}><Navbar /><main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '40px 20px' }}><GateActivate isCreating={isCreating} createSessionWallet={createSessionWallet} /></main><Footer /></div>)
  if (!profile) return (<div className="page" style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}><Navbar /><main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '40px 20px' }}><GateNoProfile onSetUp={() => setShowMintModal(true)} /></main><Footer /></div>)

  const statCards = [
    { label: 'TOTAL CALLS', value: betCount, color: 'var(--text-primary)' },
    { label: 'WINS', value: wins, color: 'var(--yes-color)' },
    { label: 'WIN RATE', value: winRate + '%', color: 'var(--accent-bright)' },
    { label: 'P&L', value: (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' USDC', color: pnl >= 0 ? 'var(--yes-color)' : 'var(--no-color)' },
  ]

  return (
    <div className="page" style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at 30% 20%, rgba(54,97,132,0.12) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(54,97,132,0.08) 0%, transparent 50%)', filter: 'blur(40px)' }} />
      <Navbar />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px 80px', position: 'relative', zIndex: 10, flex: 1, width: '100%' }}>

        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', padding: 0, marginBottom: 28, transition: 'color 0.2s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          onClick={() => navigate('/calls')}>
          ← Back to Calls
        </button>

        {/* Profile Hero Card */}
        <div style={{ background: 'rgba(6,18,38,0.75)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(54,97,132,0.25)', borderRadius: 18, padding: '32px 36px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', position: 'relative', overflow: 'hidden', transition: 'border-color 0.3s ease' }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(90,138,176,0.45)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(54,97,132,0.25)')}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(54,97,132,0.08) 0%, transparent 60%)', pointerEvents: 'none', borderRadius: 'inherit' }} />

          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 140, height: 140, borderRadius: '50%', padding: 3, background: 'linear-gradient(135deg, rgba(90,138,176,0.9), rgba(54,97,132,0.5), transparent)', display: 'inline-block' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: 'rgba(6,18,38,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {profile.pfp_url
                  ? <img src={profile.pfp_url} alt={profile.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { e.currentTarget.style.display = 'none'; const sib = e.currentTarget.nextSibling as HTMLElement; if (sib) sib.style.display = 'flex' }} />
                  : null
                }
                <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-blue), #010d1f)', display: profile.pfp_url ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {profile.name?.[0]?.toUpperCase() || '?'}
                </div>
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: 8, right: 8, width: 22, height: 22, borderRadius: '50%', background: '#010d1f', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2.5px solid #010d1f' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 10px rgba(74,222,128,0.8)', animation: 'pulse-dot 2s ease infinite' }} />
            </div>
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 200, position: 'relative', zIndex: 1 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, marginBottom: 2, letterSpacing: '-0.3px' }}>{profile.name}</h1>
            {profile.x_username && (<p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 8 }}>@{profile.x_username}</p>)}
            {profile.bio && (<p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, maxWidth: 420, marginBottom: 12 }}>{profile.bio}</p>)}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(6,18,38,0.6)', backdropFilter: 'blur(12px)', padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-default)', transition: 'border-color 0.2s', marginBottom: 8 }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(90,138,176,0.4)')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)')}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.04em' }}>{shortAddress(wallet ?? '')}</span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#4ade80' : 'var(--text-tertiary)', fontSize: 13, display: 'flex', alignItems: 'center', padding: 0, transition: 'color 0.2s' }} onClick={handleCopy} title="Copy address">{copied ? '✓' : '⎘'}</button>
            </div>
            {mintedAtDisplay && (<div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Member since {mintedAtDisplay}</div>)}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0, position: 'relative', zIndex: 1 }}>
            {[
              { label: '↗ Share Stats on X', onClick: handleShareStats, color: 'var(--text-secondary)', border: 'var(--border-default)', hoverBorder: 'rgba(90,138,176,0.5)', hoverBg: 'rgba(90,138,176,0.08)', isRed: false },
              { label: '— Edit Profile', onClick: () => setShowEdit(true), color: 'var(--text-secondary)', border: 'var(--border-default)', hoverBorder: 'rgba(90,138,176,0.5)', hoverBg: 'rgba(90,138,176,0.08)', isRed: false },
              { label: 'Disconnect', onClick: handleDisconnect, color: '#f87171', border: 'rgba(248,113,113,0.3)', hoverBorder: 'rgba(248,113,113,0.55)', hoverBg: 'rgba(248,113,113,0.08)', isRed: true },
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', color: btn.color, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '10px 18px', borderRadius: 10, border: '1px solid ' + btn.border, cursor: 'pointer', transition: 'all 0.2s ease', whiteSpace: 'nowrap' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = btn.hoverBorder; (e.currentTarget as HTMLElement).style.background = btn.hoverBg }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = btn.border; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4 Stat Boxes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
          {statCards.map((s, i) => (
            <div key={s.label} style={{ background: 'rgba(6,18,38,0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(54,97,132,0.2)', borderRadius: 14, padding: '22px 20px', position: 'relative', overflow: 'hidden', transition: 'transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease', animation: 'fadeInUp 400ms ease ' + (i * 60) + 'ms both' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(90,138,176,0.5)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 28px rgba(54,97,132,0.22), 0 0 0 1px rgba(90,138,176,0.2)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(54,97,132,0.2)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}>
              <div style={{ position: 'absolute', top: 0, right: 0, width: 60, height: 60, background: 'rgba(90,138,176,0.07)', borderRadius: '0 0 0 100%', transform: 'translate(30px, -30px)' }} />
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>{s.label}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 'clamp(14px, 2vw, 24px)', fontWeight: 700, color: s.color, lineHeight: 1, whiteSpace: 'nowrap' }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 32, borderBottom: '1px solid var(--border-subtle)', marginBottom: 28 }}>
          {(['calls', 'badges'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`profile-tab-btn${tab === t ? ' active' : ''}`}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                boxShadow: 'none',
                WebkitAppearance: 'none',
                borderBottom: '2px solid ' + (tab === t ? 'var(--accent-bright)' : 'transparent'),
                color: tab === t ? 'var(--accent-bright)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 600,
                padding: '0 0 16px',
                cursor: 'pointer',
                transition: 'color 0.2s ease, border-color 0.2s ease',
              }}
            >
              {t === 'calls' ? 'My Calls' : 'Badges'}
            </button>
          ))}
        </div>

        {tab === 'calls' && (
          <MyCalls
            bets={bets}
            betTitles={betTitles}
            betsHasMore={betsHasMore}
            chainStates={chainStates}
            claimingId={claimingId}
            onClaim={handleClaim}
            onLoadMore={() => { const next = betsPage + 1; setBetsPage(next); loadBets(next) }}
          />
        )}
        {tab === 'badges' && <BadgesTab address={wallet ?? ''} sessionWallet={sessionWallet} betCount={betCount} />}
      </main>

      <Footer />

      <EditProfileModal isOpen={showEdit} onClose={() => { setShowEdit(false); refreshProfile() }} initialName={profile.name} initialBio={profile.bio ?? ''} initialX={profile.x_username ?? ''} initialPfpUrl={profile.pfp_url ?? ''} />

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse-dot { 0%, 100% { box-shadow: 0 0 0 0 rgba(74,222,128,0.6); } 50% { box-shadow: 0 0 0 5px rgba(74,222,128,0); } }
      `}</style>
    </div>
  )
}
