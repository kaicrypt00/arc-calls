import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

interface TickerItem {
  id: number
  wallet_address: string
  side: string
  amount: number
  prediction_id: number
  name?: string
  title?: string
}

export default function Ticker() {
  const [items, setItems] = useState<TickerItem[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)
  const posRef = useRef(0)

  const fetchItems = async () => {
    const { data } = await supabase
      .from('bets')
      .select('id, wallet_address, side, amount, prediction_id, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (!data) return

    // Enrich with profile names + prediction titles
    const enriched: TickerItem[] = await Promise.all(data.map(async b => {
      const [{ data: prof }, { data: pred }] = await Promise.all([
        supabase.from('profiles').select('name').eq('wallet_address', b.wallet_address).single(),
        supabase.from('predictions_display').select('title').eq('id', b.prediction_id).single(),
      ])
      return { ...b, name: prof?.name, title: pred?.title }
    }))
    setItems(enriched)
  }

  useEffect(() => {
    fetchItems()
    const interval = setInterval(fetchItems, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll animation
  useEffect(() => {
    const el = scrollRef.current
    if (!el || items.length === 0) return
    const speed = 0.5
    const animate = () => {
      posRef.current -= speed
      if (posRef.current < -el.scrollWidth / 2) posRef.current = 0
      el.style.transform = `translateX(${posRef.current}px)`
      animRef.current = requestAnimationFrame(animate)
    }
    animRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animRef.current)
  }, [items])

  if (items.length === 0) return null

  const doubled = [...items, ...items]

  return (
    <div style={{
      height: 36, overflow: 'hidden', background: 'rgba(6,42,81,0.4)',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex', alignItems: 'center',
      position: 'relative', zIndex: 1,
    }}>
      <div
        ref={scrollRef}
        style={{ display: 'flex', gap: 0, whiteSpace: 'nowrap', willChange: 'transform' }}
      >
        {doubled.map((item, idx) => (
          <span
            key={`${item.id}-${idx}`}
            style={{
              fontSize: 12, color: 'var(--text-secondary)',
              padding: '0 24px',
              borderRight: '1px solid var(--border-subtle)',
            }}
          >
            🎯{' '}
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {item.name ? `@${item.name}` : `${item.wallet_address.slice(0, 6)}...`}
            </span>{' '}
            bet{' '}
            <span className="mono" style={{ color: item.side === 'YES' ? 'var(--yes-color)' : 'var(--no-color)' }}>
              {Number(item.amount).toFixed(2)} USDC on {item.side}
            </span>
            {item.title && <> — <span style={{ color: 'var(--text-secondary)' }}>{item.title.slice(0, 40)}{item.title.length > 40 ? '...' : ''}</span></>}
          </span>
        ))}
      </div>
    </div>
  )
}
