import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { isAddress } from 'viem'
import { useSessionWallet } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, type DbWalletTransaction } from '../lib/supabase'
import { ADMIN_WALLETS, ARC_CHAIN_ID } from '../constants'
import { timeAgo } from '../utils/format'
import ArcLogo from './ArcLogo'
import SoundToggleButton from './SoundToggleButton'

/* ─── Session Wallet Dropdown ──────────────────────────────────────────── */
function SessionWalletDropdown() {
  const { sessionWallet, usdcBalance, isLoadingBalances, loadBalances, sendUSDC } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()
  const [open, setOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sendAmt, setSendAmt] = useState('')
  const [sending, setSending] = useState(false)
  const [txHistory, setTxHistory] = useState<DbWalletTransaction[]>([])
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (!sessionWallet || !open) return
    supabase.from('wallet_transactions')
      .select('*')
      .eq('wallet_address', sessionWallet.address.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (data) setTxHistory(data as DbWalletTransaction[]) })
  }, [open, sessionWallet])

  if (!sessionWallet) return null

  const handleSend = async () => {
    if (!isAddress(sendTo) || !sendAmt || parseFloat(sendAmt) <= 0) { showFailed('Invalid address or amount'); return }
    setSending(true)
    showPending('Sending USDC…')
    try {
      const hash = await sendUSDC(sendTo, sendAmt)
      showConfirmed(hash, `Sent ${sendAmt} USDC`)
      setSendTo(''); setSendAmt(''); setSendOpen(false)
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 80) ?? 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'relative' }} ref={dropRef}>
      {/* Pill trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          background: 'rgba(6,42,81,0.85)', border: '1px solid var(--border-default)',
          borderRadius: 20, padding: '6px 12px 6px 10px', cursor: 'pointer',
          color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
          transition: 'border-color 150ms', minWidth: 100,
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-bright)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--yes-color)', flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: 13 }}>{isLoadingBalances ? '…' : usdcBalance}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>USDC</span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 9, marginLeft: 2 }}>{open ? '▴' : '▾'}</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0,
          width: 300, background: 'rgba(4,20,52,0.98)', border: '1px solid var(--border-default)',
          borderRadius: 16, padding: 16, zIndex: 1000, backdropFilter: 'blur(24px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Arc Calls Wallet</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>Session wallet · Arc Mainnet</div>
            </div>
            <button onClick={loadBalances} title="Refresh balance"
              style={{ background: 'none', color: 'var(--text-secondary)', fontSize: 16, padding: 4, cursor: 'pointer', lineHeight: 1 }}>↻</button>
          </div>

          {/* Balance hero */}
          <div style={{
            padding: '14px 16px', borderRadius: 12, marginBottom: 12,
            background: 'linear-gradient(135deg, rgba(6,42,81,0.8), rgba(54,97,132,0.2))',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Balance</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)' }}>
                {isLoadingBalances ? '…' : usdcBalance}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>USDC</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3 }}>Gas &amp; Betting · Arc Mainnet</div>
          </div>

          {/* Address row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            padding: '9px 12px', background: 'var(--bg-glass)', borderRadius: 10,
          }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sessionWallet.address}
            </span>
            <button
              onClick={() => { navigator.clipboard.writeText(sessionWallet.address); }}
              style={{ background: 'none', color: 'var(--accent-bright)', fontSize: 11, padding: '2px 6px', border: '1px solid var(--border-subtle)', borderRadius: 4, cursor: 'pointer', flexShrink: 0 }}>
              Copy
            </button>
          </div>

          {/* Deposit info */}
          <div style={{ padding: '10px 12px', background: 'rgba(54,97,132,0.12)', borderRadius: 10, marginBottom: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>Deposit USDC to this wallet</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.5 }}>{sessionWallet.address}</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3 }}>Send USDC on Arc Mainnet only</div>
          </div>

          {/* Send toggle */}
          <button
            onClick={() => setSendOpen(o => !o)}
            style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', marginBottom: sendOpen ? 8 : 0 }}>
            {sendOpen ? '✕ Close Send' : '↗ Send USDC'}
          </button>

          {sendOpen && (
            <div style={{ padding: 12, background: 'var(--bg-glass)', borderRadius: 10, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input placeholder="Recipient 0x…" value={sendTo} onChange={e => setSendTo(e.target.value)} style={{ fontSize: 12 }} />
              <input type="number" placeholder="Amount USDC" value={sendAmt} onChange={e => setSendAmt(e.target.value)} min="0.1" step="0.1" style={{ fontSize: 12 }} />
              <button onClick={handleSend} disabled={sending} className="btn-primary" style={{ fontSize: 12, padding: '8px 12px' }}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          )}

          {/* Recent Activity */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent Activity</div>
            {txHistory.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: '8px 0' }}>No activity yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {txHistory.map(tx => (
                  <div key={tx.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(54,97,132,0.08)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: tx.type === 'bet' ? 'var(--accent-bright)' : '#4ade80', flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{timeAgo(tx.created_at)}</div>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', flexShrink: 0 }}>
                      {Number(tx.amount).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>


        </div>
      )}
    </div>
  )
}

/* ─── Navbar ───────────────────────────────────────────────────────────── */
export default function Navbar() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { hasSessionWallet, isCreating, createSessionWallet } = useSessionWallet()
  const { profile, navState, appInitialized, setShowMintModal } = useProfile()
  const navigate = useNavigate()

  const isAdmin = address ? ADMIN_WALLETS.includes(address.toLowerCase() as typeof ADMIN_WALLETS[number]) : false
  const wrongNetwork = isConnected && chainId !== ARC_CHAIN_ID

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
        {/* Logo */}
        <button onClick={() => navigate('/')} className="navbar-logo" style={{ background: 'none', border: 'none', padding: 0 }}>
          <div className="navbar-logo-icon">
            <ArcLogo size={24} />
          </div>
          <span className="navbar-logo-text"
            style={{
              background: 'linear-gradient(135deg, #E4E8EC 0%, #8cb4d0 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}
          >
            Arc Calls
          </span>
        </button>

        {/* Center nav links — absolutely centered */}
          <div className="navbar-center">
          {!appInitialized ? (
            <>
              <div className="skeleton" style={{ width: 60, height: 20, borderRadius: 10 }} />
              <div className="skeleton" style={{ width: 80, height: 20, borderRadius: 10 }} />
              <div className="skeleton" style={{ width: 70, height: 20, borderRadius: 10 }} />
            </>
          ) : (
            <>
              {[
                { to: '/calls', label: 'Calls' },
                { to: '/leaderboard', label: 'Leaderboard' },
                { to: '/profile', label: 'Profile' },
                ...(isAdmin ? [{ to: '/admin', label: 'Admin' }] : []),
              ].map(link => (
                <NavLink key={link.to} to={link.to}
                  className={({ isActive }) => `nav-link-item${isActive ? ' active-link' : ''}`}
                >
                  {link.label}
                </NavLink>
              ))}
            </>
          )}
          </div>

          {/* Right controls */}
          <div className="navbar-right">

          {/* Sound toggle — always visible */}
          <SoundToggleButton />

          {/* Not connected at all — show RainbowKit ConnectButton */}
          {navState === 1 && !isConnected && (
            <ConnectButton />
          )}

          {/* Connected but no session wallet yet */}
          {navState === 1 && isConnected && (
            <button
              onClick={createSessionWallet}
              disabled={isCreating}
              className="btn-activate"
            >
              {isCreating ? 'Activating…' : 'Activate Arc Calls Wallet'}
            </button>
          )}

          {/* Session wallet dropdown — shown once activated */}
          {hasSessionWallet && <SessionWalletDropdown />}

          {/* State 2: no profile — mint modal */}
          {navState === 2 && hasSessionWallet && (
            <button onClick={() => setShowMintModal(true)} className="btn-primary" style={{ padding: '7px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
              Set Up Profile
            </button>
          )}

          {/* State 3: fully onboarded — profile pill */}
          {navState === 3 && profile && (
            <button onClick={() => navigate('/profile')} className="profile-pill" style={{ border: 'none', background: 'none' }}>
              <div className="profile-pill-avatar">
                {profile.pfp_url
                  ? <img src={profile.pfp_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                  : profile.name?.[0]?.toUpperCase() || '?'
                }
              </div>
              <span className="profile-pill-name">{profile.name}</span>
            </button>
          )}

          </div>
        </div>
      </nav>

      {/* Wrong network banner */}
      {wrongNetwork && (
        <div className="network-banner">
          <span>⚠ Switch to Arc Mainnet to continue</span>
          <button
            onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
            className="btn-danger"
            style={{ padding: '4px 14px', fontSize: 12 }}
          >
            Switch Network
          </button>
        </div>
      )}

      {/* Animated sweep line under nav */}
      <div className="nav-sweep" />
    </>
  )
}
