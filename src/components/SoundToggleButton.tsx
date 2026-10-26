import { useSound } from '../contexts/SoundContext'

interface SoundToggleButtonProps {
  className?: string
  style?: React.CSSProperties
}

export default function SoundToggleButton({ className = '', style = {} }: SoundToggleButtonProps) {
  const { soundEnabled, isPlaying, toggleSound } = useSound()

  return (
    <button
      type="button"
      onClick={toggleSound}
      data-no-click-sound="true"
      className={`sound-toggle-btn ${soundEnabled ? 'sound-active' : 'sound-muted'} ${className}`}
      title={soundEnabled ? 'Sound ON — click to mute' : 'Sound OFF — click to enable'}
      aria-label={soundEnabled ? 'Turn sound off' : 'Turn sound on'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 38,
        padding: '0 14px',
        borderRadius: 20,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.5,
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        userSelect: 'none',
        flexShrink: 0,
        ...style,
      }}
    >
      {soundEnabled ? (
        <>
          {/* Animated 3-bar Arc-blue equalizer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 14 }}>
            <span
              style={{
                width: 2.5,
                background: '#5a8ab0',
                borderRadius: 2,
                height: isPlaying ? 12 : 6,
                animation: isPlaying ? 'sound-wave-1 1s ease-in-out infinite' : 'none',
                transition: 'height 0.3s ease',
              }}
            />
            <span
              style={{
                width: 2.5,
                background: '#5a8ab0',
                borderRadius: 2,
                height: isPlaying ? 16 : 10,
                animation: isPlaying ? 'sound-wave-2 0.8s ease-in-out infinite 0.15s' : 'none',
                transition: 'height 0.3s ease',
              }}
            />
            <span
              style={{
                width: 2.5,
                background: '#5a8ab0',
                borderRadius: 2,
                height: isPlaying ? 10 : 6,
                animation: isPlaying ? 'sound-wave-3 1.1s ease-in-out infinite 0.3s' : 'none',
                transition: 'height 0.3s ease',
              }}
            />
          </div>

          <span className="sound-label" style={{ color: '#a8c8e0' }}>
            Sound ON
          </span>
        </>
      ) : (
        <>
          {/* Muted speaker SVG */}
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.55 }}
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>

          <span className="sound-label" style={{ color: 'rgba(90,138,176,0.5)' }}>
            Sound OFF
          </span>
        </>
      )}
    </button>
  )
}
