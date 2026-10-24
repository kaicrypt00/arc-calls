import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { supabase } from '../lib/supabase'
import ArcLogo from '../components/ArcLogo'

function truncate(addr: string) { return `${addr.slice(0, 6)}…${addr.slice(-4)}` }

function LandingWalletButton() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const copy = () => {
    if (address) navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => { setCopied(false); setOpen(false) }, 1200)
  }

  if (!isConnected || !address) {
    return (
      <ConnectButton.Custom>
        {({ openConnectModal, mounted }) => {
          if (!mounted) return null
          return (
            <button onClick={openConnectModal} style={{
              background: 'rgba(90,138,176,0.12)',
              border: '1px solid rgba(90,138,176,0.35)',
              borderRadius: 22, padding: '8px 22px',
              color: '#E4E8EC', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', letterSpacing: '0.3px',
              transition: 'all 200ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(90,138,176,0.22)'; e.currentTarget.style.borderColor = 'rgba(90,138,176,0.6)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(90,138,176,0.2)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(90,138,176,0.12)'; e.currentTarget.style.borderColor = 'rgba(90,138,176,0.35)'; e.currentTarget.style.boxShadow = 'none' }}
            >
              Connect Wallet
            </button>
          )
        }}
      </ConnectButton.Custom>
    )
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(6,30,60,0.7)', border: '1px solid rgba(90,138,176,0.28)',
        borderRadius: 22, padding: '7px 16px',
        color: '#E4E8EC', fontSize: 13, fontWeight: 600,
        cursor: 'pointer', transition: 'all 200ms ease',
        backdropFilter: 'blur(12px)',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(90,138,176,0.55)'; e.currentTarget.style.background = 'rgba(6,42,81,0.85)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(90,138,176,0.28)'; e.currentTarget.style.background = 'rgba(6,30,60,0.7)' }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0, animation: 'pulse-dot 2s ease infinite' }} />
        <span className="mono" style={{ fontSize: 12 }}>{truncate(address)}</span>
        <span style={{ color: 'rgba(228,232,236,0.35)', fontSize: 9, marginLeft: 1 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0, minWidth: 200,
          background: 'rgba(3,12,30,0.98)', border: '1px solid rgba(90,138,176,0.18)',
          borderRadius: 14, overflow: 'hidden', zIndex: 1000,
          backdropFilter: 'blur(32px)', boxShadow: '0 24px 64px rgba(0,0,0,0.75)',
          animation: 'fadeIn 150ms ease',
        }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(228,232,236,0.06)' }}>
            <div style={{ fontSize: 10, color: 'rgba(228,232,236,0.3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '1.2px', fontFamily: 'JetBrains Mono, monospace' }}>Main Wallet</div>
            <div className="mono" style={{ fontSize: 12, color: '#E4E8EC' }}>{truncate(address)}</div>
          </div>
          {[
            { icon: '⎘', label: copied ? 'Copied!' : 'Copy Address', action: copy, color: 'rgba(228,232,236,0.75)' },
            { icon: '⏻', label: 'Disconnect', action: () => { disconnect(); setOpen(false) }, color: 'rgba(248,113,113,0.85)' },
          ].map(item => (
            <button key={item.label} onClick={item.action} style={{
              width: '100%', textAlign: 'left', padding: '10px 14px',
              background: 'none', border: 'none',
              color: item.color, fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              transition: 'background 150ms', fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(90,138,176,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ fontSize: 14, width: 18, textAlign: 'center', opacity: 0.8 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatPill({ value, label, loading }: { value: number | null; label: string; loading?: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '22px 40px', position: 'relative' }}>
      <div className="mono" style={{
        fontSize: 40, fontWeight: 700, lineHeight: 1,
        background: 'linear-gradient(135deg, #ffffff 0%, #c8d8e8 100%)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>
        {loading || value === null
          ? <span className="skeleton" style={{ display: 'inline-block', width: 48, height: 40, borderRadius: 8 }} />
          : value}
      </div>
      <div style={{
        fontSize: 10, color: 'rgba(142,159,176,0.8)', marginTop: 7,
        fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '2px',
        whiteSpace: 'nowrap',
      }}>{label}</div>
    </div>
  )
}

export default function LandingPage() {
  const { isConnected } = useAccount()
  const navigate = useNavigate()
  const [activeMarkets, setActiveMarkets] = useState<number | null>(null)
  const [totalCallers, setTotalCallers] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      const [{ count: markets }, { count: callers }] = await Promise.all([
        supabase.from('predictions_display').select('*', { count: 'exact', head: true }).in('status', ['open', 'locked']),
        supabase.from('leaderboard').select('*', { count: 'exact', head: true }),
      ])
      setActiveMarkets(markets ?? 0)
      setTotalCallers(callers ?? 0)
      setLoading(false)
    }
    fetchStats()
  }, [])

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>

      {/* Landing nav — transparent frosted glass, no hard black */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 68, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 36px',
        background: 'rgba(1,8,20,0.55)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(90,138,176,0.1)',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <ArcLogo size={30} />
          <span style={{
            fontSize: 17, fontWeight: 700, letterSpacing: '-0.4px',
            background: 'linear-gradient(135deg, #E4E8EC 0%, #8cb4d0 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Arc Calls</span>
        </div>

        {/* Wallet button */}
        <LandingWalletButton />
      </nav>

      {/* Hero */}
      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center',
        padding: '100px 24px 80px',
        position: 'relative', zIndex: 1,
      }}>

        {/* Deep glow orb behind content */}
        <div style={{
          position: 'absolute', width: 700, height: 700, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(54,97,132,0.14) 0%, transparent 65%)',
          pointerEvents: 'none', top: '50%', left: '50%',
          transform: 'translate(-50%,-55%)',
        }} />

        {/* Logo */}
        <div style={{ marginBottom: 32, animation: 'fadeInUp 700ms ease' }}>
          <ArcLogo size={88} style={{ filter: 'drop-shadow(0 0 40px rgba(90,138,176,0.4))' }} />
        </div>

        {/* Eyebrow pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 22,
          padding: '5px 16px', borderRadius: 20,
          background: 'rgba(90,138,176,0.08)', border: '1px solid rgba(90,138,176,0.2)',
          animation: 'fadeInUp 700ms ease 80ms both',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse-dot 1.8s ease infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(180,191,201,0.9)', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>
            Live on Arc Mainnet · Powered by USDC
          </span>
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize: 'clamp(54px, 9.5vw, 100px)', fontWeight: 800,
          letterSpacing: '-3px', lineHeight: 0.95, marginBottom: 22,
          background: 'linear-gradient(160deg, #ffffff 0%, #d0dce8 45%, #7a9ab8 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          animation: 'fadeInUp 700ms ease 140ms both',
        }}>
          Arc Calls
        </h1>

        {/* Subtitle */}
        <p style={{
          fontSize: 'clamp(16px, 2.2vw, 22px)', color: 'rgba(180,191,201,0.85)',
          marginBottom: 12, fontWeight: 500, letterSpacing: '-0.2px',
          animation: 'fadeInUp 700ms ease 200ms both',
        }}>
          Where the Community Calls What Happens Next
        </p>

        <p style={{
          fontSize: 15, color: 'rgba(142,159,176,0.7)',
          maxWidth: 480, lineHeight: 1.8, marginBottom: 48,
          animation: 'fadeInUp 700ms ease 260ms both',
        }}>
          Stake USDC on real outcomes. Earn in the ultimate onchain prediction arena.
          Community-powered. Blockchain-settled.
        </p>

        {/* CTA */}
        <div style={{ animation: 'fadeInUp 700ms ease 320ms both', marginBottom: 56 }}>
          {isConnected ? (
            <button onClick={() => navigate('/calls')} style={{
              padding: '15px 68px', fontSize: 15,
              fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
              borderRadius: 14, cursor: 'pointer',
              background: 'linear-gradient(135deg, #062a51 0%, #0e4a8a 50%, #062a51 100%)',
              backgroundSize: '200% 100%',
              color: '#e8f0f8', border: '1px solid rgba(90,138,176,0.45)',
              animation: 'shimmer 4s ease infinite, pulse-shadow 3s ease infinite',
              transition: 'transform 200ms ease, border-color 200ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px) scale(1.03)'; e.currentTarget.style.borderColor = 'rgba(90,138,176,0.7)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0) scale(1)'; e.currentTarget.style.borderColor = 'rgba(90,138,176,0.45)' }}
            >
              Enter The Arena
            </button>
          ) : (
            <ConnectButton.Custom>
              {({ openConnectModal, mounted }) => {
                if (!mounted) return null
                return (
                  <button onClick={openConnectModal} style={{
                    padding: '15px 68px', fontSize: 15,
                    fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
                    borderRadius: 14, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #062a51 0%, #0e4a8a 50%, #062a51 100%)',
                    backgroundSize: '200% 100%',
                    color: '#e8f0f8', border: '1px solid rgba(90,138,176,0.45)',
                    animation: 'shimmer 4s ease infinite, pulse-shadow 3s ease infinite',
                  }}>
                    Enter The Arena
                  </button>
                )
              }}
            </ConnectButton.Custom>
          )}
        </div>

        {/* Stats card */}
        <div style={{
          display: 'inline-flex', alignItems: 'stretch',
          background: 'rgba(4,14,32,0.65)',
          border: '1px solid rgba(90,138,176,0.14)',
          borderRadius: 22, backdropFilter: 'blur(32px)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
          animation: 'fadeInUp 700ms ease 400ms both',
        }}>
          <StatPill value={activeMarkets} label="Active Markets" loading={loading} />
          <div style={{ width: 1, background: 'linear-gradient(180deg, transparent 10%, rgba(90,138,176,0.25) 50%, transparent 90%)' }} />
          <StatPill value={totalCallers} label="Total Callers" loading={loading} />
        </div>

        {/* Bottom live label */}
        <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 8, animation: 'fadeInUp 700ms ease 480ms both' }}>
          <span style={{ fontSize: 10, color: 'rgba(142,159,176,0.45)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            Built on Arc · Real USDC · Real Outcomes
          </span>
        </div>

      </main>

      {/* Footer line */}
      <footer style={{
        textAlign: 'center', padding: '20px 24px 100px',
        fontSize: 11, color: 'rgba(142,159,176,0.3)',
        fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1px',
        zIndex: 1, position: 'relative',
      }}>
        Built on Arc · Arc Calls © 2025
      </footer>

    </div>
  )
}
