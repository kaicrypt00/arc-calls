import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'

interface SoundContextValue {
  soundEnabled: boolean
  isPlaying: boolean
  toggleSound: () => void
  playClickSound: () => void
  playClaimSound: () => void
}

const SoundContext = createContext<SoundContextValue | null>(null)

const CACHE_NAME = 'arc-audio-cache-v1'

const AUDIO_MANIFEST = {
  click: '/click.mp3',
  bgMusic: '/bg-music.mp3',
  claimSounds: [
    '/whatsapp-claim-1.mp3',
    '/whatsapp-claim-2.mp3',
    '/whatsapp-claim-3.mp3',
    '/whatsapp-claim-4.mp3',
  ],
}

/** Download & persist audio in Cache Storage → return Blob URL for zero-latency playback */
async function getCachedAudioUrl(url: string): Promise<string> {
  if (typeof window === 'undefined') return url
  try {
    if ('caches' in window) {
      const cache = await caches.open(CACHE_NAME)
      let res = await cache.match(url)
      if (!res) {
        const netRes = await fetch(url)
        if (netRes.ok) { await cache.put(url, netRes.clone()); res = netRes }
      }
      if (res?.ok) {
        const blob = await res.blob()
        return URL.createObjectURL(blob)
      }
    }
  } catch (e) {
    console.debug('Arc audio cache fallback:', e)
  }
  return url
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('arc_sound_enabled') !== 'false' } catch { return true }
  })
  const [isPlaying, setIsPlaying] = useState(false)

  const bgAudioRef      = useRef<HTMLAudioElement | null>(null)
  const clickPoolRef    = useRef<HTMLAudioElement[]>([])
  const clickIndexRef   = useRef(0)
  const claimPoolRef    = useRef<HTMLAudioElement[]>([])
  const lastClickTime   = useRef(0)

  // ── Initialize all audio ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    // 1. Background music
    const bg = new Audio(AUDIO_MANIFEST.bgMusic)
    bg.loop = true; bg.volume = 0.35; bg.preload = 'auto'
    bg.onplay  = () => setIsPlaying(true)
    bg.onpause = () => setIsPlaying(false)
    bgAudioRef.current = bg

    // 2. Click pool — 4 instances to avoid stutter on rapid clicks
    clickPoolRef.current = Array.from({ length: 4 }, () => {
      const a = new Audio(AUDIO_MANIFEST.click)
      a.volume = 0.5; a.preload = 'auto'; return a
    })

    // 3. Claim sounds pool
    claimPoolRef.current = AUDIO_MANIFEST.claimSounds.map(url => {
      const a = new Audio(url)
      a.volume = 0.75; a.preload = 'auto'; return a
    })

    // 4. Background cache warmup
    const warmCache = async () => {
      try {
        const clickBlob = await getCachedAudioUrl(AUDIO_MANIFEST.click)
        if (!cancelled && clickBlob !== AUDIO_MANIFEST.click) {
          clickPoolRef.current.forEach(a => { a.src = clickBlob; a.load() })
        }

        const bgBlob = await getCachedAudioUrl(AUDIO_MANIFEST.bgMusic)
        if (!cancelled && bgBlob !== AUDIO_MANIFEST.bgMusic && bgAudioRef.current) {
          const wasPlaying = !bgAudioRef.current.paused
          const curTime = bgAudioRef.current.currentTime
          bgAudioRef.current.src = bgBlob
          bgAudioRef.current.currentTime = curTime
          if (wasPlaying) bgAudioRef.current.play().catch(() => {})
        }

        AUDIO_MANIFEST.claimSounds.forEach(async (url, idx) => {
          const blob = await getCachedAudioUrl(url)
          if (!cancelled && claimPoolRef.current[idx] && blob !== url) {
            claimPoolRef.current[idx].src = blob
            claimPoolRef.current[idx].load()
          }
        })
      } catch (err) { console.debug('Arc cache notice:', err) }
    }

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => warmCache(), { timeout: 2500 })
    } else {
      setTimeout(warmCache, 300)
    }

    // 5. Autoplay attempt — fall back to first-interaction trigger
    const attemptAutoplay = async () => {
      if (!soundEnabled || !bgAudioRef.current) return
      try {
        await bgAudioRef.current.play()
        setIsPlaying(true)
      } catch {
        const onFirstInteraction = async () => {
          window.removeEventListener('pointerdown', onFirstInteraction)
          window.removeEventListener('keydown', onFirstInteraction)
          const stillOn = localStorage.getItem('arc_sound_enabled') !== 'false'
          if (stillOn && bgAudioRef.current) {
            bgAudioRef.current.play().then(() => setIsPlaying(true)).catch(() => {})
          }
        }
        window.addEventListener('pointerdown', onFirstInteraction, { once: true })
        window.addEventListener('keydown',     onFirstInteraction, { once: true })
      }
    }
    attemptAutoplay()

    return () => {
      cancelled = true
      bgAudioRef.current?.pause()
      bgAudioRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync bg music when soundEnabled changes ────────────────────────────────
  useEffect(() => {
    const bg = bgAudioRef.current
    if (!bg) return
    if (soundEnabled) {
      bg.play().then(() => setIsPlaying(true)).catch(() => {})
    } else {
      bg.pause(); setIsPlaying(false)
    }
  }, [soundEnabled])

  // ── Toggle ────────────────────────────────────────────────────────────────
  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev
      try { localStorage.setItem('arc_sound_enabled', String(next)) } catch {}
      const bg = bgAudioRef.current
      if (bg) {
        if (next) { bg.play().then(() => setIsPlaying(true)).catch(() => {}) }
        else       { bg.pause(); setIsPlaying(false) }
      }
      return next
    })
  }, [])

  // ── Click sound ───────────────────────────────────────────────────────────
  const playClickSound = useCallback(() => {
    if (!soundEnabled) return
    const now = Date.now()
    if (now - lastClickTime.current < 35) return
    lastClickTime.current = now
    const pool = clickPoolRef.current
    if (!pool.length) return
    const audio = pool[clickIndexRef.current]
    clickIndexRef.current = (clickIndexRef.current + 1) % pool.length
    try { audio.currentTime = 0; audio.play().catch(() => {}) } catch {}
  }, [soundEnabled])

  // ── Claim sound ───────────────────────────────────────────────────────────
  const playClaimSound = useCallback(() => {
    if (!soundEnabled) return
    const pool = claimPoolRef.current
    if (!pool.length) return
    const audio = pool[Math.floor(Math.random() * pool.length)]
    try { audio.currentTime = 0; audio.play().catch(() => {}) } catch {}
  }, [soundEnabled])

  // ── Global click listener for buttons/links ───────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!soundEnabled) return
      const target = (e.target as Element)?.closest(
        'button, a, [role="button"], input[type="button"], input[type="submit"], .clickable'
      )
      if (target && !(target as HTMLElement).dataset.noClickSound) playClickSound()
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [soundEnabled, playClickSound])

  return (
    <SoundContext.Provider value={{ soundEnabled, isPlaying, toggleSound, playClickSound, playClaimSound }}>
      {children}
    </SoundContext.Provider>
  )
}

export function useSound(): SoundContextValue {
  const ctx = useContext(SoundContext)
  if (!ctx) throw new Error('useSound must be used inside SoundProvider')
  return ctx
}
