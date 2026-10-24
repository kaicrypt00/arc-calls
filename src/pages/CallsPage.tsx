import { useState, useEffect, useCallback } from 'react'
import { supabase, type DbPrediction } from '../lib/supabase'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import Ticker from '../components/Ticker'
import PredictionCard from '../components/PredictionCard'
import PollTab from '../components/PollTab'

type Tab = 'active' | 'all' | 'community' | 'official' | 'settled' | 'polls'

const TABS: { id: Tab; label: string }[] = [
  { id: 'active',    label: 'Active Calls'   },
  { id: 'all',       label: 'All Calls'      },
  { id: 'community', label: 'Community'      },
  { id: 'official',  label: 'Official'       },
  { id: 'settled',   label: 'Settled'        },
  { id: 'polls',     label: 'The Poll'       },
]

const HEADINGS: Record<Tab, string> = {
  active:    'Active Calls',
  all:       'All Calls',
  community: 'Community Calls',
  official:  'Official Calls',
  settled:   'Settled',
  polls:     'The Poll',
}

function SettledStats({ predictions }: { predictions: DbPrediction[] }) {
  const yesWins = predictions.filter(p => p.status === 'yes_wins').length
  const noWins  = predictions.filter(p => p.status === 'no_wins').length
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
      {[
        { icon: '🏁', label: 'Total Settled', value: predictions.length, color: 'var(--text-primary)' },
        { icon: '🏆', label: 'YES Wins',      value: yesWins,             color: 'var(--yes-color)' },
        { icon: '✗',  label: 'NO Wins',       value: noWins,              color: 'var(--no-color)' },
      ].map(s => (
        <div key={s.label} className="stat-card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', textAlign: 'left', flexDirection: 'row' }}>
          <span style={{ fontSize: 22 }}>{s.icon}</span>
          <div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div className="section-label" style={{ marginTop: 4 }}>{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function SettledTab({ predictions }: { predictions: DbPrediction[] }) {
  if (predictions.length === 0) return (
    <div style={{ textAlign: 'center', padding: 64 }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🏁</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>No Settled Markets</div>
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Active markets will appear here once resolved.</div>
    </div>
  )
  return (
    <>
      <SettledStats predictions={predictions} />
      <div className="grid-2">
        {predictions.map((p, i) => (
          <div key={p.id} className="card" style={{ padding: '18px 20px', animation: `fadeIn 300ms ease ${Math.min(i * 40, 300)}ms both` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 600, flex: 1, lineHeight: 1.4 }}>{p.title}</span>
              <span className={`badge ${p.status === 'yes_wins' ? 'badge-yes' : p.status === 'no_wins' ? 'badge-no' : 'badge-refund'}`}>
                {p.status === 'yes_wins' ? 'YES WINS' : p.status === 'no_wins' ? 'NO WINS' : 'REFUNDED'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
              <span className="mono" style={{ color: 'var(--yes-color)' }}>YES: {Number(p.yes_pool).toFixed(2)}</span>
              <span className="mono" style={{ color: 'var(--no-color)' }}>NO: {Number(p.no_pool).toFixed(2)}</span>
              <span style={{ color: 'var(--text-tertiary)', marginLeft: 'auto', fontSize: 11 }}>USDC</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export default function CallsPage() {
  const [tab, setTab]         = useState<Tab>('active')
  const [active, setActive]   = useState<DbPrediction[]>([])
  const [settled, setSettled] = useState<DbPrediction[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPredictions = useCallback(async () => {
    setLoading(true)
    const [{ data: act }, { data: set }] = await Promise.all([
      supabase.from('predictions_display').select('*').in('status', ['open', 'locked']).order('deadline', { ascending: true }),
      supabase.from('predictions_display').select('*').in('status', ['yes_wins', 'no_wins', 'refunded']).order('settled_at', { ascending: false }),
    ])
    if (act) setActive(act as DbPrediction[])
    if (set) setSettled(set as DbPrediction[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPredictions()
    const handler = () => fetchPredictions()
    window.addEventListener('arc-bet-placed', handler)
    return () => window.removeEventListener('arc-bet-placed', handler)
  }, [fetchPredictions])

  const displayActive = tab === 'community'
    ? active.filter(p => p.category === 'community_calls')
    : tab === 'official'
      ? active.filter(p => p.category === 'official_calls')
      : active

  const activeCount = active.length

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <Navbar />
      <Ticker />

      <div className="container" style={{ padding: '28px 20px', flex: 1 }}>

        {/* Page heading row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)', lineHeight: 1 }}>
              {HEADINGS[tab]}
            </h2>
            {tab !== 'settled' && tab !== 'polls' && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                {loading ? '…' : `${displayActive.length} market${displayActive.length !== 1 ? 's' : ''} active`}
              </div>
            )}
          </div>
          {activeCount > 0 && tab !== 'polls' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 20 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--yes-color)', display: 'inline-block', animation: 'pulse-dot 1.8s ease infinite' }} />
              <span style={{ fontSize: 11, color: 'var(--yes-color)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                {activeCount} LIVE
              </span>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="tab-bar" style={{ marginBottom: 28 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`tab-btn${tab === t.id ? ' active' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'polls' ? (
          <PollTab />
        ) : tab === 'settled' ? (
          loading
            ? <div className="grid-2">{[1,2].map(i => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 16 }} />)}</div>
            : <SettledTab predictions={settled} />
        ) : (
          loading ? (
            <div className="grid-2">
              {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 18 }} />)}
            </div>
          ) : displayActive.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 72 }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>
                {tab === 'community' ? '🌐' : tab === 'official' ? '⚡' : '🔥'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                No {tab === 'community' ? 'Community' : tab === 'official' ? 'Official' : 'Active'} Markets
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Check back soon — new calls drop regularly.</div>
            </div>
          ) : (
            <div className="grid-2">
              {displayActive.map(p => (
                <PredictionCard key={p.id} prediction={p} onUpdate={fetchPredictions} />
              ))}
            </div>
          )
        )}
      </div>

      <Footer />
    </div>
  )
}
