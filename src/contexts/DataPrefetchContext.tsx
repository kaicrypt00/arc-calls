import { createContext, useContext, useEffect, ReactNode } from 'react'
import { supabase } from '../lib/supabase'

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function setCached(key: string, data: unknown) {
  try {
    localStorage.setItem(`arc_cache_${key}`, JSON.stringify({ data, ts: Date.now() }))
  } catch { /* storage full — silently ignore */ }
}

export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`arc_cache_${key}`)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return data as T
  } catch {
    return null
  }
}

const DataPrefetchContext = createContext<null>(null)

export function DataPrefetchProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const prefetch = async () => {
      // Warm predictions cache
      const { data: predictions } = await supabase
        .from('predictions_display')
        .select('*')
        .in('status', ['open', 'locked'])
        .order('deadline', { ascending: true })
      if (predictions) setCached('predictions_active', predictions)

      // Warm leaderboard cache
      const { data: leaderboard } = await supabase
        .from('leaderboard')
        .select('*')
        .order('total_calls', { ascending: false })
        .limit(50)
      if (leaderboard) setCached('leaderboard_top50', leaderboard)

      // Warm polls cache
      const { data: polls } = await supabase
        .from('polls')
        .select('*')
        .eq('status', 'active')
        .order('vote_count', { ascending: false })
      if (polls) setCached('polls_active', polls)

      // Warm poll history
      const { data: history } = await supabase
        .from('poll_history')
        .select('*')
        .order('round_number', { ascending: false })
        .limit(30)
      if (history) setCached('poll_history', history)
    }

    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => prefetch())
    } else {
      setTimeout(prefetch, 1000)
    }
  }, [])

  return (
    <DataPrefetchContext.Provider value={null}>
      {children}
    </DataPrefetchContext.Provider>
  )
}

export function useDataPrefetch() {
  return useContext(DataPrefetchContext)
}
