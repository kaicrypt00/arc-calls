import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { parseUnits, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useSessionWallet, publicClient, writeContract, getMaxFeePerGas } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { useToast } from '../contexts/ToastContext'
import { useSound } from '../contexts/SoundContext'
import { supabase, type DbPrediction } from '../lib/supabase'
import { BETTING_POOL_ADDRESS, USDC_ADDRESS, USDC_DECIMALS } from '../constants'
import { BETTING_POOL_ABI, ERC20_ABI } from '../abis'
import { EXPLORER_URL } from '../config'
import { calcOdds, formatCountdown, validateBetAmount } from '../utils/format'

function formatBetError(err: unknown): string {
  const raw = (err as Error)?.message || String(err)
  const lower = raw.toLowerCase()
  if (
    lower.includes('erc20') ||
    lower.includes('transfer amount exceeds') ||
    lower.includes('insufficient') ||
    lower.includes('low funds') ||
    lower.includes('exceeds balance')
  ) {
    return 'Your Arc Session Wallet has low funds. Please deposit USDC to place calls.'
  }
  if (lower.includes('already placed a bet') || lower.includes('already placed')) {
    return 'You have already placed a call on this market.'
  }
  if (lower.includes('bets are locked') || lower.includes('lockout') || lower.includes('prediction not open')) {
    return 'Calling is closed for this market.'
  }
  if (lower.includes('below minimum')) {
    return 'Minimum call amount is 0.1 USDC.'
  }
  if (lower.includes('user rejected') || lower.includes('rejected')) {
    return 'Transaction was cancelled.'
  }
  const match = raw.match(/reverted with the following reason:\s*(.+?)(?:\n|$)/i)
  if (match && match[1]) {
    return match[1].trim()
  }
  return raw.slice(0, 85)
}

interface Props {
  prediction: DbPrediction
  onUpdate?: () => void
}

// -- DescriptionText -----------------------------------------------------------
function DescriptionText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const LIMIT = 150
  if (text.length <= LIMIT) return <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{text}</p>
  return (
    <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
      {expanded ? text : text.slice(0, LIMIT) + '...'}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ background: 'none', border: 'none', color: 'var(--accent-bright)', fontSize: 12, cursor: 'pointer', marginLeft: 4, padding: 0 }}
      >
        {expanded ? 'Show less' : 'Read more'}
      </button>
    </p>
  )
}

// -- RealTimeLabel ------------------------------------------------------------
function RealTimeLabel() {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        position: 'relative',
        cursor: 'help',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ? badge on the left side of Real-time */}
      <span
        style={{
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: hovered ? 'rgba(228, 232, 236, 0.14)' : 'rgba(228, 232, 236, 0.06)',
          border: `1px solid ${hovered ? 'rgba(228, 232, 236, 0.45)' : 'rgba(228, 232, 236, 0.22)'}`,
          color: hovered ? '#FFFFFF' : 'var(--text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          userSelect: 'none',
          cursor: 'help',
          transition: 'all 150ms ease',
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{ display: 'block' }}
        >
          <path
            fillRule="evenodd"
            d="M4.475 5.458c-.284 0-.514-.237-.47-.517C4.28 3.24 5.576 2 7.825 2c2.25 0 3.767 1.36 3.767 3.215 0 1.344-.665 2.288-1.79 2.973-1.1.659-1.414 1.118-1.414 2.01v.03a.5.5 0 0 1-.5.5h-.77a.5.5 0 0 1-.5-.495l-.003-.205c0-1.282.59-2.072 1.76-2.776 1.055-.63 1.488-1.272 1.488-2.037 0-1.258-.946-2.03-2.336-2.03-1.402 0-2.222.846-2.42 2.03a.502.502 0 0 1-.497.438H4.475zM7.5 12.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"
          />
        </svg>
      </span>

      {/* Real-time text on the right — flush with right margin under DEADLINE */}
      <span className="font-mono" style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
        Real-time
      </span>

      {/* Tooltip — anchored to right edge, light white/frosted glass aesthetic */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 10px)',
            right: 0,
            width: 240,
            background: 'rgba(10, 16, 26, 0.98)',
            border: '1px solid rgba(228, 232, 236, 0.16)',
            borderRadius: 10,
            padding: '12px 14px',
            boxShadow: '0 12px 36px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            zIndex: 200,
            pointerEvents: 'none',
            textAlign: 'left',
          }}
        >
          {/* Caret pointing directly down at the ? badge */}
          <div
            style={{
              position: 'absolute',
              bottom: -5,
              right: 86,
              width: 8,
              height: 8,
              background: 'rgba(10, 16, 26, 0.98)',
              border: '1px solid rgba(228, 232, 236, 0.16)',
              borderTop: 'none',
              borderLeft: 'none',
              transform: 'rotate(45deg)',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              marginBottom: 8,
              paddingBottom: 8,
              borderBottom: '1px solid rgba(228, 232, 236, 0.1)',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(228, 232, 236, 0.85)',
                boxShadow: '0 0 6px rgba(228, 232, 236, 0.4)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#E4E8EC', letterSpacing: '0.01em' }}>
              Real-time monitoring
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'rgba(228, 232, 236, 0.75)', lineHeight: 1.55 }}>
            No fixed deadline. Continuously monitored and resolves the instant the triggering condition occurs.
          </p>
        </div>
      )}
    </div>
  )
}

// -- Countdown -----------------------------------------------------------------
function CountdownTimer({ deadline, noDeadline }: { deadline: string; noDeadline: boolean }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (noDeadline) return
    const calc = () => Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000))
    setSeconds(calc())
    const t = setInterval(() => setSeconds(calc()), 1000)
    return () => clearInterval(t)
  }, [deadline, noDeadline])

  if (noDeadline) return <RealTimeLabel />

  const { text, level } = formatCountdown(seconds)
  const color = level === 'danger' ? 'var(--danger)' : level === 'warning' ? 'var(--amber)' : 'var(--text-primary)'
  return <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, color }}>{'\u23F1'} {text}</span>
}

export default function PredictionCard({ prediction: p, onUpdate }: Props) {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { navState, setShowMintModal } = useProfile()
  const { sessionWallet, hasSessionWallet, createSessionWallet, ensureUSDCApproval, loadBalances } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()
  const { playClaimSound } = useSound()

  const [betSide, setBetSide] = useState<'YES' | 'NO' | null>(null)
  const [betAmount, setBetAmount] = useState('')
  const [placing, setPlacing] = useState(false)
  const [claiming, setClaiming] = useState(false)

  const [bettingLocked, setBettingLocked] = useState(false)
  const [claimableAmount, setClaimableAmount] = useState<string>('0')
  const [userBet, setUserBet] = useState<{ side: string; amount: number } | null>(null)
  const [imgError, setImgError] = useState(false)

  const betInsertedRef = useRef(false)

  useEffect(() => { setImgError(false) }, [p.banner_url])

  const { yesPct, noPct } = calcOdds(Number(p.yes_pool), Number(p.no_pool))
  const yes = Number(p.yes_pool ?? 0)
  const no = Number(p.no_pool ?? 0)
  const totalPool = (yes + no).toFixed(1)

  useEffect(() => {
    if (!p.id) return
    const loadChainData = async () => {
      try {
        const locked = await publicClient.readContract({
          address: BETTING_POOL_ADDRESS,
          abi: BETTING_POOL_ABI,
          functionName: 'isBettingLocked',
          args: [BigInt(p.id)],
        })
        setBettingLocked(!!locked)
      } catch { /* ignore */ }

      const wallet = sessionWallet?.address ?? address
      if (wallet) {
        try {
          const claimable = await publicClient.readContract({
            address: BETTING_POOL_ADDRESS,
            abi: BETTING_POOL_ABI,
            functionName: 'getClaimableAmount',
            args: [BigInt(p.id), wallet],
          })
          setClaimableAmount(formatUnits(claimable, USDC_DECIMALS))
        } catch { /* ignore */ }
      }
    }
    loadChainData()
  }, [p.id, sessionWallet, address])

  useEffect(() => {
    if (!p.id) return
    const wallet = sessionWallet?.address ?? address
    if (wallet) {
      supabase.from('bets').select('side,amount').eq('prediction_id', p.id)
        .eq('wallet_address', wallet.toLowerCase()).single()
        .then(({ data }) => { if (data) setUserBet({ side: data.side as string, amount: Number(data.amount) }) })
    }
  }, [p.id, sessionWallet, address])

  const isOpen     = p.status === 'open'
  const isLocked   = p.status === 'locked'
  const isSettled  = p.status === 'yes_wins' || p.status === 'no_wins'
  const isRefunded = p.status === 'refunded'
  const isFinished = isSettled || isRefunded

  const now = Date.now()
  const deadlineMs = p.deadline ? new Date(p.deadline).getTime() : Infinity
  const nearDeadline = isOpen && now >= deadlineMs - 5 * 60 * 1000
  const locked = isLocked || bettingLocked || nearDeadline

  const showBetButtons = isOpen && !locked && !userBet
  const canClaim = isFinished && userBet && parseFloat(claimableAmount) > 0

  const calcPayout = () => {
    const amt = parseFloat(betAmount)
    if (!amt || !betSide) return null
    const mySide = betSide === 'YES' ? yes : no
    const total = yes + no
    if (mySide + amt === 0) return null
    return ((amt * (total + amt)) / (mySide + amt)).toFixed(2)
  }

  const handleSelectSide = async (s: 'YES' | 'NO') => {
    if (!isConnected) {
      openConnectModal?.()
      return
    }
    if (!hasSessionWallet) {
      try {
        await createSessionWallet()
      } catch {
        return
      }
    }
    if (navState === 2) {
      setShowMintModal(true)
      return
    }
    setBetSide(s)
  }

  const handleCancelBet = () => {
    setBetSide(null)
    setBetAmount('')
  }

  const handleConfirmBet = async () => {
    if (!isConnected) { openConnectModal?.(); return }
    if (!sessionWallet) {
      try { await createSessionWallet() } catch { return }
    }
    if (!betSide || !betAmount) return
    const err = validateBetAmount(betAmount)
    if (err) { showFailed(err); return }
    if (betInsertedRef.current) return
    setPlacing(true)
    showPending('Placing call...')
    try {
      const rawAmount = parseUnits(betAmount, USDC_DECIMALS)

      // Pre-flight balance check: verify Arc Session Wallet has sufficient USDC balance
      const currentBal = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [sessionWallet!.address],
      })
      if (currentBal < rawAmount) {
        const balFmt = parseFloat(formatUnits(currentBal, USDC_DECIMALS)).toFixed(2)
        showFailed(`Your Arc Session Wallet has low funds (${balFmt} USDC). Please deposit USDC to place calls.`)
        setPlacing(false)
        return
      }

      await ensureUSDCApproval(rawAmount)
      const sideNum = betSide === 'YES' ? 1 : 2
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet!.client, {
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: 'placeBet',
        args: [BigInt(p.id), sideNum, rawAmount],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      betInsertedRef.current = true
      showConfirmed(hash, `Call placed! ${betAmount} USDC on ${betSide}`)
      const wallet = sessionWallet!.address.toLowerCase()
      const amtFloat = parseFloat(betAmount)
      await supabase.from('bets').insert({
        prediction_id: p.id, wallet_address: wallet, side: betSide.toLowerCase(),
        amount: amtFloat, result: 'pending', payout: 0, tx_hash: hash,
        created_at: new Date().toISOString(),
      })
      const newYes = betSide === 'YES' ? yes + amtFloat : yes
      const newNo  = betSide === 'NO'  ? no  + amtFloat : no
      await supabase.from('predictions_display').update({ yes_pool: newYes, no_pool: newNo }).eq('id', p.id)
      await supabase.from('wallet_transactions').insert({
        wallet_address: wallet, type: 'bet',
        label: `Called ${betAmount} USDC ${betSide} \u2013 ${p.title.slice(0, 40)}`,
        amount: amtFloat, tx_hash: hash, created_at: new Date().toISOString(),
      })
      const { data: lbRow } = await supabase.from('leaderboard')
        .select('total_calls, total_volume').eq('wallet_address', wallet).single()
      await supabase.from('leaderboard').upsert({
        wallet_address: wallet,
        total_calls:  (Number(lbRow?.total_calls  ?? 0) + 1),
        total_volume: (Number(lbRow?.total_volume ?? 0) + amtFloat),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'wallet_address' })
      window.dispatchEvent(new Event('arc-bet-placed'))
      await loadBalances()
      setUserBet({ side: betSide, amount: amtFloat })
      setBetAmount('')
      setBetSide(null)
      onUpdate?.()
    } catch (e: unknown) {
      betInsertedRef.current = false
      showFailed(formatBetError(e))
    }
    setPlacing(false)
  }

  const handleClaim = async () => {
    if (!sessionWallet) return
    setClaiming(true)
    showPending('Claiming...')
    try {
      playClaimSound()
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: isRefunded ? 'claimRefund' : 'claimWinnings',
        args: [BigInt(p.id)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, isRefunded ? 'Refund claimed!' : 'Winnings claimed!')
      const wallet = sessionWallet.address.toLowerCase()
      await supabase.from('bets').update({
        result: isRefunded ? 'refunded' : 'won',
        payout: parseFloat(claimableAmount),
      }).eq('prediction_id', p.id).eq('wallet_address', wallet)
      await loadBalances()
      setClaimableAmount('0')
      onUpdate?.()
    } catch (e: unknown) {
      showFailed((e as Error)?.message?.slice(0, 80) ?? 'Claim failed')
    }
    setClaiming(false)
  }

  const payout = calcPayout()

  return (
    <div className="glass-card glass-card-hover prediction-card">
      {/* -- Banner image -- */}
      <div style={{ position: 'relative', height: 192, overflow: 'hidden', borderRadius: '16px 16px 0 0', flexShrink: 0 }}>
        {p.banner_url && !imgError ? (
          <img
            src={p.banner_url}
            alt={p.title}
            loading="lazy"
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(135deg, rgba(6,30,60,0.95) 0%, rgba(14,50,90,0.85) 60%, rgba(1,13,31,0.98) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56,
          }}>
            <span role="img" aria-label="placeholder">{'\uD83D\uDD2E'}</span>
          </div>
        )}

        {/* Status badge top-left */}
        <div style={{ position: 'absolute', top: 14, left: 14 }}>
          {isSettled ? (
            <span className={`status-pill ${p.status === 'yes_wins' ? 'status-settled-yes' : 'status-settled-no'}`}>
              {p.status === 'yes_wins' ? '\u2713 YES WINS' : '\u2717 NO WINS'}
            </span>
          ) : isRefunded ? (
            <span className="status-pill status-refunded">REFUNDED</span>
          ) : locked ? (
            <span className="status-pill status-locked">{'\uD83D\uDD12'} Locked</span>
          ) : (
            <span className="status-pill status-live">
              <span className="live-dot" />
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* -- Card body -- */}
      <div style={{ padding: '22px 22px 26px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Title & Description */}
        <div>
          <div className="prediction-card-title" style={{ marginBottom: 6 }}>{p.title}</div>
          {p.description && (
            <div className="prediction-card-desc">
              <DescriptionText text={p.description} />
            </div>
          )}
        </div>

        {/* Pool Total + Deadline row */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          paddingBottom: 18, borderBottom: '1px solid rgba(54,97,132,0.15)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Pool Total
            </span>
            <span className="font-mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
              {totalPool} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>USDC</span>
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'right', alignItems: 'flex-end' }}>
            {isFinished ? (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Settled</span>
                <span className="font-mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {p.settled_at ? new Date(p.settled_at).toLocaleDateString() : '—'}
                </span>
              </>
            ) : locked ? (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ends In</span>
                <span className="font-mono" style={{ fontSize: 14, color: 'var(--no-color)', fontWeight: 700 }}>{'\u23F1'} BETS CLOSED</span>
              </>
            ) : p.no_deadline ? (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Deadline</span>
                <RealTimeLabel />
              </>
            ) : (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ends In</span>
                <CountdownTimer deadline={p.deadline} noDeadline={p.no_deadline} />
              </>
            )}
          </div>
        </div>

        {/* Your Bet Indicator (if bet already placed) */}
        {userBet && (
          <div style={{
            background: 'rgba(54,97,132,0.06)',
            border: '1px solid rgba(54,97,132,0.2)',
            borderRadius: 8, padding: '10px 16px', fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>You called</span>
            <strong style={{ color: (userBet.side === 'yes' || userBet.side === 'YES') ? '#8cb9dd' : '#f87171' }}>
              {String(userBet.side).toUpperCase()}
            </strong>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {Number(userBet.amount).toFixed(2)} USDC
            </span>
          </div>
        )}

        {/* ── YES / NO section ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Odds row — always visible */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* YES Odds box */}
            <div style={{
              background: betSide === 'YES' ? 'rgba(10,42,80,0.45)' : 'rgba(6,18,42,0.6)',
              border: betSide === 'YES' ? '1.5px solid rgba(74,128,176,0.7)' : '1px solid rgba(74,128,176,0.25)',
              borderRadius: 12, padding: '16px 12px', textAlign: 'center', transition: 'all 200ms ease',
            }}>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#8cb9dd', marginBottom: 6, letterSpacing: '0.1em' }}>YES</span>
              <span className="font-mono" style={{ display: 'block', fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{yesPct}%</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{yes.toFixed(1)} USDC</span>
            </div>

            {/* NO Odds box */}
            <div style={{
              background: betSide === 'NO' ? 'rgba(248,113,113,0.12)' : 'rgba(217,79,79,0.03)',
              border: betSide === 'NO' ? '1.5px solid rgba(248,113,113,0.5)' : '1px solid rgba(217,79,79,0.25)',
              borderRadius: 12, padding: '16px 12px', textAlign: 'center', transition: 'all 200ms ease',
            }}>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 6, letterSpacing: '0.1em' }}>NO</span>
              <span className="font-mono" style={{ display: 'block', fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{noPct}%</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{no.toFixed(1)} USDC</span>
            </div>
          </div>

          {/* Bet buttons row — always visible when open & no side selected yet */}
          {!betSide && showBetButtons && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn-stitch-yes" onClick={() => handleSelectSide('YES')}>
                Bet YES
              </button>
              <button className="btn-stitch-no" onClick={() => handleSelectSide('NO')}>
                Bet NO
              </button>
            </div>
          )}

          {/* Amount input — full width below both columns when a side is picked */}
          {betSide && (
            <div style={{
              background: 'rgba(6,18,38,0.85)',
              border: `1.5px solid ${betSide === 'YES' ? 'rgba(74,128,176,0.5)' : 'rgba(248,113,113,0.4)'}`,
              borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: betSide === 'YES' ? '#8cb9dd' : '#f87171', letterSpacing: '0.05em' }}>
                Calling {betSide} — enter amount
              </div>
              <input
                className="bet-input-field" type="number" value={betAmount}
                onChange={e => setBetAmount(e.target.value)}
                placeholder="Amount in USDC (min 0.01)" min="0.01" step="0.1" autoFocus
              />
              <div style={{ display: 'flex', gap: 6 }}>
                {['0.5', '1', '5', '10'].map(v => (
                  <button key={v}
                    onClick={() => setBetAmount(a => String((parseFloat(a || '0') + parseFloat(v)).toFixed(1)))}
                    style={{ flex: 1, padding: '5px 0', borderRadius: 7, fontSize: 12, background: 'rgba(54,97,132,0.1)', border: '1px solid rgba(54,97,132,0.25)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                  >+{v}</button>
                ))}
              </div>
              {payout && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 10px', background: 'rgba(54,97,132,0.08)', borderRadius: 8 }}>
                  Est. payout: <span style={{ color: betSide === 'YES' ? '#8cb9dd' : '#f87171', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{payout} USDC</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCancelBet} className="btn-secondary" style={{ flex: 1 }} disabled={placing}>Cancel</button>
                <button
                  onClick={handleConfirmBet}
                  disabled={placing || !betAmount || parseFloat(betAmount) <= 0}
                  className="btn-primary"
                  style={{
                    flex: 2, fontWeight: 700,
                    background: betSide === 'YES' ? '#2c6496' : '#ef4444',
                    color: '#ffffff',
                    border: 'none',
                  }}
                >
                  {placing ? 'Placing…' : `Confirm ${betSide}`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Settled banner */}
        {isFinished && (
          <div style={{
            marginTop: 4, padding: '18px 20px', borderRadius: 14, textAlign: 'center',
            background: isRefunded ? 'rgba(148,163,184,0.08)' : p.status === 'yes_wins' ? 'rgba(10,42,80,0.3)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${isRefunded ? 'rgba(148,163,184,0.2)' : p.status === 'yes_wins' ? 'rgba(74,128,176,0.35)' : 'rgba(248,113,113,0.2)'}`,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700,
              color: isRefunded ? '#94a3b8' : p.status === 'yes_wins' ? '#72a9d4' : '#f87171',
            }}>
              {isRefunded ? '↩ MARKET REFUNDED' : p.status === 'yes_wins' ? '🏆 YES SIDE WINS' : '✗ NO SIDE WINS'}
            </div>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {isRefunded ? 'Head over to your profile to claim your refund.' : 'Head over to your profile to claim your winnings.'}
            </span>
            <Link to="/profile" style={{ textDecoration: 'none' }}>
              <button style={{
                width: '100%', padding: '9px 16px', borderRadius: 8,
                background: 'rgba(54,97,132,0.15)', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}>
                Go to Profile to Claim →
              </button>
            </Link>
          </div>
        )}

        {/* Claim button if on-chain claimable */}
        {canClaim && (
          <button onClick={handleClaim} disabled={claiming} className="btn-primary btn-primary-pulse" style={{ width: '100%', padding: '13px', fontWeight: 700, fontSize: 14 }}>
            {claiming ? 'Claiming…' : `Claim ${parseFloat(claimableAmount).toFixed(2)} USDC`}
          </button>
        )}

        {userBet && EXPLORER_URL && (
          <div style={{ textAlign: 'center' }}>
            <a href={`${EXPLORER_URL}/address/${sessionWallet?.address ?? address}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent-bright)', textDecoration: 'none' }}>
              View on Arc Explorer ↗
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
