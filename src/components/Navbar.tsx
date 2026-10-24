import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAccount, useDisconnect, useSwitchChain } from 'wagmi'
import { isAddress } from 'viem'
import { useSessionWallet } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { useToast } from '../contexts/ToastContext'
import { ADMIN_WALLETS, ARC_CHAIN_ID } from '../constants'
import ArcLogo from './ArcLogo'

/* ─── Session Wallet Dropdown ──────────────────────────────────────────── */
function SessionWalletDropdown() {
  const { sessionWallet, usdcBalance, isLoadingBalances, loadBalances, sendUSDC } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()
  const [open, setOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sendAmt, setSendAmt] = useState('')
  const [sending, setSending] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

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

          {/* Recent activity placeholder */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>Recent Activity</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: '8px 0' }}>No activity yet</div>
          </div>


        </div>
      )}
    </div>
  )
}

/* ─── Navbar ───────────────────────────────────────────────────────────── */
export default function Navbar() {
  const { address, isConnected, chainId } = useAccount()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { hasSessionWallet, isCreating, createSessionWallet } = useSessionWallet()
  const { profile, navState, setShowMintModal } = useProfile()
  const navigate = useNavigate()
  const location = useLocation()

  const isAdmin = address ? ADMIN_WALLETS.includes(address.toLowerCase() as typeof ADMIN_WALLETS[number]) : false
  const wrongNetwork = isConnected && chainId !== ARC_CHAIN_ID
  const isProfile = location.pathname === '/profile'

  return (
    <>
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 64, zIndex: 100,
        background: 'rgba(1,10,26,0.88)',
        backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
        borderBottom: '1px solid rgba(90,138,176,0.12)',
        display: 'flex', alignItems: 'center', padding: '0 24px',
        boxShadow: '0 4px 32px rgba(0,0,0,0.3)',
      }}>
        {/* Logo */}
        <button onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', padding: 0, marginRight: 0, flexShrink: 0 }}>
          <ArcLogo size={28} />
          <span style={{
            fontSize: 16, fontWeight: 700, letterSpacing: '-0.4px',
            background: 'linear-gradient(135deg, #E4E8EC 0%, #8cb4d0 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Arc Calls</span>
        </button>

        {/* Center nav links — absolutely centered */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 2 }}>
          {[
            { to: '/calls', label: 'Markets' },
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
        </div>

        {/* Right controls — pushed to far right with margin-left auto */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>

          {/* State 1: not connected — nothing (landing handles connect) */}
          {navState === 1 && isConnected && (
            /* Connected but no session wallet yet */
            <button
              onClick={createSessionWallet}
              disabled={isCreating}
              style={{
                background: 'linear-gradient(135deg, #062a51, #0d4a8a)',
                color: 'var(--text-primary)', border: '1px solid var(--border-default)',
                borderRadius: 10, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {isCreating ? 'Activating…' : 'Activate Arc Calls Wallet'}
            </button>
          )}

          {/* Session wallet dropdown — shown once activated */}
          {hasSessionWallet && <SessionWalletDropdown />}

          {/* State 2: session wallet active but no profile — open mint modal */}
          {navState === 2 && hasSessionWallet && (
            <button
              onClick={() => setShowMintModal(true)}
              style={{
                background: 'linear-gradient(135deg, var(--accent-blue), #0d4a8a)',
                color: 'var(--text-primary)', border: '1px solid var(--border-default)',
                borderRadius: 10, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Set Up Profile
            </button>
          )}

          {/* State 3: fully onboarded — profile pill */}
          {navState === 3 && profile && (
            <button
              onClick={() => navigate('/profile')}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(6,42,81,0.8)', border: '1px solid var(--border-default)',
                borderRadius: 20, padding: '5px 14px 5px 8px', cursor: 'pointer',
                color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, transition: 'border-color 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-bright)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
            >
              {profile.pfp_url
                ? <img src={profile.pfp_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                : <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>👤</span>
              }
              <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</span>
            </button>
          )}

          {/* Disconnect — shown only on Profile page */}
          {isProfile && isConnected && (
            <button
              onClick={() => { disconnect(); navigate('/') }}
              style={{
                background: 'none', color: 'rgba(239,68,68,0.6)',
                border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8,
                padding: '6px 12px', fontSize: 12, cursor: 'pointer', transition: 'all 150ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.5)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(239,68,68,0.6)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)' }}
            >
              Disconnect
            </button>
          )}
        </div>
      </nav>

      {/* Wrong network banner */}
      {wrongNetwork && (
        <div style={{
          position: 'fixed', top: 64, left: 0, right: 0, zIndex: 99,
          background: 'rgba(239,68,68,0.12)', borderBottom: '1px solid rgba(239,68,68,0.3)',
          padding: '8px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 13, color: '#fca5a5' }}>⚠ Switch to Arc Mainnet to continue</span>
          <button
            onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
            style={{
              background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
              color: '#fca5a5', borderRadius: 8, padding: '4px 14px',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'background 150ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.35)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.2)')}
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
