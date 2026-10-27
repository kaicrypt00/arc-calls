import { type DbPrediction } from '../lib/supabase'
import { calcOdds } from '../utils/format'

function SettledCard({ p }: { p: DbPrediction }) {
  const { yesPct, noPct } = calcOdds(Number(p.yes_pool), Number(p.no_pool))
  const isYes = p.status === 'yes_wins'
  const isRef = p.status === 'refunded'

  const winnerColor = isRef ? '#94a3b8' : isYes ? '#4ade80' : '#f87171'
  const winnerLabel = isRef ? '↩ REFUNDED' : isYes ? '🏆 YES WINS' : '🏆 NO WINS'
  const pillClass   = isRef ? 'status-refunded' : isYes ? 'status-settled-yes' : 'status-settled-no'
  const pillText    = isRef ? 'Refunded' : isYes ? 'YES Wins' : 'NO Wins'

  return (
    <div
      className="glass-card"
      style={{ overflow: 'hidden', transition: 'transform 200ms ease, box-shadow 200ms ease', cursor: 'default' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.4)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
    >
      {/* Banner */}
      <div style={{ height: 140, position: 'relative', overflow: 'hidden' }}>
        {p.banner_url
          ? <img src={p.banner_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, rgba(6,30,60,0.9) 0%, rgba(54,97,132,0.3) 100%)' }} />
        }
        <span className={`status-pill ${pillClass}`} style={{ position: 'absolute', top: 10, right: 10 }}>
          {pillText}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{p.title}</div>

        {/* Pool bar */}
        <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
          <div className="pool-bar-yes" style={{ width: `${yesPct}%`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{yesPct}%</div>
          <div className="pool-bar-no"  style={{ width: `${noPct}%`,  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{noPct}%</div>
        </div>

        <div style={{ fontWeight: 700, fontSize: 14, color: winnerColor }}>{winnerLabel}</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Pool: {(Number(p.yes_pool) + Number(p.no_pool)).toFixed(2)} USDC
          </div>
          {p.settled_at && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {new Date(p.settled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface SettledTabProps {
  predictions: DbPrediction[] | null
}

export default function SettledTab({ predictions }: SettledTabProps) {
  const settled = (predictions ?? [])
    .filter(p => p.status === 'yes_wins' || p.status === 'no_wins' || p.status === 'refunded')
    .sort((a, b) => new Date(b.settled_at ?? 0).getTime() - new Date(a.settled_at ?? 0).getTime())

  if (predictions === null) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="glass-card skeleton" style={{ height: 280 }} />
        ))}
      </div>
    )
  }

  if (settled.length === 0) {
    return (
      <div className="glass-card" style={{ textAlign: 'center', padding: '80px 24px', borderRadius: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 24, opacity: 0.6 }}>🏁</div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
          No settled calls yet
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, margin: 0 }}>
          Settled predictions will appear here once the admin declares a winner.
        </p>
      </div>
    )
  }

  const yesWins = settled.filter(p => p.status === 'yes_wins').length
  const noWins  = settled.filter(p => p.status === 'no_wins').length

  return (
    <>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Settled', value: settled.length },
          { label: 'YES Wins',      value: yesWins },
          { label: 'NO Wins',       value: noWins },
        ].map(s => (
          <div key={s.label} className="glass-card" style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
        {settled.map(p => <SettledCard key={p.id} p={p} />)}
      </div>
    </>
  )
}
