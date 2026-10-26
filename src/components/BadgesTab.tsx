import { useState, useEffect } from 'react'
import { publicClient, writeContract, getMaxFeePerGas } from '../contexts/SessionWalletContext'
import { useToast } from '../contexts/ToastContext'
import { ACHIEVEMENT_REGISTRY_ADDRESS } from '../constants'
import { ACHIEVEMENT_REGISTRY_ABI } from '../abis'
import { buildXShareUrl } from '../utils/format'
import type { Account, WalletClient } from 'viem'

// Minimal type for session wallet prop
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

const BADGES = [
  { id: 0, name: 'Starter',  threshold: 1,   icon: '🌱', desc: 'Place your first call',  color: '#fbbf24' },
  { id: 1, name: 'Caller',   threshold: 10,  icon: '📞', desc: 'Make 10 calls',           color: '#5a8ab0' },
  { id: 2, name: 'Oracle',   threshold: 100, icon: '🔮', desc: 'Make 100 calls',          color: '#a78bfa' },
  { id: 3, name: 'OG',       threshold: 500, icon: '👑', desc: 'Make 500 calls',          color: '#f0c040' },
]

export default function BadgesTab({ address, sessionWallet, betCount }: Props) {
  const { showPending, showConfirmed, showFailed } = useToast()
  const [mintedIds, setMintedIds] = useState<Set<number>>(new Set())
  const [minting, setMinting] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) return
    const load = async () => {
      try {
        const results = await Promise.all(
          BADGES.map(b =>
            publicClient.readContract({
              address: ACHIEVEMENT_REGISTRY_ADDRESS,
              abi: ACHIEVEMENT_REGISTRY_ABI,
              functionName: 'hasBadge',
              args: [address as `0x${string}`, b.id],
            }).catch(() => false)
          )
        )
        const ids = new Set<number>()
        results.forEach((has, i) => { if (has) ids.add(BADGES[i].id) })
        setMintedIds(ids)
      } catch { /* ignore */ }
      setLoading(false)
    }
    load()
  }, [address])

  const handleMint = async (badgeId: number) => {
    if (!sessionWallet) return
    setMinting(badgeId)
    showPending('Minting badge...')
    try {
      const maxFeePerGas = await getMaxFeePerGas()

      const hash = await writeContract(sessionWallet.client, {
        address: ACHIEVEMENT_REGISTRY_ADDRESS,
        abi: ACHIEVEMENT_REGISTRY_ABI as never,
        functionName: 'mintBadge',
        args: [BigInt(badgeId)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      setMintedIds(prev => new Set([...prev, badgeId]))
      showConfirmed(hash, 'Badge minted!')
    } catch (e: unknown) {
      showFailed((e as Error)?.message?.slice(0, 80) ?? 'Mint failed')
    }
    setMinting(null)
  }

  const mintedCount = mintedIds.size
  const shareText = `I've earned ${mintedCount} badge${mintedCount !== 1 ? 's' : ''} on Arc Calls! 🏆\nJoin me: https://arccalls.xyz`

  const nextBadge = BADGES.find(b => !mintedIds.has(b.id) && betCount < b.threshold)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Stats header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: 'Total Calls', value: betCount, icon: '🎯' },
          { label: 'Badges Earned', value: `${mintedCount}/4`, icon: '🏅' },
          { label: 'Next Unlock', value: nextBadge ? `${nextBadge.threshold - betCount} more` : 'All earned!', icon: '🔓' },
        ].map(s => (
          <div key={s.label} className="glass-card" style={{ padding: '14px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 2×2 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {BADGES.map(badge => {
          const isMinted = mintedIds.has(badge.id)
          const isEligible = !isMinted && betCount >= badge.threshold
          const progress = Math.min(betCount / badge.threshold, 1)
          const isMintingThis = minting === badge.id

          return (
            <div
              key={badge.id}
              className="glass-card"
              style={{
                padding: '20px 18px',
                display: 'flex', flexDirection: 'column', gap: 10,
                borderColor: isMinted ? `${badge.color}40` : undefined,
                boxShadow: isMinted ? `0 0 20px ${badge.color}20` : undefined,
                transition: 'border-color 300ms ease, box-shadow 300ms ease',
              }}
            >
              {/* Icon + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  className={isMinted ? 'badge-float-icon' : ''}
                  style={{ fontSize: 28, display: 'inline-block' }}
                >{badge.icon}</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', color: isMinted ? badge.color : 'var(--text-primary)' }}>
                    {badge.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{badge.desc}</div>
                </div>
              </div>

              {/* Threshold */}
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                Requires {badge.threshold} call{badge.threshold !== 1 ? 's' : ''}
              </div>

              {/* Minted */}
              {isMinted && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: badge.color, fontSize: 12, fontWeight: 700 }}>
                  <span>✓</span> Minted
                </div>
              )}

              {/* Eligible — mint button */}
              {isEligible && (
                <button
                  onClick={() => handleMint(badge.id)}
                  disabled={!!isMintingThis || loading}
                  className="btn-primary btn-primary-pulse"
                  style={{ fontSize: 12, padding: '7px 14px', background: `${badge.color}22`, borderColor: `${badge.color}60`, color: badge.color }}
                >
                  {isMintingThis ? 'Minting…' : 'Mint Badge'}
                </button>
              )}

              {/* Not eligible — progress bar */}
              {!isMinted && !isEligible && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ height: 4, borderRadius: 4, background: 'rgba(54,97,132,0.2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 4, background: badge.color, width: `${progress * 100}%`, transition: 'width 600ms ease' }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {betCount} / {badge.threshold} · {badge.threshold - betCount} more needed
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Share button */}
      {mintedCount > 0 && (
        <div style={{ textAlign: 'center' }}>
          <a
            href={buildXShareUrl(shareText)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', padding: '9px 20px' }}
          >
            𝕏 Share my badges
          </a>
        </div>
      )}
    </div>
  )
}
