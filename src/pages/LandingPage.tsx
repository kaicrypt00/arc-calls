import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { supabase } from '../lib/supabase'
import ArcLogo from '../components/ArcLogo'
import SoundToggleButton from '../components/SoundToggleButton'

export default function LandingPage() {
  const navigate = useNavigate()
  const [activeMarkets, setActiveMarkets] = useState<number>(0)
  const [totalCallers, setTotalCallers] = useState<number>(0)

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    try {
      const [{ count: markets }, { count: callers }] = await Promise.all([
        supabase
          .from('predictions_display')
          .select('*', { count: 'exact', head: true })
          .in('status', ['open', 'locked']),
        supabase
          .from('leaderboard')
          .select('*', { count: 'exact', head: true }),
      ])
      setActiveMarkets(markets ?? 0)
      setTotalCallers(callers ?? 0)
    } catch (e) {
      // silent
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 20%, rgba(90,138,176,0.12) 0%, transparent 60%), #010d1f',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* ── Navbar ── */}
      <nav style={{
        position: 'fixed',
        top: 0,
        width: '100%',
        zIndex: 100,
        height: 64,
        background: 'rgba(1,13,31,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(90,138,176,0.18)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <ArcLogo size={32} />
          </div>
          <span
            className="navbar-brand-shimmer"
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--text-primary, #E4E8EC)',
              letterSpacing: -0.5,
              cursor: 'default',
            }}
          >
            Arc Calls
          </span>
        </div>

        {/* Right controls — Sound Toggle + RainbowKit ConnectButton with dropdown arrow & avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SoundToggleButton />
          <ConnectButton label="Connect Wallet" showBalance={false} chainStatus="none" />
        </div>
      </nav>

      {/* ── Hero section — centered ── */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '0 24px',
        paddingTop: 88,
        paddingBottom: 48,
        gap: 0,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Main heading — gradient clip */}
        <h1 style={{
          fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
          fontSize: 'clamp(52px, 10vw, 96px)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: -2,
          marginBottom: 18,
          background: 'linear-gradient(180deg, #FFFFFF 0%, #E4E8EC 45%, #8E9FB0 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          position: 'relative',
          zIndex: 1,
        }}>
          Arc Calls
        </h1>

        {/* Subheading */}
        <h2 style={{
          fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
          fontSize: 'clamp(18px, 3vw, 28px)',
          fontWeight: 600,
          color: 'rgba(228,232,236,0.82)',
          marginBottom: 18,
          letterSpacing: 0.5,
          position: 'relative',
          zIndex: 1,
        }}>
          Where the Community Calls What Happens Next
        </h2>

        {/* Description */}
        <p style={{
          fontFamily: 'var(--font-body, "Inter", sans-serif)',
          fontSize: 16,
          color: 'rgba(142,159,176,0.85)',
          maxWidth: 560,
          lineHeight: 1.6,
          marginBottom: 36,
          position: 'relative',
          zIndex: 1,
        }}>
          Arc Calls is the prediction arena for the Arc ecosystem. Bet YES or NO on what's happening inside Arc, forecast community outcomes, and earn rewards with every winning call.
        </p>

        {/* CTA button — increased slightly more */}
        <button
          className="landing-cta-btn"
          onClick={() => navigate('/calls')}
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, #366184 0%, #5a8ab0 100%)',
            color: '#FFFFFF',
            fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 3,
            padding: '19px 58px',
            borderRadius: 14,
            border: '1px solid rgba(168,200,224,0.45)',
            cursor: 'pointer',
            textTransform: 'uppercase',
            animation: 'pulse-shadow 2s infinite',
            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            marginBottom: 38,
            zIndex: 1,
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.08)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {/* Shimmer overlay */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0) 100%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 2.5s infinite',
            pointerEvents: 'none',
          }} />
          <span style={{ position: 'relative', zIndex: 1 }}>Enter the Arena</span>
        </button>

        {/* Live Stats Row — increased slightly more */}
        <div
          className="glass-card landing-stats-card"
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '24px 38px',
            borderRadius: 22,
            maxWidth: 450,
            width: '100%',
            border: '1px solid rgba(90,138,176,0.22)',
            background: 'rgba(6,30,60,0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            position: 'relative',
            overflow: 'hidden',
            transition: 'transform 0.4s ease, border-color 0.3s ease',
            zIndex: 1,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-4px)'
            e.currentTarget.style.borderColor = 'rgba(90,138,176,0.45)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.borderColor = 'rgba(90,138,176,0.22)'
          }}
        >
          {/* Hover crystal gradient */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, rgba(90,138,176,0.08), transparent, rgba(90,138,176,0.08))',
            pointerEvents: 'none',
          }} />

          {/* Active Calls */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative', zIndex: 1 }}>
            <span style={{
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
              fontSize: 'clamp(30px, 4.5vw, 40px)',
              fontWeight: 700,
              color: 'var(--text-primary, #E4E8EC)',
              letterSpacing: -0.5,
              lineHeight: 1.1,
            }}>
              {activeMarkets ?? 0}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
              fontSize: 11,
              fontWeight: 600,
              color: 'rgba(142,159,176,0.8)',
              textTransform: 'uppercase',
              letterSpacing: 2,
              whiteSpace: 'nowrap',
            }}>
              Active Calls
            </span>
          </div>

          {/* Vertical divider */}
          <div className="landing-stats-divider" style={{
            width: 1,
            height: 42,
            background: 'linear-gradient(180deg, transparent, rgba(90,138,176,0.4), transparent)',
            margin: '0 24px',
            flexShrink: 0,
          }} />

          {/* Total Callers */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative', zIndex: 1 }}>
            <span style={{
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
              fontSize: 'clamp(30px, 4.5vw, 40px)',
              fontWeight: 700,
              color: 'var(--text-primary, #E4E8EC)',
              letterSpacing: -0.5,
              lineHeight: 1.1,
            }}>
              {totalCallers ?? 0}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
              fontSize: 11,
              fontWeight: 600,
              color: 'rgba(142,159,176,0.8)',
              textTransform: 'uppercase',
              letterSpacing: 2,
              whiteSpace: 'nowrap',
            }}>
              Total Callers
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
