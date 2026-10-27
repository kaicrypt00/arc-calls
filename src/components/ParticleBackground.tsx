import { useEffect, useRef } from 'react'

/**
 * ParticleBackground — 3-tier layered system (Arc theme)
 *
 * Tier 1 — Tiny twinkle stars (55): very small, slow drift, subtle twinkle
 * Tier 2 — Medium glowing orbs  (35): mid-size glowing, gentle float, visible Arc glow
 * Tier 3 — Soft wisps           (15): large, very slow, creates deep atmosphere
 *
 * Total: 105 particles. Styled in Arc icy-blue (#a8cce8) & electric blue glow.
 */
export default function ParticleBackground() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const particles: HTMLElement[] = []

    function spawn({
      minSize,
      maxSize,
      minOpacity,
      maxOpacity,
      minDur,
      maxDur,
      glowMult,
      count,
    }: {
      minSize: number
      maxSize: number
      minOpacity: number
      maxOpacity: number
      minDur: number
      maxDur: number
      glowMult: number
      count: number
    }) {
      for (let i = 0; i < count; i++) {
        const el = document.createElement('div')
        const size = Math.random() * (maxSize - minSize) + minSize
        const opacity = Math.random() * (maxOpacity - minOpacity) + minOpacity
        const dur = (Math.random() * (maxDur - minDur) + minDur) * 1000
        const delay = Math.random() * -40 * 1000
        const x = Math.random() * 100
        const y = Math.random() * 100
        const drift = (Math.random() * 80 - 40) // ±40px horizontal drift
        const rise = Math.random() * 300 + 100 // 100–400px rise
        const glow = size * glowMult

        // Arc icy-blue with electric blue glow
        el.style.cssText = `
          position: absolute;
          width: ${size}px;
          height: ${size}px;
          background: #a8cce8;
          border-radius: 50%;
          left: ${x}%;
          top: ${y}%;
          opacity: 0;
          box-shadow: 0 0 ${glow}px ${glow * 0.5}px rgba(90, 138, 176, ${opacity * 0.9});
          pointer-events: none;
          will-change: transform, opacity;
        `

        // Keyframes: fade in → hold → drift up → fade out
        el.animate(
          [
            { transform: 'translate(0, 0) scale(0.8)', opacity: 0 },
            { transform: 'translate(0, 0) scale(1)', opacity: opacity, offset: 0.1 },
            { transform: `translate(${drift * 0.4}px, -${rise * 0.4}px) scale(1.05)`, opacity: opacity, offset: 0.45 },
            { transform: `translate(${drift * 0.7}px, -${rise * 0.7}px) scale(1)`, opacity: opacity * 0.7, offset: 0.75 },
            { transform: `translate(${drift}px, -${rise}px) scale(0.8)`, opacity: 0 },
          ],
          { duration: dur, delay, iterations: Infinity, easing: 'ease-in-out' }
        )

        container?.appendChild(el)
        particles.push(el)
      }
    }

    // Tier 1 — Tiny twinkle stars: numerous, subtle
    spawn({ minSize: 0.8, maxSize: 1.8, minOpacity: 0.15, maxOpacity: 0.45, minDur: 18, maxDur: 36, glowMult: 2.5, count: 55 })

    // Tier 2 — Medium glowing orbs: visible Arc glow, mid-speed float
    spawn({ minSize: 1.8, maxSize: 3.5, minOpacity: 0.25, maxOpacity: 0.65, minDur: 14, maxDur: 26, glowMult: 4, count: 35 })

    // Tier 3 — Soft wisps: large, creates rich atmospheric depth
    spawn({ minSize: 3.5, maxSize: 6.0, minOpacity: 0.08, maxOpacity: 0.25, minDur: 28, maxDur: 52, glowMult: 6, count: 15 })

    return () => particles.forEach(p => p.remove())
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    />
  )
}
