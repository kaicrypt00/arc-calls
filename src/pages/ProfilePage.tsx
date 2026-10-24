import { useState, useEffect } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useSessionWallet, getMaxFeePerGas, publicClient, writeContract } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, type DbBet } from '../lib/supabase'
import { PROFILE_REGISTRY_ADDRESS, ACHIEVEMENT_REGISTRY_ADDRESS } from '../constants'
import { PROFILE_REGISTRY_ABI, ACHIEVEMENT_REGISTRY_ABI } from '../abis'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { EXPLORER_URL } from '../config'

const BADGES = [
  { index: 0, name: 'Starter', icon: '⭐', threshold: 1,   desc: 'Place your first bet',    color: '#fbbf24' },
  { index: 1, name: 'Caller',  icon: '📣', threshold: 10,  desc: '10 bets placed',           color: '#5a8ab0' },
  { index: 2, name: 'Oracle',  icon: '🔮', threshold: 100, desc: '100 bets placed',          color: '#a78bfa' },
  { index: 3, name: 'OG',      icon: '👑', threshold: 500, desc: '500 bets — legend status', color: '#f0c040' },
]

function GateConnect() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 52 }}>🔒</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>Connect Your Wallet</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 340, lineHeight: 1.8 }}>
        Connect and set up a profile to access this page.
      </div>
      <ConnectButton label="Connect Wallet" showBalance={false} chainStatus="none" />
    </div>
  )
}

function GateActivate({ isCreating, createSessionWallet }: { isCreating: boolean; createSessionWallet: () => void }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 52, animation: 'pulse-dot 1.8s ease infinite' }}>⚡</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>Activate Arc Calls Wallet</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 380, lineHeight: 1.8 }}>
        Sign a one-time message to generate your seamless session wallet. No gas needed — just a signature.
      </div>
      <button onClick={createSessionWallet} disabled={isCreating} style={{
        background: 'linear-gradient(135deg, #062a51, #0d4a8a)',
        color: 'var(--text-primary)', border: '1px solid rgba(90,138,176,0.4)',
        borderRadius: 12, padding: '14px 44px', fontSize: 15, fontWeight: 700,
        cursor: isCreating ? 'not-allowed' : 'pointer', opacity: isCreating ? 0.7 : 1,
        boxShadow: '0 4px 20px rgba(54,97,132,0.3)',
      }}>
        {isCreating ? 'Waiting for signature…' : 'Activate Arc Calls Wallet'}
      </button>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Derived deterministically from your signature.</div>
    </div>
  )
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { sessionWallet, usdcBalance, hasSessionWallet, createSessionWallet, isCreating, loadBalances } = useSessionWallet()
  const { profile, refreshProfile, setShowMintModal } = useProfile()
  const { showPending, showConfirmed, showFailed } = useToast()

  const [tab, setTab]               = useState<'calls' | 'badges'>('calls')
  const [bets, setBets]             = useState<DbBet[]>([])
  const [betTitles, setBetTitles]   = useState<Record<number, string>>({})
  const [betCount, setBetCount]     = useState(0)
  const [wins, setWins]             = useState(0)
  const [pnl, setPnl]               = useState(0)
  const [badgeStates, setBadgeStates] = useState<boolean[]>([false, false, false, false])
  const [mintingBadge, setMintingBadge] = useState<number | null>(null)
  const [editOpen, setEditOpen]     = useState(false)
  const [editName, setEditName]     = useState('')
  const [editBio, setEditBio]       = useState('')
  const [editX, setEditX]           = useState('')
  const [saving, setSaving]         = useState(false)
  const [copiedSW, setCopiedSW]     = useState(false)

  const wallet = sessionWallet?.address ?? address

  useEffect(() => {
    if (!wallet) return
    supabase.from('bets').select('*').eq('wallet_address', wallet.toLowerCase()).order('created_at', { ascending: false }).then(async ({ data }) => {
      if (!data) return
      setBets(data as DbBet[])
      setBetCount(data.length)
      const wonBets = (data as DbBet[]).filter(b => b.result === 'won')
      setWins(wonBets.length)
      setPnl((data as DbBet[]).reduce((s, b) => s + Number(b.payout ?? 0) - Number(b.amount ?? 0), 0))
      const ids = [...new Set((data as DbBet[]).map(b => b.prediction_id))]
      if (ids.length > 0) {
        const { data: preds } = await supabase.from('predictions_display').select('id,title').in('id', ids)
        if (preds) {
          const map: Record<number, string> = {}
          ;(preds as { id: number; title: string }[]).forEach(p => { map[p.id] = p.title })
          setBetTitles(map)
        }
      }
    })
  }, [wallet])

  useEffect(() => {
    if (!wallet || !ACHIEVEMENT_REGISTRY_ADDRESS) return
    publicClient.readContract({
      address: ACHIEVEMENT_REGISTRY_ADDRESS, abi: ACHIEVEMENT_REGISTRY_ABI,
      functionName: 'getAllBadges', args: [wallet],
    }).then(r => {
      const [s, c, o, og] = r as [boolean, boolean, boolean, boolean]
      setBadgeStates([s, c, o, og])
    }).catch(() => {})
  }, [wallet])

  const mintBadge = async (idx: number) => {
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    setMintingBadge(idx)
    showPending(`Minting ${BADGES[idx].name} badge…`)
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: ACHIEVEMENT_REGISTRY_ADDRESS, abi: ACHIEVEMENT_REGISTRY_ABI as never,
        functionName: 'mintBadge', args: [idx], maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, `${BADGES[idx].name} badge minted!`)
      const ns = [...badgeStates]; ns[idx] = true; setBadgeStates(ns)
    } catch (e) { showFailed((e as Error).message?.slice(0, 80) ?? 'Minting failed') }
    finally { setMintingBadge(null) }
  }

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionWallet) return
    setSaving(true); showPending('Updating profile…')
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: PROFILE_REGISTRY_ADDRESS, abi: PROFILE_REGISTRY_ABI as never,
        functionName: 'updateProfile',
        args: [editName.slice(0, 50), editBio.slice(0, 160), profile?.pfp_url ?? '', editX.replace('@', '').slice(0, 15)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      await supabase.from('profiles').update({ name: editName, bio: editBio, x_username: editX.replace('@', '') }).eq('wallet_address', wallet?.toLowerCase() ?? '')
      showConfirmed(hash, 'Profile updated!')
      await refreshProfile(); setEditOpen(false)
    } catch (e) { showFailed((e as Error).message?.slice(0, 80) ?? 'Update failed') }
    finally { setSaving(false) }
  }

  const winRate = betCount > 0 ? ((wins / betCount) * 100).toFixed(0) : '0'

  const copySW = () => {
    if (sessionWallet) navigator.clipboard.writeText(sessionWallet.address)
    setCopiedSW(true); setTimeout(() => setCopiedSW(false), 1400)
  }

  /* ── Gates ── */
  if (!isConnected) return (
    <div className="page"><Navbar /><GateConnect /><Footer /></div>
  )
  if (!hasSessionWallet) return (
    <div className="page"><Navbar /><GateActivate isCreating={isCreating} createSessionWallet={createSessionWallet} /><Footer /></div>
  )
  if (!profile) return (
    <div className="page">
      <Navbar />
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 52 }}>🔒</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Set Up Your Profile</div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.8 }}>
          Connect and set up a profile to view this page.
        </div>
        <button onClick={() => setShowMintModal(true)} style={{
          background: 'linear-gradient(135deg, #062a51, #0d4a8a)',
          color: 'var(--text-primary)', border: '1px solid rgba(90,138,176,0.4)',
          borderRadius: 12, padding: '13px 40px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(54,97,132,0.3)',
        }}>
          Set Up Profile
        </button>
      </div>
      <Footer />
    </div>
  )

  /* ── Full profile ── */
  const statCards = [
    { label: 'Total Calls', value: betCount,                            color: 'var(--text-primary)', icon: '🎯' },
    { label: 'Wins',        value: wins,                                color: 'var(--yes-color)',    icon: '🏆' },
    { label: 'Win Rate',    value: `${winRate}%`,                       color: 'var(--accent-bright)', icon: '📊' },
    { label: 'P&L',         value: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`, color: pnl >= 0 ? 'var(--yes-color)' : 'var(--no-color)', icon: '💰' },
  ]

  return (
    <div className="page" style={{ position: 'relative', zIndex: 1 }}>
      <Navbar />

      {/* Profile hero banner */}
      <div style={{
        background: `linear-gradient(180deg, rgba(54,97,132,0.15) 0%, transparent 100%)`,
        borderBottom: '1px solid var(--border-subtle)',
        padding: '32px 20px 28px',
      }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Avatar */}
            <div style={{ flexShrink: 0, position: 'relative' }}>
              {profile.pfp_url
                ? <img src={profile.pfp_url} alt="" style={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 0 3px rgba(54,97,132,0.5), 0 0 30px rgba(54,97,132,0.3)' }} />
                : <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-blue), #010d1f)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, boxShadow: '0 0 0 3px rgba(54,97,132,0.4), 0 0 24px rgba(54,97,132,0.25)' }}>👤</div>
              }
              <span style={{ position: 'absolute', bottom: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: 'var(--yes-color)', border: '2px solid var(--bg-primary)', display: 'block', animation: 'pulse-dot 2s ease infinite' }} />
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, letterSpacing: '-0.3px' }}>{profile.name}</div>
              {profile.bio && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.6 }}>{profile.bio}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {profile.x_username && (
                  <a href={`https://x.com/${profile.x_username}`} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--accent-bright)', background: 'rgba(90,138,176,0.1)', border: '1px solid rgba(90,138,176,0.2)', borderRadius: 20, padding: '3px 10px' }}>
                    𝕏 @{profile.x_username}
                  </a>
                )}
                <button onClick={() => navigator.clipboard.writeText(wallet ?? '')}
                  style={{ background: 'rgba(6,30,60,0.6)', color: 'var(--text-secondary)', fontSize: 11, border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}>
                  ⎘ Copy Address
                </button>
                <button onClick={() => { setEditName(profile.name); setEditBio(profile.bio ?? ''); setEditX(profile.x_username ?? ''); setEditOpen(true) }}
                  className="btn-primary" style={{ fontSize: 11, padding: '4px 14px' }}>
                  Edit Profile
                </button>
              </div>
            </div>

            {/* Disconnect */}
            <button onClick={() => disconnect()} className="btn-danger" style={{ flexShrink: 0, fontSize: 12 }}>
              Disconnect
            </button>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: '28px 20px', maxWidth: 820 }}>

        {/* Session wallet card */}
        {sessionWallet && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(6,30,60,0.8) 0%, rgba(6,42,81,0.5) 100%)',
            border: '1px solid rgba(90,138,176,0.2)', borderRadius: 18, padding: '20px 22px', marginBottom: 18,
            boxShadow: '0 4px 24px rgba(0,0,0,0.2), inset 0 0 40px rgba(54,97,132,0.04)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 1 }}>Arc Calls Wallet</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Your seamless betting wallet</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--yes-color)', display: 'inline-block', animation: 'pulse-dot 2s ease infinite' }} />
                <span style={{ fontSize: 12, color: 'var(--yes-color)', fontWeight: 600 }}>Active</span>
                <button onClick={loadBalances} style={{ background: 'rgba(90,138,176,0.1)', border: '1px solid rgba(90,138,176,0.2)', color: 'var(--text-secondary)', fontSize: 13, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}>↻</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180, padding: '14px 16px', background: 'rgba(6,18,38,0.5)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                <div className="section-label" style={{ marginBottom: 6 }}>Address</div>
                <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--text-primary)', lineHeight: 1.7 }}>{sessionWallet.address}</div>
                <button onClick={copySW} style={{ background: 'none', color: 'var(--accent-bright)', fontSize: 11, marginTop: 8, padding: 0, border: 'none', cursor: 'pointer' }}>
                  {copiedSW ? '✓ Copied!' : '⎘ Copy'}
                </button>
              </div>
              <div style={{ padding: '14px 20px', background: 'rgba(6,18,38,0.5)', borderRadius: 12, border: '1px solid var(--border-subtle)', minWidth: 140 }}>
                <div className="section-label" style={{ marginBottom: 8 }}>USDC Balance</div>
                <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, animation: 'count-up 400ms ease' }}>{usdcBalance}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>Gas &amp; Betting · Arc</div>
              </div>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 22 }}>
          {statCards.map((s, i) => (
            <div key={s.label} className="stat-card" style={{ animation: `fadeInUp 400ms ease ${i * 60}ms both` }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>{s.icon}</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div className="section-label" style={{ marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="tab-bar" style={{ marginBottom: 16 }}>
          {(['calls', 'badges'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`tab-btn${tab === t ? ' active' : ''}`}>
              {t === 'calls' ? '📋 My Calls' : '🏅 Badges'}
            </button>
          ))}
        </div>

        {/* My Calls */}
        {tab === 'calls' && (
          <div style={{ background: 'rgba(6,18,38,0.6)', border: '1px solid var(--border-default)', borderRadius: 16, overflow: 'hidden' }}>
            {bets.length === 0 ? (
              <div style={{ padding: 56, textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>No Calls Yet</div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Head to Markets to place your first call!</div>
              </div>
            ) : bets.map((b, i) => (
              <div key={b.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 60px 90px 70px 52px',
                padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)',
                alignItems: 'center', gap: 10, transition: 'background 150ms',
                animation: `fadeIn 250ms ease ${Math.min(i * 20, 200)}ms both`,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(54,97,132,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                  {betTitles[b.prediction_id] ? betTitles[b.prediction_id].slice(0, 60) : `Prediction #${b.prediction_id}`}
                </span>
                <span className={`badge ${b.side === 'YES' ? 'badge-yes' : 'badge-no'}`}>{b.side}</span>
                <span className="mono" style={{ fontSize: 12, textAlign: 'right' }}>{Number(b.amount).toFixed(2)} USDC</span>
                <span style={{ fontSize: 12, textAlign: 'center', color: b.result === 'won' ? 'var(--yes-color)' : b.result === 'lost' ? 'var(--no-color)' : 'var(--pending)' }}>{b.result}</span>
                <a href={`${EXPLORER_URL}/tx/${b.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent-bright)', textAlign: 'center' }}>↗</a>
              </div>
            ))}
          </div>
        )}

        {/* Badges */}
        {tab === 'badges' && (
          <div className="grid-2">
            {BADGES.map((badge, i) => {
              const minted   = badgeStates[badge.index]
              const eligible = betCount >= badge.threshold
              return (
                <div key={badge.index} style={{
                  background: 'var(--bg-card)', border: `1px solid ${minted ? badge.color + '44' : 'var(--border-default)'}`,
                  borderRadius: 18, padding: '22px 20px', backdropFilter: 'blur(20px)',
                  boxShadow: minted ? `0 0 20px ${badge.color}22` : 'none',
                  transition: 'all 250ms ease', animation: `fadeInUp 400ms ease ${i * 80}ms both`,
                  position: 'relative', overflow: 'hidden',
                }}>
                  {minted && <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: `radial-gradient(circle at top right, ${badge.color}18, transparent)`, pointerEvents: 'none' }} />}
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 36, filter: minted ? 'none' : 'grayscale(1) opacity(0.35)', transition: 'filter 300ms ease' }}>{badge.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3, color: minted ? badge.color : 'var(--text-primary)' }}>{badge.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>{badge.desc}</div>
                      {minted
                        ? <span className="badge badge-open" style={{ fontSize: 10 }}>✓ Minted</span>
                        : eligible
                          ? <button onClick={() => mintBadge(badge.index)} disabled={mintingBadge === badge.index} className="btn-primary" style={{ fontSize: 12, padding: '6px 16px', background: `${badge.color}18`, borderColor: `${badge.color}44`, color: badge.color }}>
                              {mintingBadge === badge.index ? 'Minting…' : 'Mint Badge'}
                            </button>
                          : <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>🔒 {badge.threshold - betCount} more bet{badge.threshold - betCount !== 1 ? 's' : ''} needed</div>
                      }
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8 }}>Paid in USDC gas</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit profile modal */}
      {editOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(1,8,22,0.88)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'rgba(6,18,38,0.98)', border: '1px solid var(--border-default)', borderRadius: 20, width: '100%', maxWidth: 420, padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Edit Profile</div>
            <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input value={editName} onChange={e => setEditName(e.target.value.slice(0, 50))} placeholder="Display name" maxLength={50} required />
              <textarea value={editBio} onChange={e => setEditBio(e.target.value.slice(0, 160))} placeholder="Bio" maxLength={160} rows={2} style={{ resize: 'none' }} />
              <input value={editX} onChange={e => setEditX(e.target.value.replace('@', '').slice(0, 15))} placeholder="X username (no @)" maxLength={15} />
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button type="button" onClick={() => setEditOpen(false)} className="btn-primary" style={{ flex: 1, background: 'var(--bg-glass)' }}>Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1, background: 'var(--accent-blue)', borderColor: 'rgba(90,138,176,0.4)' }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}
