import { useState, useEffect, useCallback } from 'react'
import { supabase, type DbPrediction } from '../lib/supabase'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PredictionCard from '../components/PredictionCard'
import PollTab from '../components/PollTab'
import SettledTab from '../components/SettledTab'
import ErrorBoundary from '../components/ErrorBoundary'
import SoundToggleButton from '../components/SoundToggleButton'

type Tab = 'all_calls' | 'community_calls' | 'official_calls' | 'settled' | 'polls'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all_calls',       label: 'All Calls' },
  { id: 'community_calls', label: 'Community Calls' },
  { id: 'official_calls',  label: 'Official Calls' },
  { id: 'settled',         label: 'Settled' },
  { id: 'polls',           label: 'The Poll' },
]

const HEADINGS: Record<Tab, string> = {
  all_calls:       'Active Calls',
  community_calls: 'Community Calls',
  official_calls:  'Official Calls',
  settled:         'Settled',
  polls:           'The Poll',
}

const SETTLED_STATUSES = ['yes_wins', 'no_wins', 'refunded']

export default function CallsPage() {
  const [tab, setTab]                   = useState<Tab>('all_calls')
  const [predictions, setPredictions]   = useState<DbPrediction[] | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(4)

  useEffect(() => { setVisibleCount(4) }, [tab])

  const fetchPredictions = useCallback(async () => {
    setError(null)

    // Primary: predictions_display view
    const { data, error: err } = await supabase
      .from('predictions_display')
      .select('*')
      .order('created_at', { ascending: false })

    console.log('[CallsPage] predictions_display →', data?.length ?? 0, 'rows, err:', err?.message ?? 'none')

    // If view returned data (even empty) with no error, use it
    if (!err) {
      // Try raw predictions table as fallback if view is empty
      if (!data || data.length === 0) {
        const { data: rawData, error: rawErr } = await supabase
          .from('predictions')
          .select('*')
          .order('created_at', { ascending: false })
        console.log('[CallsPage] predictions (raw) →', rawData?.length ?? 0, 'rows, err:', rawErr?.message ?? 'none')

        // Use raw table if it has data
        if (!rawErr && rawData && rawData.length > 0) {
          setPredictions(rawData as DbPrediction[])
          return
        }
      }
      setPredictions((data as DbPrediction[]) ?? [])
      return
    }

    setError(err.message)
    setPredictions([])
  }, [])

  useEffect(() => { fetchPredictions() }, [fetchPredictions])

  useEffect(() => {
    const ch = supabase
      .channel('calls-page-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'predictions_display' }, fetchPredictions)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchPredictions])

  useEffect(() => {
    window.addEventListener('focus', fetchPredictions)
    return () => window.removeEventListener('focus', fetchPredictions)
  }, [fetchPredictions])

  const isLoading = predictions === null

  const activePredictions = (predictions ?? []).filter(
    p => !SETTLED_STATUSES.includes(p.status) && p.status !== 'deleted'
  )

  const filteredPredictions =
    tab === 'community_calls' ? activePredictions.filter(p => p.category === 'community_calls') :
    tab === 'official_calls'  ? activePredictions.filter(p => p.category === 'official_calls')  :
    tab === 'all_calls'       ? activePredictions :
    []

  const visiblePredictions = filteredPredictions.slice(0, visibleCount)
  const hasMore = filteredPredictions.length > visibleCount

  return (
    <div className="page" style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      {/* Main content */}
      <main style={{ flex: 1, padding: '20px 0 64px', width: '100%' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px' }}>

            {/* Heading row */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 20, flexWrap: 'wrap', gap: 10,
            }}>
              <h1 style={{
                fontSize: 'clamp(2rem, 4vw, 2.8rem)', fontWeight: 800,
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.5px', margin: 0,
                color: 'var(--text-primary)',
              }}>
                {HEADINGS[tab]}
              </h1>
              <SoundToggleButton />
            </div>

            {/* ── Tab bar — pill style matching Rialo ── */}
            <div style={{ marginBottom: 28 }}>
              <div className="calls-tab-nav">
                {TABS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setTab(t.id); setVisibleCount(4) }}
                    className={tab === t.id ? 'active' : ''}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>


            {/* Error banner */}
            {error && (
              <div style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '12px 16px', marginBottom: 20,
                color: '#f87171', fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>Failed to load calls: {error}</span>
                <button
                  onClick={fetchPredictions}
                  style={{ color: '#5a8ab0', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                >
                  Retry
                </button>
              </div>
            )}

            {/* ── Tab content ── */}
            {tab === 'polls' ? (
              <PollTab />

            ) : tab === 'settled' ? (
              <SettledTab predictions={predictions} />

            ) : isLoading ? (
              /* Skeleton cards */
              <div className="prediction-grid">
                {[0, 1, 2, 3, 5, 6].map(i => (
                  <div key={i} className="glass-card" style={{ height: 220, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="skeleton" style={{ height: 20, width: '70%', borderRadius: 6 }} />
                    <div className="skeleton" style={{ height: 14, width: '90%', borderRadius: 6 }} />
                    <div className="skeleton" style={{ height: 14, width: '55%', borderRadius: 6 }} />
                    <div style={{ flex: 1 }} />
                    <div className="skeleton" style={{ height: 40, borderRadius: 10 }} />
                  </div>
                ))}
              </div>

            ) : filteredPredictions.length === 0 ? (
              /* Empty state matching Rialo Calls */
              <div className="glass-card" style={{
                textAlign: 'center',
                padding: '80px 24px',
                borderRadius: 24,
              }}>
                <div style={{ fontSize: 64, marginBottom: 24, opacity: 0.6 }}>
                  🎯
                </div>
                <h3 style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  fontWeight: 700,
                  marginBottom: 12,
                  color: 'var(--text-primary)',
                }}>
                  No active calls
                </h3>
                <p style={{
                  color: 'var(--text-secondary)',
                  fontSize: 15,
                  margin: 0,
                }}>
                   No open predictions in this category yet.
                 </p>
              </div>

            ) : (
              <>
                <div className="prediction-grid">
                  {visiblePredictions.map(pred => (
                    <ErrorBoundary key={pred.id}>
                      <PredictionCard prediction={pred} onUpdate={fetchPredictions} />
                    </ErrorBoundary>
                  ))}
                </div>

                {/* Show More / Show Less controls */}
                {(hasMore || visibleCount > 4) && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    marginTop: 36,
                  }}>
                    {hasMore && (
                      <button
                        onClick={() => setVisibleCount(c => c + 4)}
                        style={{
                          position: 'relative',
                          padding: '11px 40px',
                          background: 'linear-gradient(135deg, rgba(54,97,132,0.25) 0%, rgba(90,138,176,0.15) 100%)',
                          border: '1px solid rgba(90,138,176,0.4)',
                          borderRadius: 12,
                          color: '#e4e8ec',
                          fontSize: 14,
                          fontWeight: 700,
                          letterSpacing: '0.5px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          backdropFilter: 'blur(8px)',
                          WebkitBackdropFilter: 'blur(8px)',
                          overflow: 'hidden',
                        }}
                        onMouseEnter={e => {
                          const b = e.currentTarget
                          b.style.background = 'linear-gradient(135deg, rgba(54,97,132,0.45) 0%, rgba(90,138,176,0.3) 100%)'
                          b.style.borderColor = 'rgba(90,138,176,0.7)'
                          b.style.transform = 'translateY(-2px)'
                          b.style.boxShadow = '0 6px 20px rgba(54,97,132,0.3)'
                        }}
                        onMouseLeave={e => {
                          const b = e.currentTarget
                          b.style.background = 'linear-gradient(135deg, rgba(54,97,132,0.25) 0%, rgba(90,138,176,0.15) 100%)'
                          b.style.borderColor = 'rgba(90,138,176,0.4)'
                          b.style.transform = 'translateY(0)'
                          b.style.boxShadow = 'none'
                        }}
                      >
                        Show More
                        <span style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color: 'rgba(168,200,224,0.7)',
                          fontWeight: 600,
                        }}>
                          +{Math.min(4, filteredPredictions.length - visibleCount)}
                        </span>
                      </button>
                    )}

                    {visibleCount > 4 && (
                      <button
                        onClick={() => setVisibleCount(4)}
                        style={{
                          padding: '11px 32px',
                          background: 'transparent',
                          border: '1px solid rgba(90,138,176,0.2)',
                          borderRadius: 12,
                          color: 'rgba(142,159,176,0.8)',
                          fontSize: 13,
                          fontWeight: 600,
                          letterSpacing: '0.3px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.borderColor = 'rgba(90,138,176,0.45)'
                          e.currentTarget.style.color = '#e4e8ec'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.borderColor = 'rgba(90,138,176,0.2)'
                          e.currentTarget.style.color = 'rgba(142,159,176,0.8)'
                        }}
                      >
                        Show Less
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        <Footer />
    </div>
  )
}
