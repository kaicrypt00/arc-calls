import { type DbPrediction } from '../lib/supabase'
import PredictionCard from './PredictionCard'

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

  const yesWins  = settled.filter(p => p.status === 'yes_wins').length
  const noWins   = settled.filter(p => p.status === 'no_wins').length
  const refunded = settled.filter(p => p.status === 'refunded').length

  return (
    <>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Settled', value: settled.length },
          { label: 'YES Wins',      value: yesWins },
          { label: 'NO Wins',       value: noWins },
          { label: 'Refunded',      value: refunded },
        ].map(s => (
          <div key={s.label} className="glass-card" style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
        {settled.map(p => <PredictionCard key={p.id} prediction={p} />)}
      </div>
    </>
  )
}
