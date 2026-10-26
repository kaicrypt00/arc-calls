import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useSessionWallet, publicClient } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { supabase, type DbBet } from '../lib/supabase'
import { BETTING_POOL_ADDRESS } from '../constants'
import { BETTING_POOL_ABI } from '../abis'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BadgesTab from '../components/BadgesTab'
import EditProfileModal from '../components/EditProfileModal'
import { buildXShareUrl } from '../utils/format'
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
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 340, lineHeight: 1.8 }}>
        Connect and set up a profile to view this page.
      </div>
      <ConnectButton label="Connect Wallet" showBalance={false} chainStatus="none" />
    </div>
  )
}

function GateActivate({ isCreating, createSessionWallet }: { isCreating: boolean; createSessionWallet: () => void }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 52 }}>⚡</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Activate Arc Calls Wallet</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 380, lineHeight: 1.8 }}>
        Sign a one-time message to generate your seamless session wallet. No gas needed — just a signature.
      </div>
      <button onClick={createSessionWallet} disabled={isCreating} style={{
        background: 'linear-gradient(135deg, #062a51, #0d4a8a)',
        color: 'var(--text-primary)', border: '1px solid rgba(90,138,176,0.4)',
        borderRadius: 12, padding: '14px 44px', fontSize: 15, fontWeight: 700,
        cursor: isCreating ? 'not-allowed' : 'pointer', opacity: isCreating ? 0.7 : 1,
        boxShadow: '0 4px 20px rgba(54,97,132,0.3)',
      }}>
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
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.8 }}>
        Mint your Arc Calls profile to enter the arena and start tracking your calls.
      </div>
      <button onClick={onSetUp} style={{
        background: 'linear-gradient(135deg, #062a51, #0d4a8a)',
        color: 'var(--text-primary)', border: '1px solid rgba(90,138,176,0.4)',
        borderRadius: 12, padding: '13px 40px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
        boxShadow: '0 4px 20px rgba(54,97,132,0.3)',
      }}>
        Set Up Profile
      </button>
    </div>
  )
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { sessionWallet, usdcBalance, hasSessionWallet, createSessionWallet, isCreating, loadBalances, clearSessionWallet } = useSessionWallet()
  const { profile, setShowMintModal } = useProfile()

  const [tab, setTab] = useState<'calls' | 'badges'>('calls')
  const [bets, setBets] = useState<DbBet[]>([])
  const [betTitles, setBetTitles] = useState<Record<number, string>>({})
  const [betCount, setBetCount] = useState(0)
  const [wins, setWins] = useState(0)
  const [pnl, setPnl] = useState(0)
  const [betsPage, setBetsPage] = useState(0)
  const [betsHasMore, setBetsHasMore] = useState(false)
  const [claimableMap, setClaimableMap] = useState<Record<string, string>>({})
  const [copiedSW, setCopiedSW] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  const wallet = sessionWallet?.address ?? address

  // Load bets with pagination
  const loadBets = useCallback(async (page: number) => {
    if (!wallet) return
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    // Check localStorage stats cache
    const cacheKey = `arc_profile_stats_${wallet.toLowerCase()}`
    if (page === 0) {
      try {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const { betCount: bc, wins: w, pnl: p, ts } = JSON.parse(cached) as { betCount: number; wins: number; pnl: number; ts: number }
          if (Date.now() - ts < STATS_CACHE_TTL) {
            setBetCount(bc); setWins(w); setPnl(p)
          }
        }
      } catch { /* ignore */ }
    }

    const { data } = await supabase
      .from('bets')
      .select('*')
      .eq('wallet_address', wallet.toLowerCase())
      .order('created_at', { ascending: false })
      .range(from, to)

    if (!data) return

    if (page === 0) {
      setBets(data as DbBet[])
      // Count all bets for stats
      const { count } = await supabase.from('bets').select('*', { count: 'exact', head: true }).eq('wallet_address', wallet.toLowerCase())
      const allBets = count ?? 0
      const { data: allData } = await supabase.from('bets').select('result,amount,payout').eq('wallet_address', wallet.toLowerCase())
      if (allData) {
        const w = (allData as { result: string; amount: string; payout: string }[]).filter(b => b.result === 'won').length
        const p = (allData as { result: string; amount: string; payout: string }[]).reduce((s, b) => s + Number(b.payout ?? 0) - Number(b.amount ?? 0), 0)
        setBetCount(allBets); setWins(w); setPnl(p)
        try { localStorage.setItem(cacheKey, JSON.stringify({ betCount: allBets, wins: w, pnl: p, ts: Date.now() })) } catch { /* ignore */ }
      }
    } else {
      setBets(prev => [...prev, ...(data as DbBet[])])
    }
    setBetsHasMore(data.length === PAGE_SIZE)

    // Fetch prediction titles in a single batched query
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

  // Check claimable amounts for each bet
  const checkClaimable = useCallback(async (betsToCheck: DbBet[]) => {
    if (!sessionWallet) return
    const pending = betsToCheck.filter(b => b.result === 'pending')
    const map: Record<string, string> = {}
    await Promise.all(pending.map(async b => {
      try {
        const amt = await publicClient.readContract({
          address: BETTING_POOL_ADDRESS,
          abi: BETTING_POOL_ABI,
          functionName: 'getClaimableAmount',
          args: [BigInt(b.prediction_id), sessionWallet.address],
        })
        const formatted = formatUnits(amt, USDC_DECIMALS)
        if (parseFloat(formatted) > 0) map[String(b.prediction_id)] = formatted
      } catch { /* ignore */ }
    }))
    setClaimableMap(map)
  }, [sessionWallet])

  useEffect(() => {
    if (bets.length > 0) checkClaimable(bets)
  }, [bets, checkClaimable])

  const handleDisconnect = () => {
    disconnect()
    clearSessionWallet()
    navigate('/')
  }

  const winRate = betCount > 0 ? ((wins / betCount) * 100).toFixed(0) : '0'
  const copySW = () => {
    if (sessionWallet) navigator.clipboard.writeText(sessionWallet.address)
    setCopiedSW(true); setTimeout(() => setCopiedSW(false), 1400)
  }

  /* ── Gates ── */
  if (!isConnected) return <div className="page"><Navbar /><GateConnect /><Footer /></div>
  if (!hasSessionWallet) return <div className="page"><Navbar /><GateActivate isCreating={isCreating} createSessionWallet={createSessionWallet} /><Footer /></div>
  if (!profile) return (
    <div className="page">
      <Navbar />
      <GateNoProfile onSetUp={() => setShowMintModal(true)} />
      <Footer />
    </div>
  )

  const statCards = [
    { label: 'Total Calls', value: betCount,                                        color: 'var(--text-primary)',  icon: '🎯' },
    { label: 'Wins',        value: wins,                                             color: 'var(--yes-color)',     icon: '🏆' },
    { label: 'Win Rate',    value: `${winRate}%`,                                   color: 'var(--accent-bright)', icon: '📊' },
    { label: 'P&L',         value: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDC`, color: pnl >= 0 ? 'var(--yes-color)' : 'var(--no-color)', icon: '💰' },
  ]

  return (
    <div style={{ position: 'relative', minHeight: '100dvh' }}>
      {/* Ambient background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 30% 20%, rgba(54,97,132,0.12) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(54,97,132,0.08) 0%, transparent 50%)',
        filter: 'blur(40px)',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <Navbar />

        <div className="container" style={{ padding: '24px 20px 0', maxWidth: 820 }}>
          <button className="back-btn" onClick={() => navigate('/calls')}>← Back to Calls</button>
        </div>

        {/* Profile hero card */}
        <div className="container" style={{ padding: '16px 20px', maxWidth: 820 }}>
          <div
            className="glass-card profile-hero-section"
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(223,219,207,0.3)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(54,97,132,0.25)' }}
          >
            {/* Gradient overlay */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(54,97,132,0.08) 0%, transparent 60%)', pointerEvents: 'none', borderRadius: 'inherit' }} />

            <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap', position: 'relative' }}>
              {/* Avatar with gradient ring */}
              <div style={{ padding: 3, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(223,219,207,0.8), rgba(62,223,174,0.6), transparent)', display: 'inline-block', flexShrink: 0 }}>
                {profile.pfp_url
                  ? <img src={profile.pfp_url} alt="" style={{ width: 140, height: 140, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: 140, height: 140, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-blue), #010d1f)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {profile.name.charAt(0).toUpperCase()}
                    </div>
                }
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.3px', fontFamily: 'var(--font-display)' }}>{profile.name}</div>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'pulse-dot 2s ease infinite' }} />
                </div>
                {profile.bio && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6, maxWidth: 420 }}>{profile.bio}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {profile.x_username && (
                    <a href={`https://x.com/${profile.x_username}`} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'var(--accent-bright)', background: 'rgba(90,138,176,0.1)', border: '1px solid rgba(90,138,176,0.2)', borderRadius: 20, padding: '3px 10px', textDecoration: 'none' }}>
                      𝕏 @{profile.x_username}
                    </a>
                  )}
                  <button
                    onClick={() => setShowEdit(true)}
                    className="btn-primary" style={{ fontSize: 11, padding: '4px 14px' }}>
                    Edit Profile
                  </button>
                  <a
                    href={buildXShareUrl(`I've made ${betCount} calls on Arc Calls with a ${winRate}% win rate 🎯\nJoin me: https://arccalls.xyz`)}
                    target="_blank" rel="noopener noreferrer"
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: '4px 14px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    𝕏 Share Stats
                  </a>
                </div>
              </div>

              {/* Disconnect — profile page only */}
              <button onClick={handleDisconnect} className="btn-danger" style={{ flexShrink: 0, fontSize: 12 }}>
                Disconnect
              </button>
            </div>
          </div>
        </div>

        <div className="container" style={{ padding: '16px 20px', maxWidth: 820 }}>

          {/* Arc Calls Wallet card */}
          {sessionWallet && (
            <div className="glass-card" style={{ padding: '20px 22px', marginBottom: 16, background: 'linear-gradient(135deg, rgba(6,30,60,0.8) 0%, rgba(6,42,81,0.5) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 1, fontFamily: 'var(--font-display)' }}>Arc Calls Wallet</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Your seamless betting wallet</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'pulse-dot 2s ease infinite' }} />
                  <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>Active</span>
                  <button onClick={loadBalances} style={{ background: 'rgba(90,138,176,0.1)', border: '1px solid rgba(90,138,176,0.2)', color: 'var(--text-secondary)', fontSize: 13, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}>↻</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180, padding: '14px 16px', background: 'rgba(6,18,38,0.5)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Address</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all', color: 'var(--text-primary)', lineHeight: 1.7 }}>{sessionWallet.address}</div>
                  <button onClick={copySW} style={{ background: 'none', color: 'var(--accent-bright)', fontSize: 11, marginTop: 8, padding: 0, border: 'none', cursor: 'pointer' }}>
                    {copiedSW ? '✓ Copied!' : '⎘ Copy'}
                  </button>
                </div>
                <div style={{ padding: '14px 20px', background: 'rgba(6,18,38,0.5)', borderRadius: 12, border: '1px solid var(--border-subtle)', minWidth: 140 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>USDC Balance</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{usdcBalance}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>Gas &amp; Betting · Arc</div>
                </div>
              </div>
            </div>
          )}

          {/* Unclaimed winnings banner */}
          {Object.keys(claimableMap).length > 0 && (() => {
            const total = Object.values(claimableMap).reduce((s, v) => s + parseFloat(v), 0)
            return (
              <div className="unclaimed-banner" style={{ marginBottom: 18 }}>
                <span style={{ fontSize: 22 }}>🏆</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f0c040' }}>
                    You have {total.toFixed(2)} USDC to claim!
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(240,192,64,0.7)', marginTop: 2 }}>
                    Head to your calls below and claim your winnings.
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 22 }}>
            {statCards.map((s, i) => (
              <div key={s.label} className="glass-card" style={{ padding: '16px 18px', textAlign: 'center', animation: `fadeInUp 400ms ease ${i * 60}ms both` }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="calls-tab-nav" style={{ marginBottom: 20 }}>
            {(['calls', 'badges'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className={tab === t ? 'active' : ''}>
                {t === 'calls' ? 'My Calls' : 'Badges'}
              </button>
            ))}
          </div>

          {/* My Calls tab */}
          {tab === 'calls' && (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              {bets.length === 0 ? (
                <div style={{ padding: 56, textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>No Calls Yet</div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Head to Calls to place your first call!</div>
                </div>
              ) : (
                <>
                  {bets.map((b, i) => (
                    <div key={b.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 60px 90px 70px 52px',
                      padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)',
                      alignItems: 'center', gap: 10, transition: 'background 150ms',
                      animation: `fadeIn 250ms ease ${Math.min(i * 20, 200)}ms both`,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(54,97,132,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                        {betTitles[b.prediction_id] ? betTitles[b.prediction_id].slice(0, 60) : `Prediction #${b.prediction_id}`}
                      </span>
                      <span className={`badge ${String(b.side).toUpperCase() === 'YES' ? 'badge-yes' : 'badge-no'}`}>{String(b.side).toUpperCase()}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>{Number(b.amount).toFixed(2)} USDC</span>
                      <span style={{ fontSize: 12, textAlign: 'center', color: b.result === 'won' ? 'var(--yes-color)' : b.result === 'lost' ? 'var(--no-color)' : 'var(--pending)' }}>
                        {claimableMap[String(b.prediction_id)] ? (
                          <span style={{ color: '#4ade80', fontWeight: 700, cursor: 'pointer' }}>
                            Claim {parseFloat(claimableMap[String(b.prediction_id)]).toFixed(2)}
                          </span>
                        ) : b.result}
                      </span>
                      <a href={`${EXPLORER_URL}/tx/${b.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent-bright)', textAlign: 'center' }}>↗</a>
                    </div>
                  ))}
                  {betsHasMore && (
                    <div style={{ textAlign: 'center', padding: '16px' }}>
                      <button
                        onClick={() => { const next = betsPage + 1; setBetsPage(next); loadBets(next) }}
                        className="btn-secondary" style={{ fontSize: 12, padding: '7px 20px' }}
                      >
                        Load More
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Badges tab */}
          {tab === 'badges' && (
            <BadgesTab
              address={wallet ?? ''}
              sessionWallet={sessionWallet}
              betCount={betCount}
            />
          )}
        </div>

        <Footer />
      </div>

      {/* Edit profile modal */}
      <EditProfileModal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        initialName={profile.name}
        initialBio={profile.bio ?? ''}
        initialX={profile.x_username ?? ''}
        initialPfpUrl={profile.pfp_url ?? ''}
      />
    </div>
  )
}
