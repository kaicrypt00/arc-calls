import { useState, useRef, useEffect, useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { isAddress } from 'viem'
import { useSessionWallet, getMaxSendableUSDC } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, type DbWalletTransaction } from '../lib/supabase'
import { ADMIN_WALLETS, ARC_CHAIN_ID } from '../constants'
import { timeAgo } from '../utils/format'
import ArcLogo from './ArcLogo'

const TX_TYPE_ICON: Record<string, string> = {
  bet: '🎯',
  claim: '🏆',
  refund: '↩',
  poll_submit: '💡',
  vote: '🗳',
  deposit: '⬇️',
  withdrawal: '⬆️',
  profile_creation: '👤',
  faucet: '💧',
  admin_action: '⚙',
}

function truncateAddress(addr: string) {
  if (!addr) return ''
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

/* ─── Session Wallet Dropdown ──────────────────────────────────────────── */
function SessionWalletDropdown() {
  const { sessionWallet, usdcBalance, loadBalances, sendUSDC } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [txHistory, setTxHistory] = useState<DbWalletTransaction[]>([])
  // Max sendable = balance minus gas reserve (Arc native gas = ERC20 USDC, same token)
  const [maxSendable, setMaxSendable] = useState<string | null>(null)
  const [loadingMax, setLoadingMax] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const loadRecentTxs = useCallback(async () => {
    if (!sessionWallet) return
    const { data } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('wallet_address', sessionWallet.address.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setTxHistory(data as DbWalletTransaction[])
  }, [sessionWallet])

  // Click outside to close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowSend(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Load balances and recent txs on open
  useEffect(() => {
    if (open && sessionWallet) {
      loadBalances()
      loadRecentTxs()
    }
  }, [open, sessionWallet, loadBalances, loadRecentTxs])

  // Auto-refresh: load on mount/connect, then background interval every 15s without flicker
  useEffect(() => {
    if (!sessionWallet) return
    loadBalances()
    const interval = setInterval(() => {
      loadBalances()
    }, 15000)
    return () => clearInterval(interval)
  }, [sessionWallet, loadBalances])

  const handleRefresh = async () => {
    if (refreshing || !sessionWallet) return
    setRefreshing(true)
    try {
      await Promise.all([loadBalances(), loadRecentTxs()])
    } finally {
      setRefreshing(false)
    }
  }

  const copyAddress = () => {
    if (!sessionWallet) return
    navigator.clipboard.writeText(sessionWallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Fetch max sendable whenever Send panel opens (gas-aware calculation)
  useEffect(() => {
    if (!showSend || !sessionWallet) {
      setMaxSendable(null)
      return
    }
    setLoadingMax(true)
    getMaxSendableUSDC(sessionWallet.address)
      .then(max => setMaxSendable(max))
      .catch(() => setMaxSendable(null))
      .finally(() => setLoadingMax(false))
  }, [showSend, sessionWallet])

  const handleMax = () => {
    if (maxSendable && parseFloat(maxSendable) > 0) {
      setSendAmount(maxSendable)
      setSendError('')
    }
  }

  /** Turn raw contract/EVM error into a clean user-facing message */
  const formatSendError = (err: unknown): string => {
    const raw = (err as Error)?.message ?? 'Send failed'
    if (raw.startsWith('Insufficient balance for transfer') || raw.startsWith('Transfer transaction reverted')) {
      return raw
    }
    if (raw.includes('ERC20') || raw.includes('transfer amount exceeds')) {
      return 'Insufficient USDC balance. Use Max to auto-fill the safe amount.'
    }
    if (raw.includes('insufficient funds') || raw.includes('insufficient native')) {
      return 'Not enough balance to cover gas fees. Use Max to leave room for fees.'
    }
    if (raw.includes('reverted')) {
      return 'Transaction reverted on-chain. Try a smaller amount or click Max.'
    }
    return raw.slice(0, 120)
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setSendError('')

    if (!isAddress(sendTo)) {
      setSendError('Invalid recipient address')
      return
    }
    const amt = parseFloat(sendAmount)
    if (isNaN(amt) || amt <= 0) {
      setSendError('Enter a valid amount greater than 0')
      return
    }
    const bal = parseFloat(usdcBalance)
    if (amt > bal) {
      setSendError('Amount exceeds your USDC balance')
      return
    }
    // Refresh MAX right before send — gas price may have changed since panel opened
    let freshMax = maxSendable
    try {
      freshMax = await getMaxSendableUSDC(sessionWallet!.address)
      setMaxSendable(freshMax)
    } catch { /* keep stale value */ }

    // Pre-flight client-side gas check with fresh MAX
    if (freshMax !== null && parseFloat(freshMax) >= 0 && amt > parseFloat(freshMax) + 0.0001) {
      setSendError(`Leaves no room for gas. Max sendable: ${freshMax} USDC — click Max to auto-fill.`)
      return
    }

    setSending(true)
    showPending(`Sending ${sendAmount} USDC...`)
    try {
      const txHash = await sendUSDC(sendTo, sendAmount)
      showConfirmed(txHash, `Sent ${sendAmount} USDC ✓`)

      supabase.from('wallet_transactions').insert({
        wallet_address: (sessionWallet?.address ?? '').toLowerCase(),
        type: 'withdrawal',
        label: `Withdrew ${sendAmount} USDC to ${truncateAddress(sendTo)}`,
        tx_hash: txHash,
        amount: amt,
        created_at: new Date().toISOString(),
      }).then(() => {
        loadRecentTxs()
      })

      setSendTo('')
      setSendAmount('')
      setShowSend(false)
      await loadBalances()
    } catch (e) {
      const msg = formatSendError(e)
      showFailed(msg)
      setSendError(msg)
    } finally {
      setSending(false)
    }
  }

  if (!sessionWallet) return null

  return (
    <div style={{ position: 'relative' }} ref={dropRef}>
      {/* ── Navbar trigger pill ── */}
      <button
        onClick={() => { setOpen(v => !v); if (open) setShowSend(false) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: open ? 'rgba(6,42,81,0.95)' : 'rgba(6,42,81,0.85)',
          border: `1px solid ${open ? 'var(--accent-bright)' : 'var(--border-default)'}`,
          borderRadius: 10, padding: '7px 14px', cursor: 'pointer',
          color: 'var(--text-primary)', fontSize: 13,
          fontWeight: 500, transition: 'all 0.2s ease',
          backdropFilter: 'blur(12px)',
          boxShadow: open ? '0 0 16px var(--accent-glow)' : 'none',
        }}
        onMouseEnter={e => {
          if (!open) {
            e.currentTarget.style.borderColor = 'var(--accent-bright)'
            e.currentTarget.style.background = 'rgba(6,42,81,0.95)'
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            e.currentTarget.style.borderColor = 'var(--border-default)'
            e.currentTarget.style.background = 'rgba(6,42,81,0.85)'
          }
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: 'var(--yes-color)',
          boxShadow: '0 0 6px rgba(74,222,128,0.7)', flexShrink: 0, display: 'inline-block',
        }} />
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-primary)' }}>
          {usdcBalance}
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}>
          USDC
        </span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', marginLeft: 2, opacity: 0.6 }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0,
          width: 300,
          background: 'rgba(4,20,52,0.98)',
          backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid var(--border-default)', borderRadius: 16, zIndex: 1000,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(90, 138, 176, 0.08)',
          overflow: 'hidden', animation: 'rcw-drop-in 0.18s ease',
        }}>

          {/* Top accent line */}
          <div style={{
            height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(90,138,176,0.4) 40%, rgba(90,138,176,0.8) 70%, transparent)',
          }} />

          <div style={{ padding: '18px 18px 16px' }}>

            {/* ── 1. Header Row ── */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 10,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: 'rgba(142, 159, 176, 0.7)',
                fontFamily: 'inherit',
              }}>
                ARC CALLS WALLET
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh balances"
                style={{
                  background: 'none', border: 'none', padding: 4,
                  cursor: refreshing ? 'default' : 'pointer',
                  color: 'rgba(142, 159, 176, 0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 5, transition: 'color 0.2s',
                }}
                onMouseEnter={e => { if (!refreshing) e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(142, 159, 176, 0.6)' }}
              >
                <svg
                  width="11" height="11" viewBox="0 0 24 24" fill="none"
                  style={{
                    animation: refreshing ? 'rcw-spin 0.8s linear infinite' : 'none',
                    transition: 'opacity 0.2s',
                  }}
                >
                  <path d="M21 12a9 9 0 01-9 9c-2.76 0-5.23-1.24-6.92-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M3 12a9 9 0 019-9c2.76 0 5.23 1.24 6.92 3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M21 3v4h-4M3 21v-4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>

            {/* ── 2. Address Row: address + copy + send ── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(6, 42, 81, 0.35)',
              border: '1px solid var(--border-default)',
              borderRadius: 9, padding: '9px 10px',
              marginBottom: 12,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--yes-color)', boxShadow: '0 0 5px rgba(74,222,128,0.55)',
                display: 'inline-block', flexShrink: 0,
              }} />
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                color: 'var(--text-primary)', flex: 1,
              }}>
                {truncateAddress(sessionWallet.address)}
              </span>
              <button
                onClick={copyAddress}
                style={{
                  background: copied ? 'rgba(74,222,128,0.12)' : 'rgba(228, 232, 236, 0.06)',
                  border: `1px solid ${copied ? 'rgba(74,222,128,0.3)' : 'var(--border-subtle)'}`,
                  borderRadius: 5, padding: '3px 8px',
                  color: copied ? 'var(--yes-color)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 10, fontWeight: 600,
                  fontFamily: 'inherit', transition: 'all 0.2s ease',
                }}
              >
                {copied ? '✓' : 'Copy'}
              </button>
              <div style={{ width: 1, height: 14, background: 'var(--border-subtle)' }} />
              <button
                onClick={() => setShowSend(v => !v)}
                style={{
                  background: showSend ? 'rgba(90, 138, 176, 0.2)' : 'rgba(228, 232, 236, 0.06)',
                  border: `1px solid ${showSend ? 'var(--accent-bright)' : 'var(--border-subtle)'}`,
                  borderRadius: 5, padding: '3px 8px',
                  color: showSend ? 'var(--accent-bright)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 10, fontWeight: 600,
                  fontFamily: 'inherit', transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', gap: 3,
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                  <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Send
              </button>
            </div>

            {/* ── 4. Expandable Send Panel ── */}
            {showSend && (
              <form onSubmit={handleSend} style={{ marginBottom: 12 }}>
                <div style={{
                  background: 'rgba(6, 42, 81, 0.45)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 10, padding: 12,
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: 'var(--accent-bright)',
                    marginBottom: 10,
                  }}>
                    SEND USDC · ARC MAINNET
                  </div>
                  <input
                    type="text"
                    value={sendTo}
                    onChange={e => { setSendTo(e.target.value); setSendError('') }}
                    placeholder="Recipient address 0x..."
                    style={{
                      width: '100%', background: 'rgba(1, 13, 31, 0.75)',
                      border: '1px solid var(--border-default)', borderRadius: 7,
                      padding: '8px 10px', color: 'var(--text-primary)', fontSize: 11,
                      outline: 'none', boxSizing: 'border-box',
                      fontFamily: 'JetBrains Mono, monospace', marginBottom: 6,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                      <input
                        type="number"
                        value={sendAmount}
                        onChange={e => { setSendAmount(e.target.value); setSendError('') }}
                        placeholder="Amount USDC"
                        step="0.0001" min="0.0001"
                        style={{
                          width: '100%', background: 'rgba(1, 13, 31, 0.75)',
                          border: '1px solid var(--border-default)', borderRadius: 7,
                          padding: '8px 48px 8px 10px', color: 'var(--text-primary)', fontSize: 11,
                          outline: 'none', boxSizing: 'border-box',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleMax}
                        disabled={loadingMax || !maxSendable || parseFloat(maxSendable) <= 0}
                        title="Withdraw max sendable amount (leaves room for network gas fee)"
                        style={{
                          position: 'absolute', right: 5,
                          background: 'rgba(56, 189, 248, 0.15)',
                          border: '1px solid rgba(56, 189, 248, 0.45)',
                          borderRadius: 4, padding: '2px 6px',
                          color: '#38bdf8', fontSize: 9.5, fontWeight: 700,
                          fontFamily: 'JetBrains Mono, monospace',
                          cursor: 'pointer', transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.3)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)' }}
                      >
                        MAX
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={sending}
                      style={{
                        background: 'rgba(90, 138, 176, 0.25)',
                        border: '1px solid var(--accent-bright)',
                        borderRadius: 7, padding: '8px 14px',
                        color: sending ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        cursor: sending ? 'not-allowed' : 'pointer',
                        fontSize: 11, fontWeight: 700,
                        fontFamily: 'inherit',
                        transition: 'all 0.2s ease', flexShrink: 0,
                      }}
                    >
                      {sending ? '...' : 'Send →'}
                    </button>
                  </div>
                  {sendError && (
                    <div style={{
                      color: '#f87171',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: 6, padding: '6px 8px',
                      fontSize: 10.5, marginTop: 7, lineHeight: 1.4,
                    }}>
                      ⚠ {sendError}
                    </div>
                  )}
                  
                  <div style={{ fontSize: 9.5, color: '#64748b', marginTop: 6, lineHeight: 1.3 }}>
                    ℹ Reserves ~0.005 USDC for Arc network gas fee.
                  </div>
                </div>
              </form>
            )}

            {/* ── 3. Token Balance Row (Unified USDC for Gas & Arena) ── */}
            <div style={{
              background: 'rgba(6, 42, 81, 0.28)',
              border: '1px solid var(--border-default)',
              borderRadius: 12, overflow: 'hidden', marginBottom: 12,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px',
              }}>
                <div>
                  <div style={{
                    fontSize: 10, fontWeight: 500, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 3,
                  }}>
                    USDC · GAS &amp; ARENA
                  </div>
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 17, fontWeight: 700,
                    color: 'var(--text-primary)', letterSpacing: '-0.02em',
                  }}>
                    {usdcBalance}
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 5 }}>
                      USDC
                    </span>
                  </div>
                </div>
                <div
                  className="usdc-icon"
                  data-slot="usdc-icon"
                  title="USDC"
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: '0 2px 10px rgba(39, 117, 202, 0.35)',
                  }}
                >
                  <img
                    src="/usdc-logo.png"
                    alt="USDC"
                    style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: '50%', display: 'block' }}
                  />
                </div>
              </div>
            </div>

            {/* ── Divider ── */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', marginBottom: 10 }} />

            {/* ── 5. Recent Activity (Vertical Slider) ── */}
            <div>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: 'rgba(142, 159, 176, 0.6)',
                fontFamily: 'inherit', marginBottom: 8,
              }}>
                RECENT ACTIVITY
              </div>

              {txHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '14px 0', color: 'var(--text-tertiary)', fontSize: 11, fontStyle: 'italic' }}>
                  No activity yet
                </div>
              ) : (
                <div
                  className="session-wallet-tx-scroll"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    maxHeight: 185,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingRight: 4,
                  }}
                >
                  {txHistory.map((tx) => (
                    <div
                      key={tx.id}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 8px', borderRadius: 7,
                        background: 'rgba(6, 42, 81, 0.25)',
                        border: '1px solid var(--border-subtle)',
                        transition: 'background 0.15s', cursor: 'default',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(6, 42, 81, 0.45)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(6, 42, 81, 0.25)'}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 11 }}>{TX_TYPE_ICON[tx.type] || '·'}</span>
                          <span style={{
                            color: 'var(--text-primary)', fontSize: 11, fontWeight: 500,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {tx.label}
                          </span>
                        </div>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 10, marginLeft: 16 }}>
                          {timeAgo(tx.created_at)}
                        </span>
                      </div>
                      {tx.amount != null && (
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0, marginLeft: 8 }}>
                          {Number(tx.amount).toFixed(2)}{' '}
                          <span style={{ color: 'var(--accent-bright)', fontSize: 9 }}>USDC</span>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      <style>{`
        .session-wallet-tx-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(56, 189, 248, 0.35) rgba(6, 20, 48, 0.5);
        }
        .session-wallet-tx-scroll::-webkit-scrollbar {
          width: 5px;
        }
        .session-wallet-tx-scroll::-webkit-scrollbar-track {
          background: rgba(6, 20, 48, 0.5);
          border-radius: 6px;
        }
        .session-wallet-tx-scroll::-webkit-scrollbar-thumb {
          background: rgba(56, 189, 248, 0.35);
          border-radius: 6px;
          box-shadow: 0 0 6px rgba(56, 189, 248, 0.25);
          transition: background 0.2s ease;
        }
        .session-wallet-tx-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(56, 189, 248, 0.7);
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
        }
        @keyframes rcw-drop-in {
          from { opacity: 0; transform: translateY(-6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes rcw-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
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
        <div onClick={() => navigate('/')} className="navbar-logo" style={{ cursor: 'pointer', userSelect: 'none' }}>
          <div className="navbar-logo-icon">
            <ArcLogo size={32} />
          </div>
          <span
            className="navbar-logo-text navbar-brand-shimmer"
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--text-primary, #E4E8EC)',
              letterSpacing: -0.5,
              cursor: 'pointer',
            }}
          >
            Arc Calls
          </span>
        </div>

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
            </>
          )}
          </div>

          {/* Right controls */}
          <div className="navbar-right">

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
            <button onClick={() => navigate('/profile')} className="profile-pill">
              <div className="profile-pill-avatar">
                {profile.pfp_url
                  ? <img src={profile.pfp_url} alt={profile.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} onError={e => { e.currentTarget.style.display = 'none'; const sib = e.currentTarget.nextSibling as HTMLElement; if (sib) sib.style.display = 'flex' }} />
                  : null
                }
                <span style={{ display: profile.pfp_url ? 'none' : 'flex' }}>
                  {profile.name?.[0]?.toUpperCase() || '?'}
                </span>
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
    </>
  )
}


