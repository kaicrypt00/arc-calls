import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { shortAddress, timeAgo } from '../utils/format'

interface BetRow {
  id: number
  wallet_address: string
  side: 'yes' | 'no'
  amount: string
  created_at: string
  prediction_title: string
}

export default function RecentBetsFeed() {
  const [bets, setBets] = useState<BetRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBets = async () => {
    const { data } = await supabase
      .from('bets')
      .select('id, wallet_address, side, amount, created_at, predictions_display(title)')
      .order('created_at', { ascending: false })
      .limit(20)

    if (data) {
      setBets((data as Array<{
        id: number
        wallet_address: string
        side: 'yes' | 'no'
        amount: string
        created_at: string
        predictions_display: Array<{ title: string }> | { title: string } | null
      }>).map(b => {
        const pd = b.predictions_display
        const title = Array.isArray(pd) ? (pd[0]?.title ?? 'Unknown market') : (pd?.title ?? 'Unknown market')
        return {
          id: b.id,
          wallet_address: b.wallet_address,
          side: b.side,
          amount: b.amount,
          created_at: b.created_at,
          prediction_title: title,
        }
      }))
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchBets()

    const channel = supabase
      .channel('recent-bets-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bets' }, () => {
        fetchBets()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="glass-card" style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span className="live-dot" />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Live Activity
        </span>
      </div>

      {/* Feed */}
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          [0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="skeleton" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }} />
              <div className="skeleton" style={{ height: 14, flex: 1, borderRadius: 6 }} />
            </div>
          ))
        ) : bets.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', padding: '20px 0' }}>
            No activity yet
          </div>
        ) : (
          bets.map(bet => {
            const isYes = bet.side === 'yes'
            const amountUsdc = Number(bet.amount).toFixed(2)
            const title = bet.prediction_title.length > 40
              ? bet.prediction_title.slice(0, 40) + '…'
              : bet.prediction_title

            return (
              <div key={bet.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(54,97,132,0.1)' }}>
                {/* Side dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                  background: isYes ? '#4ade80' : '#f87171',
                  boxShadow: `0 0 6px ${isYes ? '#4ade80' : '#f87171'}60`,
                }} />
                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {shortAddress(bet.wallet_address)}
                    </span>
                    {' called '}
                    <span style={{ color: isYes ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                      {isYes ? 'YES' : 'NO'}
                    </span>
                    {' · '}
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>${amountUsdc}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {title}
                  </div>
                </div>
                {/* Time */}
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0, paddingTop: 2 }}>
                  {timeAgo(bet.created_at)}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
