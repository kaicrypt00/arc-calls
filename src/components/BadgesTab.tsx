import { useState, useEffect, useCallback } from 'react'
import { publicClient, writeContract, getMaxFeePerGas } from '../contexts/SessionWalletContext'
import { useToast } from '../contexts/ToastContext'
import { ACHIEVEMENT_REGISTRY_ADDRESS } from '../constants'
import { ACHIEVEMENT_REGISTRY_ABI } from '../abis'
import { supabase } from '../lib/supabase'
import { buildXShareUrl } from '../utils/format'
import type { Account, WalletClient } from 'viem'

interface SessionWalletLike {
  client: WalletClient
  address: `0x${string}`
  account: Account
}

interface Props {
  address: string
  sessionWallet: SessionWalletLike | null
  betCount: number
}

// Arc theme badge metadata:
// Starter: Arc Cyan (#38bdf8)
// Caller: Electric Arc Blue (#60a5fa)
// Oracle: Quantum Indigo (#818cf8)
// OG: Arc Royal Purple (#a78bfa)
const BADGES = [
  { id: 0, name: 'Starter', threshold: 1,   icon: '🔮', desc: 'Made your first call on Arc Calls.',             color: '#38bdf8', colorRgb: '56, 189, 248'  },
  { id: 1, name: 'Caller',  threshold: 10,  icon: '📡', desc: 'Placed 10 calls. You know the game.',            color: '#60a5fa', colorRgb: '96, 165, 250'  },
  { id: 2, name: 'Oracle',  threshold: 100, icon: '🌀', desc: 'Placed 100 calls. The community trusts your eye.', color: '#818cf8', colorRgb: '129, 140, 248' },
  { id: 3, name: 'OG',      threshold: 500, icon: '👑', desc: 'Placed 500 calls. A legend of Arc Calls.',       color: '#a78bfa', colorRgb: '167, 139, 250' },
]

export default function BadgesTab({ address, sessionWallet, betCount }: Props) {
  const { showPending, showConfirmed, showFailed } = useToast()
  const [mintedIds, setMintedIds] = useState<Set<number>>(new Set())
  const [onChainBets, setOnChainBets] = useState<number>(betCount)
  const [minting, setMinting] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const activeWallet = sessionWallet?.address ?? (address ? (address as `0x${string}`) : null)

  const loadData = useCallback(async (silent = false) => {
    if (!activeWallet) return
    if (!silent) setLoading(true)
    try {
      const [s0, s1, s2, s3, chainCount] = await Promise.all([
        publicClient.readContract({
          address: ACHIEVEMENT_REGISTRY_ADDRESS,
          abi: ACHIEVEMENT_REGISTRY_ABI,
          functionName: 'hasBadge',
          args: [activeWallet, 0],
        }).catch(() => false),
        publicClient.readContract({
          address: ACHIEVEMENT_REGISTRY_ADDRESS,
          abi: ACHIEVEMENT_REGISTRY_ABI,
          functionName: 'hasBadge',
          args: [activeWallet, 1],
        }).catch(() => false),
        publicClient.readContract({
          address: ACHIEVEMENT_REGISTRY_ADDRESS,
          abi: ACHIEVEMENT_REGISTRY_ABI,
          functionName: 'hasBadge',
          args: [activeWallet, 2],
        }).catch(() => false),
        publicClient.readContract({
          address: ACHIEVEMENT_REGISTRY_ADDRESS,
          abi: ACHIEVEMENT_REGISTRY_ABI,
          functionName: 'hasBadge',
          args: [activeWallet, 3],
        }).catch(() => false),
        publicClient.readContract({
          address: ACHIEVEMENT_REGISTRY_ADDRESS,
          abi: ACHIEVEMENT_REGISTRY_ABI,
          functionName: 'getBetCount',
          args: [activeWallet],
        }).catch(() => BigInt(betCount)),
      ])

      const ids = new Set<number>()
      if (s0) ids.add(0)
      if (s1) ids.add(1)
      if (s2) ids.add(2)
      if (s3) ids.add(3)

      setMintedIds(prev => new Set([...prev, ...ids]))
      const finalCount = Math.max(Number(chainCount), betCount)
      setOnChainBets(finalCount)
    } catch {
      /* ignore */
    } finally {
      if (!silent) setLoading(false)
    }
  }, [activeWallet, betCount])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleMint = async (badgeId: number) => {
    if (!sessionWallet || minting !== null) return
    const badge = BADGES[badgeId]
    setMinting(badgeId)
    showPending(`Minting ${badge.name} badge...`)
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: ACHIEVEMENT_REGISTRY_ADDRESS,
        abi: ACHIEVEMENT_REGISTRY_ABI as never,
        functionName: 'mintBadge',
        args: [BigInt(badgeId)],
        maxFeePerGas,
      })
      showPending('Waiting for confirmation...')
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status === 'reverted') throw new Error('Badge mint reverted on-chain.')

      // Optimistic update
      setMintedIds(prev => new Set([...prev, badgeId]))
      showConfirmed(hash, `${badge.name} badge minted! 🔮`)

      // Record transaction into session wallet history
      supabase.from('wallet_transactions').insert({
        wallet_address: sessionWallet.address.toLowerCase(),
        type: 'claim',
        label: `Minted ${badge.name} badge`,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      }).then(() => {})

      loadData(true)
    } catch (e: unknown) {
      showFailed((e as Error)?.message?.slice(0, 80) ?? 'Mint failed')
    } finally {
      setMinting(null)
    }
  }

  const effectiveBetCount = Math.max(onChainBets, betCount)
  const mintedCount = mintedIds.size
  const eligibleBadges = BADGES.filter(b => !mintedIds.has(b.id) && effectiveBetCount >= b.threshold)
  const nextBadge = BADGES.find(b => !mintedIds.has(b.id) && effectiveBetCount < b.threshold)

  const statsRow = [
    { label: 'TOTAL CALLS',   value: String(effectiveBetCount) },
    { label: 'BADGES EARNED', value: `${mintedCount} / 4` },
    { label: 'NEXT UNLOCK',   value: nextBadge ? `${nextBadge.threshold - effectiveBetCount} more` : mintedCount === 4 ? '🏆 All earned!' : 'Ready to mint!' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Stats header — single card, 3 columns, vertical dividers */}
      <div style={{
        background: 'rgba(6, 18, 38, 0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(56, 189, 248, 0.16)',
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {statsRow.map((s, i) => (
            <div key={s.label} style={{
              padding: '18px 22px',
              borderRight: i < 2 ? '1px solid rgba(56, 189, 248, 0.12)' : 'none',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase' as const,
                color: 'var(--text-tertiary, #64748b)',
                marginBottom: 6,
              }}>
                {s.label}
              </div>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 22,
                fontWeight: 700,
                color: '#f8fafc',
              }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Eligible alert banner — appears when any badge is unlocked and ready to mint */}
      {eligibleBadges.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.14) 0%, rgba(6, 18, 38, 0.85) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.45)',
          borderRadius: 12,
          padding: '14px 20px',
          boxShadow: '0 4px 24px rgba(56, 189, 248, 0.18)',
        }}>
          <span style={{ fontSize: 20 }}>🎉</span>
          <span style={{ color: '#f8fafc', fontSize: 13, fontWeight: 600 }}>
            <strong style={{ color: '#38bdf8' }}>{eligibleBadges.map(b => b.name).join(' & ')}</strong> badge{eligibleBadges.length > 1 ? 's' : ''} ready to mint!
          </span>
        </div>
      )}

      {/* Badge cards grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary, #64748b)', fontSize: 13 }}>
          Loading badges from chain...
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 16 }}>
          {BADGES.map(badge => {
            const isMinted = mintedIds.has(badge.id)
            const isEligible = !isMinted && effectiveBetCount >= badge.threshold
            const progress = Math.min(effectiveBetCount, badge.threshold)
            const pct = Math.round((progress / badge.threshold) * 100)
            const isMintingThis = minting === badge.id
            return (
              <BadgeCard
                key={badge.id}
                badge={badge}
                isMinted={isMinted}
                isEligible={isEligible}
                progress={progress}
                pct={pct}
                isMintingThis={isMintingThis}
                onMint={() => handleMint(badge.id)}
              />
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes badge-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes badge-edge-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes badge-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes badge-unlocked-glow {
          0%, 100% {
            box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35), 0 4px 20px rgba(6, 18, 38, 0.6);
          }
          50% {
            box-shadow: 0 0 24px rgba(56, 189, 248, 0.35), 0 0 0 1.5px rgba(56, 189, 248, 0.7);
          }
        }
        @keyframes badge-shine-sweep {
          0% {
            transform: translateX(-150%) rotate(25deg);
          }
          30%, 100% {
            transform: translateX(350%) rotate(25deg);
          }
        }

        /* Spinning conic border for earned badges in Arc theme */
        .badge-earned-shell {
          position: relative;
          border-radius: 18px;
          overflow: hidden;
        }
        .badge-earned-shell::before {
          content: '';
          position: absolute;
          width: 200%;
          height: 200%;
          top: -50%;
          left: -50%;
          background: conic-gradient(
            transparent 0deg,
            transparent 140deg,
            rgba(56, 189, 248, 0.95) 165deg,
            rgba(147, 197, 253, 0.8) 180deg,
            rgba(56, 189, 248, 0.95) 195deg,
            transparent 220deg,
            transparent 360deg
          );
          animation: badge-edge-spin 1.8s linear infinite;
          z-index: 0;
        }

        /* Light shine sweep effect across minted badges */
        .badge-shine-effect {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          border-radius: 16px;
          z-index: 2;
        }
        .badge-shine-effect::after {
          content: '';
          position: absolute;
          top: -60%;
          left: 0;
          width: 45%;
          height: 220%;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(56, 189, 248, 0.08) 25%,
            rgba(255, 255, 255, 0.35) 50%,
            rgba(56, 189, 248, 0.08) 75%,
            transparent 100%
          );
          animation: badge-shine-sweep 4.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}

// ─── Badge Card ───────────────────────────────────────────────────────────────
function BadgeCard({
  badge,
  isMinted,
  isEligible,
  progress,
  pct,
  isMintingThis,
  onMint,
}: {
  badge: typeof BADGES[0]
  isMinted: boolean
  isEligible: boolean
  progress: number
  pct: number
  isMintingThis: boolean
  onMint: () => void
}) {
  const [hovered, setHovered] = useState(false)

  const handleShareX = () => {
    const text = `Just earned the ${badge.name} badge on Arc Calls 🔮\n${badge.desc}\nhttps://arccalls.xyz`
    window.open(buildXShareUrl(text), '_blank')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. EARNED / MINTED STATE
  // Conic spinning border + light shine sweep effect + floating radiant icon
  // ═══════════════════════════════════════════════════════════════════════════
  if (isMinted) {
    return (
      <div
        className="badge-earned-shell"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Card body on top of spinning border */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            margin: '1.5px',
            borderRadius: '16px',
            background: `linear-gradient(155deg, rgba(${badge.colorRgb}, 0.16) 0%, rgba(6, 18, 38, 0.95) 45%, #020617 100%)`,
            padding: '24px 20px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
            transition: 'transform 0.2s ease',
            cursor: 'default',
            overflow: 'hidden',
          }}
        >
          {/* Light shine sweep effect */}
          <div className="badge-shine-effect" />

          {/* Corner radiance */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 120,
              height: 120,
              background: `radial-gradient(circle at top right, rgba(${badge.colorRgb}, 0.28), transparent 65%)`,
              pointerEvents: 'none',
            }}
          />

          {/* ✓ EARNED pill */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase' as const,
              padding: '3px 8px',
              borderRadius: 5,
              background: `rgba(${badge.colorRgb}, 0.2)`,
              border: `1px solid rgba(${badge.colorRgb}, 0.55)`,
              color: badge.color,
              boxShadow: `0 0 10px rgba(${badge.colorRgb}, 0.25)`,
            }}
          >
            ✓ EARNED
          </div>

          {/* Icon — floating + glowing radiant frame */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(${badge.colorRgb}, 0.3) 0%, rgba(${badge.colorRgb}, 0.08) 70%)`,
              border: `1.5px solid rgba(${badge.colorRgb}, 0.6)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 38,
              boxShadow: `0 0 30px rgba(${badge.colorRgb}, 0.4), 0 0 10px rgba(${badge.colorRgb}, 0.2)`,
              animation: 'badge-float 3s ease-in-out infinite',
            }}
          >
            {badge.icon}
          </div>

          {/* Name */}
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: badge.color,
              letterSpacing: '0.02em',
              textAlign: 'center',
            }}
          >
            {badge.name}
          </div>

          {/* Description */}
          <div
            style={{
              fontSize: 11.5,
              color: 'rgba(226, 232, 240, 0.75)',
              textAlign: 'center',
              lineHeight: 1.5,
              padding: '0 4px',
            }}
          >
            {badge.desc}
          </div>

          {/* Requirements */}
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-tertiary, #64748b)',
              textAlign: 'center',
              marginTop: -4,
              letterSpacing: '0.04em',
            }}
          >
            Requires {badge.threshold} call{badge.threshold !== 1 ? 's' : ''}
          </div>

          {/* Share on X */}
          <button
            onClick={handleShareX}
            style={{
              width: '100%',
              marginTop: 4,
              background: 'rgba(56, 189, 248, 0.06)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              borderRadius: 10,
              padding: '10px 0',
              color: 'rgba(241, 245, 249, 0.85)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              letterSpacing: '0.02em',
              outline: 'none',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'rgba(56, 189, 248, 0.16)'
              el.style.color = '#ffffff'
              el.style.borderColor = 'rgba(56, 189, 248, 0.45)'
              el.style.boxShadow = '0 0 14px rgba(56, 189, 248, 0.2)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'rgba(56, 189, 248, 0.06)'
              el.style.color = 'rgba(241, 245, 249, 0.85)'
              el.style.borderColor = 'rgba(56, 189, 248, 0.2)'
              el.style.boxShadow = 'none'
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700 }}>𝕏</span> Share on X
          </button>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. UNLOCKED / READY STATE
  // Bright, vibrant Arc cyan theme, full-color icon, glowing READY pill & button
  // ═══════════════════════════════════════════════════════════════════════════
  if (isEligible) {
    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: `linear-gradient(160deg, rgba(${badge.colorRgb}, 0.14) 0%, rgba(6, 18, 38, 0.95) 45%, #020617 100%)`,
          border: `1px solid rgba(${badge.colorRgb}, 0.55)`,
          borderRadius: 16,
          padding: '24px 20px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          position: 'relative',
          overflow: 'hidden',
          transition: 'all 0.25s ease',
          transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
          animation: 'badge-unlocked-glow 2.4s ease-in-out infinite',
        }}
      >
        {/* Subtle ambient light */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 130,
            height: 130,
            background: `radial-gradient(circle at top right, rgba(${badge.colorRgb}, 0.3), transparent 70%)`,
            pointerEvents: 'none',
          }}
        />

        {/* READY pill */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.12em',
            textTransform: 'uppercase' as const,
            padding: '3px 8px',
            borderRadius: 5,
            background: `rgba(${badge.colorRgb}, 0.22)`,
            border: `1px solid rgba(${badge.colorRgb}, 0.65)`,
            color: '#ffffff',
            boxShadow: `0 0 12px rgba(${badge.colorRgb}, 0.35)`,
          }}
        >
          READY
        </div>

        {/* Icon — Vibrant, illuminated, full-color emoji */}
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: '50%',
            background: `radial-gradient(circle, rgba(${badge.colorRgb}, 0.25) 0%, rgba(${badge.colorRgb}, 0.08) 70%)`,
            border: `1.5px solid rgba(${badge.colorRgb}, 0.55)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 36,
            boxShadow: `0 0 24px rgba(${badge.colorRgb}, 0.35), 0 0 8px rgba(${badge.colorRgb}, 0.2)`,
            transition: 'transform 0.2s ease',
            transform: hovered ? 'scale(1.08)' : 'scale(1)',
          }}
        >
          {badge.icon}
        </div>

        {/* Name — Bright white / Arc accent */}
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: '#f8fafc',
            letterSpacing: '0.02em',
            textAlign: 'center',
          }}
        >
          {badge.name}
        </div>

        {/* Description — crisp and clear */}
        <div
          style={{
            fontSize: 11.5,
            color: '#cbd5e1',
            textAlign: 'center',
            lineHeight: 1.5,
            padding: '0 4px',
          }}
        >
          {badge.desc}
        </div>

        {/* Requirements — complete */}
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: badge.color,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.08em',
          }}
        >
          ✓ {badge.threshold} bet{badge.threshold !== 1 ? 's' : ''} completed
        </div>

        {/* Mint Badge Button */}
        <button
          onClick={onMint}
          disabled={isMintingThis}
          style={{
            width: '100%',
            marginTop: 4,
            background: isMintingThis
              ? `rgba(${badge.colorRgb}, 0.15)`
              : `linear-gradient(135deg, rgba(${badge.colorRgb}, 0.38) 0%, rgba(${badge.colorRgb}, 0.18) 100%)`,
            border: `1px solid rgba(${badge.colorRgb}, 0.7)`,
            borderRadius: 10,
            padding: '11px 0',
            color: '#ffffff',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: isMintingThis ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: 'inherit',
            letterSpacing: '0.03em',
            boxShadow: `0 0 16px rgba(${badge.colorRgb}, 0.3)`,
            outline: 'none',
          }}
          onMouseEnter={e => {
            if (!isMintingThis) {
              const el = e.currentTarget as HTMLElement
              el.style.background = `linear-gradient(135deg, rgba(${badge.colorRgb}, 0.52) 0%, rgba(${badge.colorRgb}, 0.28) 100%)`
              el.style.boxShadow = `0 0 24px rgba(${badge.colorRgb}, 0.55)`
            }
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = `linear-gradient(135deg, rgba(${badge.colorRgb}, 0.38) 0%, rgba(${badge.colorRgb}, 0.18) 100%)`
            el.style.boxShadow = `0 0 16px rgba(${badge.colorRgb}, 0.3)`
          }}
        >
          {isMintingThis ? (
            <>
              <span
                style={{
                  width: 12,
                  height: 12,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#ffffff',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'badge-spin 0.7s linear infinite',
                }}
              />
              Minting...
            </>
          ) : (
            <>🔮 Mint Badge</>
          )}
        </button>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. LOCKED STATE
  // Dim, colorless, grayscale emoji, subtle borders (exact Rialo feel)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#060b14',
        border: hovered ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(255, 255, 255, 0.04)',
        borderRadius: 16,
        padding: '24px 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.25s, transform 0.2s',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {/* LOCKED pill */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase' as const,
          padding: '3px 7px',
          borderRadius: 5,
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          color: '#475569',
        }}
      >
        LOCKED
      </div>

      {/* Icon — Dim & Colorless */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 30,
          filter: 'grayscale(1) opacity(0.2)',
        }}
      >
        {badge.icon}
      </div>

      {/* Name */}
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: '#475569',
          letterSpacing: '0.01em',
        }}
      >
        {badge.name}
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: 11,
          color: '#334155',
          textAlign: 'center',
          lineHeight: 1.5,
          padding: '0 4px',
        }}
      >
        {badge.desc}
      </div>

      {/* Requirements */}
      <div
        style={{
          fontSize: 10,
          color: '#334155',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.08em',
        }}
      >
        {badge.threshold} bet{badge.threshold !== 1 ? 's' : ''}
      </div>

      {/* Progress bar */}
      <div style={{ width: '100%', marginTop: 4 }}>
        <div
          style={{
            height: 3,
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 3,
            overflow: 'hidden',
            marginBottom: 6,
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 3,
              width: `${pct}%`,
              background: pct > 50
                ? 'linear-gradient(90deg, rgba(56, 189, 248, 0.3), rgba(56, 189, 248, 0.5))'
                : 'rgba(56, 189, 248, 0.2)',
              transition: 'width 0.6s ease',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: '#334155',
          }}
        >
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{progress} / {badge.threshold}</span>
          <span>{pct}%</span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: '#334155',
            marginTop: 4,
            textAlign: 'center',
          }}
        >
          {badge.threshold - progress} more call{badge.threshold - progress !== 1 ? 's' : ''} needed
        </div>
      </div>
    </div>
  )
}
