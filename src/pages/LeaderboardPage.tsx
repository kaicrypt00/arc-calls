import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useDataCache } from '../contexts/DataPrefetchContext'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

function truncate(addr: string) { return `${addr.slice(0, 6)}…${addr.slice(-4)}` }

const RANK_MEDAL = ['🥇', '🥈', '🥉']
const RANK_RING  = ['rank-gold', 'rank-silver', 'rank-bronze']
const RANK_COLOR = ['#f0c040', '#C0C0C0', '#CD7F32']
const RANK_ROW_BG = [
  'linear-gradient(90deg, rgba(240,192,64,0.06) 0%, transparent 60%)',
  'linear-gradient(90deg, rgba(192,192,192,0.04) 0%, transparent 60%)',
  'linear-gradient(90deg, rgba(205,127,50,0.04) 0%, transparent 60%)',
]

interface ArenaStats {
  totalVolume: number; callsMade: number; activeCallers: number; largestWin: number; callsResolved: number;
}

function ArenaStatCard({ icon, label, value, loading, delay }: { icon: string; label: string; value: string; loading: boolean; delay: number }) {
  return (
    <div className="stat-card" style={{ animation: `fadeInUp 500ms ease ${delay}ms both` }}>
      <div style={{ fontSize: 24, marginBottom: 10 }}>{icon}</div>
      <div className="mono" style={{
        fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 5,
        animation: loading ? 'none' : 'count-up 500ms ease',
      }}>
        {loading ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : value}
      </div>
      <div className="section-label">{label}</div>
    </div>
  )
}

export default function LeaderboardPage() {
  const navigate = useNavigate()
  const { leaderboard: cachedLeaderboard, refetchLeaderboard } = useDataCache()
  const [resolved, setResolved] = useState(0)
  // loading only gates the arena stat cards, not the leaderboard table
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    if (cachedLeaderboard === null) refetchLeaderboard()
    supabase.from('predictions_display').select('*', { count: 'exact', head: true })
      .in('status', ['yes_wins', 'no_wins'])
      .then(({ count }) => { setResolved(count ?? 0); setStatsLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lbData = (cachedLeaderboard ?? []).filter(e => Number(e.total_calls ?? 0) > 0)
  const entries = lbData
  const stats: ArenaStats = {
    totalVolume:   lbData.reduce((s, e) => s + Number(e.total_volume ?? 0), 0),
    callsMade:     lbData.reduce((s, e) => s + Number(e.total_calls ?? 0), 0),
    activeCallers: lbData.length,
    largestWin:    Math.max(0, lbData.reduce((max, e) => Math.max(max, Number(e.total_pnl ?? 0)), 0)),
    callsResolved: resolved,
  }

  const arenaCards = [
    { icon: '💰', label: 'Total Vol',        value: `${stats.totalVolume.toFixed(1)} USDC` },
    { icon: '🎯', label: 'Calls Made',       value: stats.callsMade.toString() },
    { icon: '🔥', label: 'Active Callers',   value: stats.activeCallers.toString() },
    { icon: '🏆', label: 'Largest Win',      value: `${stats.largestWin.toFixed(1)} USDC` },
    { icon: '⚔️', label: 'Calls Resolved',  value: stats.callsResolved.toString() },
  ]
  const loading = statsLoading || cachedLeaderboard === null

  return (
    <div className="page" style={{ position: 'relative', zIndex: 1 }}>
      <Navbar />

      <div className="container" style={{ paddingTop: 24 }}>
        <button className="back-btn" onClick={() => navigate('/calls')}>← Back to Calls</button>
      </div>

      {/* Hero header */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(54,97,132,0.12) 0%, transparent 100%)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '40px 20px 36px', textAlign: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background glow orb */}
        <div style={{
          position: 'absolute', width: 600, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(54,97,132,0.15) 0%, transparent 70%)',
          top: '-50%', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none',
        }} />
        <div className="section-label" style={{ marginBottom: 10 }}>⚔ Welcome to</div>
        <h1 style={{
          fontSize: 'clamp(48px, 9vw, 80px)', fontWeight: 700, letterSpacing: '-1px', lineHeight: 1,
          background: 'linear-gradient(135deg, #ffffff 0%, #E4E8EC 50%, #8E9FB0 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          animation: 'title-glow 4s ease infinite',
        }}>
          THE ARENA
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-tertiary)', marginTop: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.3px' }}>
          Rank up. Call it right. Earn glory.
        </p>
      </div>

      <div className="container" style={{ padding: '32px 20px' }}>

        {/* 5 Arena stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 40 }}>
          {arenaCards.map((s, i) => (
            <ArenaStatCard key={s.label} icon={s.icon} label={s.label} value={s.value} loading={loading} delay={i * 60} />
          ))}
        </div>

        {/* TOP CALLERS heading */}
        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            🏅 Top Callers
          </h2>
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, var(--border-default), transparent)' }} />
          {!loading && <span className="section-label">{entries.length} callers</span>}
        </div>

        {/* Podium — top 3 cards */}
        {!loading && entries.length >= 1 && (() => {
          const podiumOrder = entries.length >= 3
            ? [entries[1], entries[0], entries[2]]   // 2nd | 1st | 3rd
            : entries.length === 2
            ? [entries[1], entries[0]]
            : [entries[0]]
          const PODIUM_MEDALS = entries.length >= 3 ? ['🥈','🥇','🥉'] : entries.length === 2 ? ['🥈','🥇'] : ['🥇']
          const PODIUM_COLORS = entries.length >= 3
            ? [RANK_COLOR[1], RANK_COLOR[0], RANK_COLOR[2]]
            : entries.length === 2 ? [RANK_COLOR[1], RANK_COLOR[0]] : [RANK_COLOR[0]]
          const PODIUM_HEIGHT = entries.length >= 3 ? ['72px','96px','60px'] : ['72px','96px']
          const PODIUM_GLOW   = entries.length >= 3
            ? ['rgba(192,192,192,0.2)','rgba(240,192,64,0.25)','rgba(205,127,50,0.18)']
            : ['rgba(192,192,192,0.2)','rgba(240,192,64,0.25)']
          return (
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 12, marginBottom: 36, flexWrap: 'wrap' }}>
              {podiumOrder.map((e, pi) => {
                const realIdx = entries.indexOf(e)
                const pnl = Number(e.total_pnl ?? 0)
                const letter = (e.name ?? '?').charAt(0).toUpperCase()
                return (
                  <div key={e.wallet_address} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    animation: `fadeInUp 500ms ease ${pi * 80}ms both`,
                  }}>
                    <div style={{ fontSize: 22 }}>{PODIUM_MEDALS[pi]}</div>
                    {/* Avatar */}
                    <div style={{
                      width: realIdx === 0 ? 72 : 60, height: realIdx === 0 ? 72 : 60,
                      borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                      border: `2.5px solid ${PODIUM_COLORS[pi]}`,
                      boxShadow: `0 0 16px ${PODIUM_GLOW[pi]}`,
                    }}>
                      {e.pfp_url
                        ? <img src={e.pfp_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--accent-blue), #010d1f)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: realIdx === 0 ? 24 : 18, fontWeight: 700, color: 'var(--text-primary)' }}>{letter}</div>
                      }
                    </div>
                    {/* Name + PnL */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: PODIUM_COLORS[pi], maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.name ?? truncate(e.wallet_address)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {e.total_calls ?? 0} calls
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2, color: pnl >= 0 ? 'var(--yes-color)' : 'var(--no-color)' }}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDC
                      </div>
                    </div>
                    {/* Podium base */}
                    <div style={{
                      width: 110, height: PODIUM_HEIGHT[pi],
                      background: `linear-gradient(180deg, rgba(${PODIUM_COLORS[pi].replace(/[rgba()]/g,'').split(',').slice(0,3).join(',')},0.12) 0%, rgba(6,30,60,0.8) 100%)`,
                      border: `1px solid ${PODIUM_COLORS[pi]}33`,
                      borderRadius: '10px 10px 4px 4px',
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                      paddingTop: 8, fontSize: 13, fontWeight: 800, color: PODIUM_COLORS[pi],
                      boxShadow: `0 4px 20px ${PODIUM_GLOW[pi]}`,
                    }}>
                      #{realIdx + 1}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Table */}
        <div style={{ background: 'rgba(6,18,38,0.6)', border: '1px solid var(--border-default)', borderRadius: 18, overflow: 'hidden', backdropFilter: 'blur(20px)' }}>

          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '52px 1fr 80px 60px 80px 110px 110px',
            padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)',
            fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.8px',
            background: 'rgba(6,30,60,0.5)',
          }}>
            <span>#</span>
            <span>Player</span>
            <span style={{ textAlign: 'right' }}>Calls</span>
            <span style={{ textAlign: 'right' }}>Wins</span>
            <span style={{ textAlign: 'right' }}>Rate</span>
            <span style={{ textAlign: 'right' }}>Volume</span>
            <span style={{ textAlign: 'right' }}>P&amp;L</span>
          </div>

          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div className="spinner" style={{ width: 24, height: 24 }} />
              <span>Loading callers…</span>
            </div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 72, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>⚔️</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>The Arena is Empty</div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Be the first to make a call and claim your throne.</div>
            </div>
          ) : (
            entries.map((e, i) => {
              const pnl     = Number(e.total_pnl ?? 0)
              const isTop3  = i < 3
              const rowBg   = isTop3 ? RANK_ROW_BG[i] : 'transparent'
              return (
                <div key={e.wallet_address} style={{
                  display: 'grid', gridTemplateColumns: '52px 1fr 80px 60px 80px 110px 110px',
                  padding: '13px 20px', borderBottom: '1px solid var(--border-subtle)',
                  alignItems: 'center', background: rowBg, transition: 'background 200ms ease',
                  animation: `fadeIn 300ms ease ${Math.min(i * 30, 300)}ms both`,
                }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(54,97,132,0.12)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = rowBg)}
                >
                  {/* Rank */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {isTop3 ? (
                      <span style={{ fontSize: 18 }}>{RANK_MEDAL[i]}</span>
                    ) : (
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)' }}>{i + 1}</span>
                    )}
                  </div>

                  {/* Player */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, overflow: 'hidden' }}>
                    {e.pfp_url
                      ? <img src={e.pfp_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} className={isTop3 ? RANK_RING[i] : ''} />
                      : <div style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, var(--accent-blue), #010d1f)`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }} className={isTop3 ? RANK_RING[i] : ''}>👤</div>
                    }
                    <div style={{ overflow: 'hidden', minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, color: isTop3 ? RANK_COLOR[i] : 'var(--text-primary)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                        {e.is_agent && <span className="badge badge-bot" style={{ flexShrink: 0 }}>BOT</span>}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{truncate(e.wallet_address)}</div>
                    </div>
                  </div>

                  <span className="mono" style={{ fontSize: 13, textAlign: 'right', fontWeight: 700, color: isTop3 ? RANK_COLOR[i] : 'var(--text-primary)' }}>{e.total_calls}</span>
                  <span className="mono" style={{ fontSize: 13, textAlign: 'right', color: 'var(--text-secondary)' }}>{e.wins}</span>
                  <span className="mono" style={{ fontSize: 12, textAlign: 'right', color: 'var(--text-secondary)' }}>
                    {(Number(e.win_rate ?? 0) * 100).toFixed(0)}%
                  </span>
                  <span className="mono" style={{ fontSize: 12, textAlign: 'right', color: 'var(--text-tertiary)' }}>
                    {Number(e.total_volume ?? 0).toFixed(2)}
                  </span>
                  <span className="mono" style={{ fontSize: 13, textAlign: 'right', fontWeight: 700, color: pnl >= 0 ? 'var(--yes-color)' : 'var(--no-color)' }}>
                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}
