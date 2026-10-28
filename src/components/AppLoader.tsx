import { useEffect, useState } from 'react'
import { useProfile } from '../contexts/ProfileContext'
import ArcLogo from './ArcLogo'

const LABELS = ['Initializing Arena', 'Connecting Wallet', 'Loading Calls & Data', 'Almost Ready']

export default function AppLoader({ children }: { children?: React.ReactNode }) {
  const { appInitialized } = useProfile()
  const [visible, setVisible] = useState(() => !appInitialized)
  const [fadeOut, setFadeOut] = useState(() => appInitialized)
  const [labelIdx, setLabelIdx] = useState(0)

  // Cycle through status labels every 1.1s so user knows progress is happening
  useEffect(() => {
    if (appInitialized) return
    const t = setInterval(() => {
      setLabelIdx(i => Math.min(i + 1, LABELS.length - 1))
    }, 1100)
    return () => clearInterval(t)
  }, [appInitialized])

  useEffect(() => {
    if (appInitialized) {
      const t = setTimeout(() => setFadeOut(true), 150)
      return () => clearTimeout(t)
    }
  }, [appInitialized])

  const handleTransitionEnd = () => {
    if (fadeOut) setVisible(false)
  }

  return (
    <>
      {visible && (
        <div
          onTransitionEnd={handleTransitionEnd}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#020617',
            opacity: fadeOut ? 0 : 1,
            transition: 'opacity 0.6s ease',
            pointerEvents: fadeOut ? 'none' : 'all',
          }}
        >
          {/* Ambient Glow */}
          <div
            style={{
              position: 'absolute',
              width: 480,
              height: 480,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(56,189,248,0.14) 0%, rgba(14,165,233,0.03) 50%, transparent 70%)',
              animation: 'loader-pulse 3s ease-in-out infinite',
            }}
          />

          {/* Arc Symbol + Outer & Inner Rotating Rings */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 32,
            }}
          >
            {/* Outer spinning ring */}
            <div
              style={{
                position: 'absolute',
                width: 104,
                height: 104,
                borderRadius: '50%',
                border: '2px solid transparent',
                borderTopColor: 'rgba(56,189,248,0.85)',
                borderRightColor: 'rgba(56,189,248,0.25)',
                animation: 'spin 1.2s linear infinite',
              }}
            />
            {/* Inner spinning ring */}
            <div
              style={{
                position: 'absolute',
                width: 78,
                height: 78,
                borderRadius: '50%',
                border: '1.5px solid transparent',
                borderTopColor: 'rgba(125,211,252,0.5)',
                borderLeftColor: 'rgba(125,211,252,0.15)',
                animation: 'spin 1.8s linear infinite reverse',
              }}
            />
            {/* Arc symbol badge */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'rgba(6,18,38,0.92)',
                border: '1px solid rgba(56,189,248,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 24px rgba(56,189,248,0.25)',
              }}
            >
              <ArcLogo size={32} />
            </div>
          </div>

          {/* Wordmark */}
          <div
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
              fontSize: 24,
              fontWeight: 700,
              color: '#f8fafc',
              letterSpacing: '-0.3px',
              marginBottom: 6,
            }}
          >
            Arc Calls
          </div>

          {/* Subtitle */}
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-secondary, #94a3b8)',
              marginBottom: 22,
              letterSpacing: '0.01em',
            }}
          >
            Community Prediction Platform
          </div>

          {/* Loading label */}
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(56,189,248,0.9)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              animation: 'loader-blink 1.4s ease-in-out infinite',
            }}
          >
            LOADING — {LABELS[labelIdx].toUpperCase()}
          </div>

          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
            @keyframes loader-pulse {
              0%, 100% { transform: scale(1); opacity: 0.8; }
              50% { transform: scale(1.15); opacity: 0.4; }
            }
            @keyframes loader-blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.35; }
            }
          `}</style>
        </div>
      )}
      {children}
    </>
  )
}
