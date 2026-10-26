import { useState, useEffect, useRef } from 'react'
import { parseUnits, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { useSessionWallet, publicClient, writeContract, getMaxFeePerGas } from '../contexts/SessionWalletContext'
import { useToast } from '../contexts/ToastContext'
import { useSound } from '../contexts/SoundContext'
import { supabase, type DbPrediction } from '../lib/supabase'
import { BETTING_POOL_ADDRESS, USDC_DECIMALS } from '../constants'
import { BETTING_POOL_ABI } from '../abis'
import { EXPLORER_URL } from '../config'
import { calcOdds, formatCountdown, validateBetAmount } from '../utils/format'

interface Props {
  prediction: DbPrediction
  onUpdate?: () => void
}

// â”€â”€ DescriptionText â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DescriptionText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const LIMIT = 150
  if (text.length <= LIMIT) return <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{text}</p>
  return (
    <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
      {expanded ? text : text.slice(0, LIMIT) + 'â€¦'}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ background: 'none', border: 'none', color: 'var(--accent-bright)', fontSize: 12, cursor: 'pointer', marginLeft: 4, padding: 0 }}
      >
        {expanded ? 'less' : 'more'}
      </button>
    </p>
  )
}

// â”€â”€ Countdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CountdownTimer({ deadline, noDeadline }: { deadline: string; noDeadline: boolean }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (noDeadline) return
    const calc = () => Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000))
    setSeconds(calc())
    const t = setInterval(() => setSeconds(calc()), 1000)
    return () => clearInterval(t)
  }, [deadline, noDeadline])

  if (noDeadline) return <span className="countdown countdown-normal">Open âˆž</span>

  const { text, level } = formatCountdown(seconds)
  return <span className={`countdown countdown-${level}`}>â± {text}</span>
}

export default function PredictionCard({ prediction: p, onUpdate }: Props) {
  const { address } = useAccount()
  const { sessionWallet, ensureUSDCApproval, loadBalances } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()
  const { playClaimSound } = useSound()

  // Two-step bet state
  const [betStep, setBetStep] = useState<'idle' | 'amount'>('idle')
  const [side, setSide] = useState<'YES' | 'NO' | null>(null)
  const [amount, setAmount] = useState('')
  const [placing, setPlacing] = useState(false)
  const [claiming, setClaiming] = useState(false)

  // On-chain state
  const [bettingLocked, setBettingLocked] = useState(false)
  const [claimableAmount, setClaimableAmount] = useState<string>('0')

  // Supabase state
  const [bettorCount, setBettorCount] = useState(0)
  const [userBet, setUserBet] = useState<{ side: string; amount: number } | null>(null)

  // Guard against double Supabase insert on re-render
  const betInsertedRef = useRef(false)

  const { yesPct, noPct, yesMulti, noMulti } = calcOdds(Number(p.yes_pool), Number(p.no_pool))
  const yes = Number(p.yes_pool ?? 0)
  const no = Number(p.no_pool ?? 0)
  const totalPool = (yes + no).toFixed(2)

  // Load chain data
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

  // Load Supabase data
  useEffect(() => {
    if (!p.id) return
    supabase.from('bets').select('*', { count: 'exact', head: true }).eq('prediction_id', p.id)
      .then(({ count }) => { if (count != null) setBettorCount(count) })

    const wallet = sessionWallet?.address ?? address
    if (wallet) {
      supabase.from('bets').select('side,amount').eq('prediction_id', p.id)
        .eq('wallet_address', wallet.toLowerCase()).single()
        .then(({ data }) => { if (data) setUserBet({ side: data.side as string, amount: Number(data.amount) }) })
    }
  }, [p.id, sessionWallet, address])

  // Status
  const isOpen     = p.status === 'open'
  const isLocked   = p.status === 'locked'
  const isSettled  = p.status === 'yes_wins' || p.status === 'no_wins'
  const isRefunded = p.status === 'refunded'
  const isFinished = isSettled || isRefunded

  const now = Date.now()
  const deadlineMs = p.deadline ? new Date(p.deadline).getTime() : Infinity
  const nearDeadline = isOpen && now >= deadlineMs - 5 * 60 * 1000
  const locked = isLocked || bettingLocked || nearDeadline

  const canBet   = isOpen && !locked && !userBet && !!sessionWallet
  const canClaim = isFinished && userBet && parseFloat(claimableAmount) > 0

  // Payout estimate
  const calcPayout = () => {
    const amt = parseFloat(amount)
    if (!amt || !side) return null
    const mySide = side === 'YES' ? yes : no
    const total = yes + no
    if (mySide + amt === 0) return null
    return ((amt * (total + amt)) / (mySide + amt)).toFixed(2)
  }

  const handleSelectSide = (s: 'YES' | 'NO') => {
    setSide(s)
    setBetStep('amount')
  }

  const handleCancelBet = () => {
    setSide(null)
    setAmount('')
    setBetStep('idle')
  }

  const handleConfirmBet = async () => {
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    if (!side || !amount) return

    const err = validateBetAmount(amount)
    if (err) { showFailed(err); return }

    if (betInsertedRef.current) return
    setPlacing(true)
    showPending('Placing call...')

    try {
      await ensureUSDCApproval()
      const rawAmount = parseUnits(amount, USDC_DECIMALS)
      const sideNum = side === 'YES' ? 1 : 2
      const maxFeePerGas = await getMaxFeePerGas()

      const hash = await writeContract(sessionWallet.client, {
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: 'placeBet',
        args: [BigInt(p.id), sideNum, rawAmount],
        maxFeePerGas,
      })

      await publicClient.waitForTransactionReceipt({ hash })
      betInsertedRef.current = true
      showConfirmed(hash, `Call placed! ${amount} USDC on ${side}`)

      const wallet = sessionWallet.address.toLowerCase()
      const amtFloat = parseFloat(amount)

      await supabase.from('bets').insert({
        prediction_id: p.id,
        wallet_address: wallet,
        side: side.toLowerCase(),
        amount: amtFloat,
        result: 'pending',
        payout: 0,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })

      const newYes = side === 'YES' ? yes + amtFloat : yes
      const newNo  = side === 'NO'  ? no  + amtFloat : no
      await supabase.from('predictions_display').update({ yes_pool: newYes, no_pool: newNo }).eq('id', p.id)

      await supabase.from('wallet_transactions').insert({
        wallet_address: wallet,
        type: 'bet',
        label: `Called ${amount} USDC ${side} â€” ${p.title.slice(0, 40)}`,
        amount: amtFloat,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })

      // Upsert leaderboard total_calls + total_volume
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
      setUserBet({ side, amount: amtFloat })
      setAmount('')
      setSide(null)
      setBetStep('idle')
      onUpdate?.()
    } catch (e: unknown) {
      betInsertedRef.current = false
      showFailed((e as Error)?.message?.slice(0, 80) ?? 'Call failed')
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

  const statusPillClass = p.status === 'open' ? 'status-live' : p.status === 'locked' ? 'status-locked'
    : p.status === 'yes_wins' ? 'status-settled-yes' : p.status === 'no_wins' ? 'status-settled-no'
    : 'status-refunded'
  const statusLabel = p.status === 'open' ? 'Live' : p.status === 'locked' ? 'Locked'
    : p.status === 'yes_wins' ? 'âœ“ YES WINS' : p.status === 'no_wins' ? 'âœ— NO WINS' : 'Refunded'

  const bannerEmoji = p.category === 'official_calls' ? 'âš¡' : 'ðŸ”®'
  const payout = calcPayout()

  return (
    <div className="glass-card glass-card-hover prediction-card">

      {/* â”€â”€ Banner â€” ALWAYS visible (with fallback) â”€â”€ */}
      <div style={{ position: 'relative', height: 192, overflow: 'hidden', borderRadius: '16px 16px 0 0', flexShrink: 0, margin: '-24px -24px 0' }}>
        {p.banner_url ? (
          <img
            src={p.banner_url}
            alt={p.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: p.category === 'official_calls'
              ? 'linear-gradient(135deg, rgba(6,30,60,0.9) 0%, rgba(14,50,90,0.8) 60%, rgba(1,13,31,0.95) 100%)'
              : 'linear-gradient(135deg, rgba(1,13,31,0.95) 0%, rgba(6,30,60,0.85) 60%, rgba(1,13,31,0.98) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60,
          }}>{bannerEmoji}</div>
        )}
        {/* Gradient overlay on banner */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(1,13,31,0.85) 0%, transparent 55%)' }} />
        {/* Status badge â€” top left */}
        <div style={{ position: 'absolute', top: 14, left: 14 }}>
          {isSettled ? (
            <span className={`status-pill ${statusPillClass}`}>{statusLabel}</span>
          ) : isRefunded ? (
            <span className="status-pill status-refunded">REFUNDED</span>
          ) : locked ? (
            <span className="status-pill status-locked">ðŸ”’ Locked</span>
          ) : (
            <span className="status-pill status-live">
              <span className="live-dot" />
              LIVE
            </span>
          )}
        </div>
        {/* Category badge â€” top right */}
        <div style={{ position: 'absolute', top: 14, right: 14 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: p.category === 'official_calls' ? '#fbbf24' : '#5a8ab0',
            background: p.category === 'official_calls' ? 'rgba(251,191,36,0.15)' : 'rgba(90,138,176,0.15)',
            padding: '3px 8px', borderRadius: 6,
            border: `1px solid ${p.category === 'official_calls' ? 'rgba(251,191,36,0.3)' : 'rgba(90,138,176,0.25)'}`,
            backdropFilter: 'blur(8px)',
          }}>
            {p.category === 'official_calls' ? 'âš¡ Official' : 'ðŸŒ Community'}
          </span>
        </div>
      </div>

      {/* â”€â”€ Card Body â”€â”€ */}
      <div style={{ padding: '22px 22px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Title + description */}
        <div>
          <div className="prediction-card-title" style={{ marginBottom: 6 }}>{p.title}</div>
          {p.description && (
            <div className="prediction-card-desc">
              <DescriptionText text={p.description} />
            </div>
          )}
        </div>

        {/* Pool + Timer row */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          paddingBottom: 16, borderBottom: '1px solid rgba(54,97,132,0.15)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Pool Total
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--accent-bright)' }}>
              {totalPool} USDC
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'right' }}>
            {isFinished ? (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Settled</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)' }}>â€”</span>
              </>
            ) : locked ? (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ends In</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--no-color)', fontWeight: 700 }}>â± BETS CLOSED</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ends In</span>
                <CountdownTimer deadline={p.deadline} noDeadline={p.no_deadline} />
              </>
            )}
          </div>
        </div>

        {/* â”€â”€ YES / NO odds section â”€â”€ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Side-by-side YES/NO big % boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* YES box */}
            <div style={{
              background: side === 'YES' ? 'rgba(74,222,128,0.12)' : 'rgba(6,30,60,0.7)',
              border: side === 'YES' ? '1.5px solid rgba(74,222,128,0.5)' : '1px solid rgba(54,97,132,0.3)',
              borderRadius: 12, padding: '16px 12px', textAlign: 'center',
              transition: 'all 200ms ease',
            }}>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#4ade80', marginBottom: 6, letterSpacing: '0.1em' }}>YES</span>
              <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{yesPct}%</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {yes.toFixed(2)} USDC
              </span>
            </div>
            {/* NO box */}
            <div style={{
              background: side === 'NO' ? 'rgba(248,113,113,0.12)' : 'rgba(6,30,60,0.7)',
              border: side === 'NO' ? '1.5px solid rgba(248,113,113,0.5)' : '1px solid rgba(248,113,113,0.25)',
              borderRadius: 12, padding: '16px 12px', textAlign: 'center',
              transition: 'all 200ms ease',
            }}>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 6, letterSpacing: '0.1em' }}>NO</span>
              <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{noPct}%</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {no.toFixed(2)} USDC
              </span>
            </div>
          </div>

          {/* Slim pool bar below the boxes */}
          <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
            <div className="pool-bar-yes" style={{ width: `${yesPct}%` }} />
            <div className="pool-bar-no"  style={{ width: `${noPct}%` }} />
          </div>

          {/* Callers count row */}
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
            {bettorCount} caller{bettorCount !== 1 ? 's' : ''}
            &nbsp;Â·&nbsp;{yesMulti} YES&nbsp;/&nbsp;{noMulti} NO
          </div>

          {/* â”€â”€ Bet buttons row â€” when no side selected â”€â”€ */}
          {canBet && betStep === 'idle' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn-stitch-yes" style={{ padding: '12px', fontSize: 14 }} onClick={() => handleSelectSide('YES')}>
                Bet YES
              </button>
              <button className="btn-stitch-no" style={{ padding: '12px', fontSize: 14 }} onClick={() => handleSelectSide('NO')}>
                Bet NO
              </button>
            </div>
          )}

          {/* â”€â”€ Amount input â€” when side is picked â”€â”€ */}
          {canBet && betStep === 'amount' && side && (
            <div style={{
              background: 'rgba(6,18,38,0.8)',
              border: `1.5px solid ${side === 'YES' ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)'}`,
              borderRadius: 12, padding: '16px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: side === 'YES' ? '#4ade80' : '#f87171', letterSpacing: '0.05em' }}>
                Calling {side} â€” enter amount
              </div>

              <input
                className="bet-input-field"
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Amount in USDC (min 0.01)"
                min="0.01"
                step="0.1"
                autoFocus
              />

              {/* Quick chips */}
              <div style={{ display: 'flex', gap: 6 }}>
                {['0.5', '1', '5', '10'].map(v => (
                  <button
                    key={v}
                    onClick={() => setAmount(a => String((parseFloat(a || '0') + parseFloat(v)).toFixed(1)))}
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 7, fontSize: 12,
                      background: 'rgba(54,97,132,0.1)', border: '1px solid rgba(54,97,132,0.25)',
                      color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    }}
                  >
                    +{v}
                  </button>
                ))}
              </div>

              {payout && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 10px', background: 'rgba(54,97,132,0.08)', borderRadius: 8 }}>
                  Est. payout: <span style={{ color: '#4ade80', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{payout} USDC</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCancelBet} className="btn-secondary" style={{ flex: 1 }} disabled={placing}>
                  Cancel
                </button>
                <button
                  onClick={handleConfirmBet}
                  disabled={placing || !amount || parseFloat(amount) <= 0}
                  className="btn-primary"
                  style={{ flex: 2, fontWeight: 700 }}
                >
                  {placing ? 'Placingâ€¦' : `Confirm ${side}`}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Your existing bet indicator */}
        {userBet && (
          <div style={{
            background: 'rgba(54,97,132,0.06)',
            border: '1px solid rgba(54,97,132,0.2)',
            borderRadius: 8, padding: '10px 16px', fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>You called</span>
            <strong style={{ color: (userBet.side === 'yes' || userBet.side === 'YES') ? '#4ade80' : '#f87171' }}>
              {String(userBet.side).toUpperCase()}
            </strong>
            <span style={{ color: 'var(--text-tertiary)' }}>Â·</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
              {Number(userBet.amount).toFixed(2)} USDC
            </span>
          </div>
        )}

        {/* Settled result banner */}
        {isFinished && (
          <div style={{
            padding: '12px 16px', borderRadius: 10, textAlign: 'center',
            background: isRefunded ? 'rgba(148,163,184,0.08)' : p.status === 'yes_wins' ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${isRefunded ? 'rgba(148,163,184,0.2)' : p.status === 'yes_wins' ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
            fontWeight: 700, fontSize: 14,
            color: isRefunded ? '#94a3b8' : p.status === 'yes_wins' ? '#4ade80' : '#f87171',
          }}>
            {isRefunded ? 'â†© REFUNDED' : p.status === 'yes_wins' ? 'ðŸ† YES WINS' : 'ðŸ† NO WINS'}
          </div>
        )}

        {/* Claim button */}
        {canClaim && (
          <button
            onClick={handleClaim}
            disabled={claiming}
            className="btn-primary btn-primary-pulse"
            style={{ width: '100%', padding: '13px', fontWeight: 700, fontSize: 14 }}
          >
            {claiming ? 'Claimingâ€¦' : `Claim ${parseFloat(claimableAmount).toFixed(2)} USDC`}
          </button>
        )}

        {/* Connect / activate prompt */}
        {!sessionWallet && isOpen && !locked && (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', padding: '4px 0' }}>
            Activate Arc Calls Wallet to place a call
          </div>
        )}

        {/* Explorer link */}
        {userBet && EXPLORER_URL && (
          <div style={{ textAlign: 'center' }}>
            <a
              href={`${EXPLORER_URL}/address/${sessionWallet?.address ?? address}`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: 'var(--accent-bright)', textDecoration: 'none' }}
            >
              View on Arc Explorer â†—
            </a>
          </div>
        )}

      </div>
    </div>
  )
}
