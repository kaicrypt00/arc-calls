import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { supabase, type DbPrediction, type DbLeaderboard } from '../lib/supabase'

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// ── localStorage helpers ────────────────────────────────────────────────────
function setCached(key: string, data: unknown) {
  try {
    localStorage.setItem(`arc_cache_${key}`, JSON.stringify({ data, ts: Date.now() }))
  } catch { /* storage full */ }
}

export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`arc_cache_${key}`)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw) as { data: T; ts: number }
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch { return null }
}

// ── Context shape ────────────────────────────────────────────────────────────
interface DataCacheValue {
  allPredictions: DbPrediction[] | null
  leaderboard: DbLeaderboard[] | null
  dataReady: boolean
  refetchPredictions: () => Promise<void>
  refetchLeaderboard: () => Promise<void>
  warmCache: () => Promise<void>
}

const DataCacheContext = createContext<DataCacheValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────
export function DataPrefetchProvider({ children }: { children: ReactNode }) {
  const [allPredictions, setAllPredictions] = useState<DbPrediction[] | null>(
    () => getCached<DbPrediction[]>('predictions_all')
  )
  const [leaderboard, setLeaderboard] = useState<DbLeaderboard[] | null>(
    () => getCached<DbLeaderboard[]>('leaderboard_top50')
  )
  // dataReady: true once both fetches have resolved (or cache hit on mount)
  const [predictionsReady, setPredictionsReady] = useState(
    () => !!getCached<DbPrediction[]>('predictions_all')
  )
  const [leaderboardReady, setLeaderboardReady] = useState(
    () => !!getCached<DbLeaderboard[]>('leaderboard_top50')
  )
  const dataReady = predictionsReady && leaderboardReady
  const warmingRef = useRef(false)

  const refetchPredictions = useCallback(async () => {
    const { data, error } = await supabase
      .from('predictions_display')
      .select('*')
      .not('status', 'eq', 'deleted')
      .order('deadline', { ascending: true })
    if (error) {
      console.error('[DataPrefetchContext] predictions fetch error:', error.message)
      setAllPredictions(prev => prev ?? [])
    } else if (data) {
      setAllPredictions(data as DbPrediction[])
      setCached('predictions_all', data)
    }
    setPredictionsReady(true)
  }, [])

  const refetchLeaderboard = useCallback(async () => {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .order('total_pnl', { ascending: false })
      .limit(100)
    if (error) {
      console.error('[DataPrefetchContext] leaderboard fetch error:', error.message)
      setLeaderboard(prev => prev ?? [])
    } else if (data) {
      setLeaderboard(data as DbLeaderboard[])
      setCached('leaderboard_top50', data)
    }
    setLeaderboardReady(true)
  }, [])

  const warmCache = useCallback(async () => {
    if (warmingRef.current) return
    warmingRef.current = true
    try {
      await Promise.all([
        getCached('predictions_all') ? Promise.resolve() : refetchPredictions(),
        getCached('leaderboard_top50') ? Promise.resolve() : refetchLeaderboard(),
      ])
    } finally {
      warmingRef.current = false
    }
  }, [refetchPredictions, refetchLeaderboard])

  // Cold start: fetch if cache is empty
  useEffect(() => {
    if (!allPredictions) refetchPredictions()
    if (!leaderboard) refetchLeaderboard()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DataCacheContext.Provider value={{
      allPredictions,
      leaderboard,
      dataReady,
      refetchPredictions,
      refetchLeaderboard,
      warmCache,
    }}>
      {children}
    </DataCacheContext.Provider>
  )
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useDataCache() {
  const ctx = useContext(DataCacheContext)
  if (!ctx) throw new Error('useDataCache must be used within DataPrefetchProvider')
  return ctx
}

// Keep old export for backward compatibility
export function useDataPrefetch() { return useContext(DataCacheContext) }
