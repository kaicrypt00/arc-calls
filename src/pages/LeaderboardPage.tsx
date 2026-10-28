import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, type DbLeaderboard } from '../lib/supabase'
import { useDataCache } from '../contexts/DataPrefetchContext'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

function truncate(addr: string) {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

interface ArenaStats {
  totalVolume: number
  callsMade: number
  activeCallers: number
  largestWin: number
  callsResolved: number
}

/* ── Arena Stat Card ── */
function ArenaStatCard({
  icon,
  label,
  value,
  loading,
  accent,
}: {
  icon: string
  label: string
  value: string
  loading: boolean
  accent?: boolean
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: accent
          ? 'linear-gradient(135deg, rgba(14,58,107,0.5) 0%, rgba(6,30,60,0.7) 100%)'
          : 'rgba(6,24,48,0.7)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${accent ? 'rgba(90,138,176,0.45)' : 'rgba(54,97,132,0.25)'}`,
        borderRadius: 12,
        padding: '20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: 'default',
        textAlign: 'left',
        transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered
          ? accent
            ? '0 6px 24px rgba(90,138,176,0.35), 0 0 24px rgba(54,97,132,0.3), inset 0 0 16px rgba(90,138,176,0.1)'
            : '0 6px 24px rgba(54,97,132,0.3), 0 0 20px rgba(90,138,176,0.2), 0 0 1px rgba(168,204,232,0.3)'
          : accent
          ? '0 0 20px rgba(54,97,132,0.2), inset 0 0 16px rgba(90,138,176,0.08)'
          : 'none',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-body, "Inter", sans-serif)',
        fontSize: 11,
        fontWeight: 600,
        color: accent ? 'var(--text-secondary)' : 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: 1.5,
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 'clamp(18px, 2.5vw, 28px)',
        fontWeight: 700,
        color: accent ? 'var(--accent-bright, #a8cce8)' : 'var(--text-primary)',
        lineHeight: 1,
        textShadow: accent ? '0 0 12px rgba(90,138,176,0.4)' : 'none',
      }}>
        {loading ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : value}
      </div>
    </div>
  )
}

/* ── Podium Card (top 3) ── */
function PodiumCard({ entry, rank, isFirst }: { entry: DbLeaderboard; rank: number; isFirst?: boolean }) {
  const [hovered, setHovered] = useState(false)

  const rankStyles = {
    1: {
      color:    '#E4E8EC',
      colorRgb: '228,232,236',
      border:   'rgba(90,138,176,0.65)',
      bg:       'linear-gradient(155deg, rgba(14,58,107,0.55) 0%, rgba(4,20,52,0.95) 50%, rgba(2,11,28,0.98) 100%)',
      badgeBg:  'rgba(6,20,44,0.95)',
      shadow:   '0 0 36px rgba(54,97,132,0.22)',
      glow:     '0 0 16px rgba(90,138,176,0.45)',
      label:    '★ Rank 1',
    },
    2: {
      color:    '#8aadcc',
      colorRgb: '138,173,204',
      border:   'rgba(54,97,132,0.4)',
      bg:       'linear-gradient(155deg, rgba(8,36,70,0.35) 0%, rgba(4,20,52,0.92) 55%, rgba(2,11,28,0.96) 100%)',
      badgeBg:  'rgba(6,20,44,0.95)',
      shadow:   '0 0 24px rgba(54,97,132,0.12)',
      glow:     'none',
      label:    '· Rank 2',
    },
    3: {
      color:    '#6a8fa8',
      colorRgb: '106,143,168',
      border:   'rgba(54,97,132,0.3)',
      bg:       'linear-gradient(155deg, rgba(6,24,48,0.25) 0%, rgba(4,20,52,0.9) 55%, rgba(2,11,28,0.95) 100%)',
      badgeBg:  'rgba(6,20,44,0.95)',
      shadow:   '0 0 16px rgba(54,97,132,0.08)',
      glow:     'none',
      label:    '· Rank 3',
    },
  }[rank as 1 | 2 | 3]

  const avatarSize = isFirst ? 112 : 80
  const nameSize   = isFirst ? 22  : 17
  const pnlSize    = isFirst ? 28  : 20
  const pnl        = Number(entry.total_pnl ?? 0)
  const rawWinRate = Number(entry.win_rate ?? 0)
  const winRate    = (rawWinRate > 1 ? rawWinRate : rawWinRate * 100).toFixed(1)
  const name       = entry.name || truncate(entry.wallet_address)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: 16,
        boxShadow: rankStyles.shadow,
        animation: isFirst ? 'lb-rank1-glow 2.8s ease-in-out infinite' : 'none',
        transition: 'transform 0.25s ease',
        transform: hovered ? 'translateY(-5px)' : 'translateY(0)',
      }}
    >
      {/* Rank pill sitting centred at the very top of the card, half overlapping the border */}
      <div style={{
        position:   'absolute',
        top:        -14,
        left:       '50%',
        transform:  'translateX(-50%)',
        background: rankStyles.badgeBg,
        color:      rankStyles.color,
        fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
        fontSize:   isFirst ? 13 : 11,
        fontWeight: 700,
        padding:    isFirst ? '6px 18px' : '4px 14px',
        borderRadius: 999,
        border:     `1px solid ${rankStyles.border}`,
        whiteSpace: 'nowrap',
        boxShadow:  rankStyles.glow,
        letterSpacing: '0.05em',
        zIndex:     10,
        display:    'inline-flex',
        alignItems: 'center',
        gap:        4,
      }}>
        {rankStyles.label}
      </div>

      <div
        style={{
          background:     rankStyles.bg,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border:         `1px solid ${rankStyles.border}`,
          borderRadius:   16,
          padding:        isFirst ? '36px 32px' : '28px 24px',
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          textAlign:      'center',
          position:       'relative',
          zIndex:         1,
        }}
      >
        {/* Corner radiance for Rank 1 */}
        {isFirst && (
          <div style={{
            position: 'absolute', top: 0, right: 0, width: 130, height: 130,
            background: `radial-gradient(circle at top right, rgba(${rankStyles.colorRgb},0.18), transparent 65%)`,
            pointerEvents: 'none', borderRadius: '0 15px 0 0',
          }} />
        )}

        {/* Avatar */}
        <div style={{
          width:        avatarSize,
          height:       avatarSize,
          borderRadius: '50%',
          border:       `${isFirst ? 2 : 1}px solid ${rankStyles.border}`,
          overflow:     'hidden',
          background:   'rgba(4,20,52,0.9)',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          fontFamily:   'var(--font-display, "Space Grotesk", sans-serif)',
          fontWeight:   700,
          fontSize:     Math.round(avatarSize * 0.35),
          color:        rankStyles.color,
          marginTop:    12,
          marginBottom: 16,
          flexShrink:   0,
          boxShadow:    isFirst ? `0 0 24px rgba(${rankStyles.colorRgb},0.3)` : rank === 2 ? `0 0 10px rgba(${rankStyles.colorRgb},0.12)` : 'none',
        }}>
          {entry.pfp_url
            ? <img src={entry.pfp_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (name[0]?.toUpperCase() || '?')
          }
        </div>

        {/* Username */}
        <div style={{
          fontFamily:   'var(--font-display, "Space Grotesk", sans-serif)',
          fontSize:     nameSize,
          fontWeight:   700,
          color:        rankStyles.color,
          marginBottom: 4,
          maxWidth:     '100%',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          {name}{entry.is_agent ? ' 🤖' : ''}
        </div>

        {/* Win Rate */}
        <div style={{
          fontFamily:   'var(--font-body, "Inter", sans-serif)',
          fontSize:     13,
          color:        'var(--text-secondary)',
          marginBottom: 20,
        }}>
          Win Rate: {winRate}%
        </div>

        {/* Divider */}
        <div style={{
          width: '100%', height: 1,
          background: `linear-gradient(90deg, transparent, ${rankStyles.border}, transparent)`,
          marginBottom: 16,
        }} />

        {/* TOTAL PNL */}
        <div style={{
          fontFamily:    'var(--font-mono, monospace)',
          fontSize:      11,
          color:         `rgba(${rankStyles.colorRgb},0.6)`,
          textTransform: 'uppercase',
          letterSpacing: 2,
          marginBottom:  6,
        }}>
          TOTAL PNL
        </div>
        <div style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize:   pnlSize,
          fontWeight: 700,
          color:      pnl >= 0 ? rankStyles.color : 'rgba(239,68,68,0.85)',
          textShadow: isFirst ? `0 0 12px rgba(${rankStyles.colorRgb},0.4)` : 'none',
        }}>
          {pnl >= 0 ? '+' : ''}{pnl.toFixed(3)} USDC
        </div>
      </div>
    </div>
  )
}

/* ── Table Row for ranks 4–10+ ── */
function TableRow({ entry, rank }: { entry: DbLeaderboard; rank: number }) {
  const pnl = Number(entry.total_pnl ?? 0)
  const name = entry.name || truncate(entry.wallet_address)
  const rawWinRate = Number(entry.win_rate ?? 0)
  const winRate = (rawWinRate > 1 ? rawWinRate : rawWinRate * 100).toFixed(0)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '52px 1fr 80px 70px 80px 100px 120px',
        gap: 0,
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        alignItems: 'center',
        transition: 'background 0.2s ease',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(54,97,132,0.1)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Rank # */}
      <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-tertiary)' }}>
        {rank}
      </span>

      {/* Player */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden' }}>
        <div style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: 'rgba(6,30,60,0.8)',
          border: '1px solid var(--border-default)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
          fontWeight: 700,
          fontSize: 12,
          color: 'var(--accent-bright, #a8cce8)',
          flexShrink: 0,
        }}>
          {entry.pfp_url
            ? <img src={entry.pfp_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (name[0]?.toUpperCase() || '?')
          }
        </div>
        <div style={{ overflow: 'hidden', minWidth: 0 }}>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {name}{entry.is_agent ? ' 🤖' : ''}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {truncate(entry.wallet_address)}
          </div>
        </div>
      </div>

      {/* Calls */}
      <span className="mono" style={{ fontSize: 13, textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
        {entry.total_calls ?? 0}
      </span>

      {/* Wins */}
      <span className="mono" style={{ fontSize: 13, textAlign: 'right', color: 'var(--text-secondary)' }}>
        {entry.wins ?? 0}
      </span>

      {/* Rate */}
      <span className="mono" style={{ fontSize: 13, textAlign: 'right', color: 'var(--text-secondary)' }}>
        {winRate}%
      </span>

      {/* Volume */}
      <span className="mono" style={{ fontSize: 12, textAlign: 'right', color: 'var(--text-tertiary)' }}>
        {Number(entry.total_volume ?? 0).toFixed(2)}
      </span>

      {/* P&L */}
      <span className="mono" style={{
        fontSize: 13,
        textAlign: 'right',
        fontWeight: 700,
        color: pnl >= 0 ? 'var(--yes-color)' : 'var(--no-color)',
      }}>
        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
      </span>
    </div>
  )
}

/* ── Main Page ── */
export default function LeaderboardPage() {
  const navigate = useNavigate()
  const { leaderboard: cachedLeaderboard, refetchLeaderboard } = useDataCache()
  const [resolved, setResolved] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    if (cachedLeaderboard === null) refetchLeaderboard()
    supabase.from('predictions_display').select('*', { count: 'exact', head: true })
      .in('status', ['yes_wins', 'no_wins'])
      .then(({ count }) => { setResolved(count ?? 0); setStatsLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lbData = (cachedLeaderboard ?? []).filter(e => Number(e.total_calls ?? 0) > 0 && Number(e.total_pnl ?? 0) > 0)
  const entries: DbLeaderboard[] = lbData
  const stats: ArenaStats = {
    totalVolume:   lbData.reduce((s, e) => s + Number(e.total_volume ?? 0), 0),
    callsMade:     lbData.reduce((s, e) => s + Number(e.total_calls ?? 0), 0),
    activeCallers: lbData.length,
    largestWin:    Math.max(0, lbData.reduce((max, e) => Math.max(max, Number(e.total_pnl ?? 0)), 0)),
    callsResolved: resolved,
  }
  const loading = statsLoading || cachedLeaderboard === null
  const top3 = entries.slice(0, 3)
  const rest = entries.slice(3)

  return (
    <div className="page" style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes lb-rank1-glow {
          0%,100% { box-shadow: 0 0 18px rgba(54,97,132,0.12); }
          50%      { box-shadow: 0 0 38px rgba(90,138,176,0.32); }
        }
      `}</style>

      <Navbar />

      <main style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '32px 20px 80px',
        position: 'relative',
        zIndex: 10,
        flex: 1,
        width: '100%',
      }}>
        {/* Back button */}
        <button
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-body, "Inter", sans-serif)',
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
            marginBottom: 28,
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          onClick={() => navigate('/calls')}
        >
          ← Back to Markets
        </button>

        {/* THE ARENA heading — standalone, matching Rialo Calls */}
        <h1 style={{
          fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
          fontSize: 'clamp(32px, 5vw, 48px)',
          fontWeight: 700,
          color: 'var(--text-primary, #E4E8EC)',
          marginBottom: 32,
          letterSpacing: -1,
        }}>
          THE ARENA
        </h1>

        {/* ─── 5 Stats in a single horizontal row ─── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
          marginBottom: 52,
        }}>
          <ArenaStatCard icon="💰" label="TOTAL VOL" value={`${stats.totalVolume.toFixed(1)} USDC`} loading={loading} accent />
          <ArenaStatCard icon="🎯" label="CALLS MADE" value={stats.callsMade.toString()} loading={loading} />
          <ArenaStatCard icon="🔥" label="ACTIVE CALLERS" value={stats.activeCallers.toString()} loading={loading} />
          <ArenaStatCard icon="🏆" label="LARGEST WIN" value={`${stats.largestWin.toFixed(1)} USDC`} loading={loading} />
          <ArenaStatCard icon="⚔️" label="CALLS RESOLVED" value={stats.callsResolved.toString()} loading={loading} accent />
        </div>

        {/* ─── TOP CALLERS heading ─── */}
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
          <h2 style={{
            fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            margin: 0,
          }}>
            TOP CALLERS
          </h2>
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, var(--border-default), transparent)' }} />
          {!loading && entries.length > 0 && <span className="section-label">{entries.length} callers</span>}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="skeleton" style={{ height: 64, borderRadius: 12 }} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          /* Empty state matching requirement */
          <div style={{
            background: 'rgba(6,18,38,0.6)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 16,
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            textAlign: 'center',
            padding: '80px 24px',
          }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>⚔️</div>
            <div style={{
              fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 8,
            }}>
              The Arena is Empty
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
              Be the first to make a call and claim your throne.
            </div>
          </div>
        ) : (
          <>
            {/* Top 3 Podium Cards */}
            {top3.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: top3.length === 1
                  ? 'minmax(320px, 480px)'
                  : top3.length === 2
                    ? 'repeat(2, minmax(300px, 440px))'
                    : '2fr 1.5fr 1.5fr',
                justifyContent: top3.length < 3 ? 'center' : 'stretch',
                gap: 20,
                marginTop: 20,
                marginBottom: 36,
                alignItems: 'start',
              }}>
                {top3.map((entry, idx) => (
                  <PodiumCard key={entry.wallet_address} entry={entry} rank={(idx + 1) as 1 | 2 | 3} isFirst={idx === 0} />
                ))}
              </div>
            )}

            {/* Rank 4+ table */}
            {rest.length > 0 && (
              <div style={{
                background: 'rgba(4,20,52,0.65)',
                border: '1px solid var(--border-default)',
                borderRadius: 16,
                overflow: 'hidden',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
              }}>
                {/* Table Header */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '52px 1fr 80px 70px 80px 100px 120px',
                  padding: '12px 20px',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'rgba(6,30,60,0.5)',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                }}>
                  <span>#</span>
                  <span>Player</span>
                  <span style={{ textAlign: 'right' }}>Calls</span>
                  <span style={{ textAlign: 'right' }}>Wins</span>
                  <span style={{ textAlign: 'right' }}>Rate</span>
                  <span style={{ textAlign: 'right' }}>Volume</span>
                  <span style={{ textAlign: 'right' }}>P&amp;L</span>
                </div>

                {/* Table Rows */}
                {rest.map((e, i) => (
                  <TableRow key={e.wallet_address} entry={e} rank={i + 4} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}
