import { useState, useEffect } from 'react'
import { parseUnits, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { useSessionWallet, getMaxFeePerGas, publicClient, writeContract } from '../contexts/SessionWalletContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, type DbPrediction } from '../lib/supabase'
import { BETTING_POOL_ADDRESS, USDC_DECIMALS, MIN_BET_DISPLAY } from '../constants'
import { BETTING_POOL_ABI } from '../abis'
import { EXPLORER_URL } from '../config'

interface Props {
  prediction: DbPrediction
  onUpdate?: () => void
}

const STATUS_LABELS: Record<string, string> = {
  open: 'OPEN', locked: 'LOCKED',
  yes_wins: 'YES WINS', no_wins: 'NO WINS', refunded: 'REFUNDED',
}
const STATUS_CLASS: Record<string, string> = {
  open: 'badge-open', locked: 'badge-locked',
  yes_wins: 'badge-yes', no_wins: 'badge-no', refunded: 'badge-refund',
}

function Countdown({ deadline, noDeadline }: { deadline: string; noDeadline: boolean }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (noDeadline) { setText('No deadline'); return }
    const update = () => {
      const diff = new Date(deadline).getTime() - Date.now()
      if (diff <= 0) { setText('Ended'); return }
      const d = Math.floor(diff / 86400000)
      const h = Math.floor((diff % 86400000) / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setText(d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`)
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [deadline, noDeadline])
  return <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{text}</span>
}

export default function PredictionCard({ prediction: p, onUpdate }: Props) {
  const { address } = useAccount()
  const { sessionWallet, ensureUSDCApproval, loadBalances } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()

  const [side, setSide] = useState<'YES' | 'NO' | null>(null)
  const [amount, setAmount] = useState('')
  const [placing, setPlacing] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [bettorCount, setBettorCount] = useState(0)
  const [userBet, setUserBet] = useState<{ side: string; amount: number } | null>(null)

  const yes = Number(p.yes_pool ?? 0)
  const no = Number(p.no_pool ?? 0)
  const total = yes + no
  const yesP = total > 0 ? Math.round((yes / total) * 100) : 50
  const noP = 100 - yesP

  useEffect(() => {
    if (!p.id) return
    // Count bettors from bets table
    supabase.from('bets').select('*', { count: 'exact', head: true }).eq('prediction_id', p.id).then(({ count }) => {
      if (count != null) setBettorCount(count)
    })
    // Check user bet
    const wallet = sessionWallet?.address ?? address
    if (wallet) {
      supabase.from('bets').select('side,amount').eq('prediction_id', p.id).eq('wallet_address', wallet.toLowerCase()).single().then(({ data }) => {
        if (data) setUserBet({ side: data.side, amount: Number(data.amount) })
      })
    }
  }, [p.id, sessionWallet, address])

  const calcPayout = () => {
    const amt = parseFloat(amount)
    if (!amt || !side) return null
    const mySide = side === 'YES' ? yes : no
    const otherSide = side === 'YES' ? no : yes
    if (mySide + amt === 0) return null
    return ((amt * (mySide + otherSide + amt)) / (mySide + amt)).toFixed(2)
  }

  const handleBet = async () => {
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    if (!side || !amount) return
    const amtFloat = parseFloat(amount)
    if (amtFloat < parseFloat(MIN_BET_DISPLAY)) { showFailed(`Minimum bet is ${MIN_BET_DISPLAY} USDC`); return }

    setPlacing(true)
    showPending('Placing bet...')
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
      showConfirmed(hash, `Bet placed! ${amount} USDC on ${side}`)

      // Record in Supabase
      const wallet = sessionWallet.address.toLowerCase()
      await supabase.from('bets').insert({
        prediction_id: p.id,
        wallet_address: wallet,
        side,
        amount: amtFloat,
        result: 'pending',
        payout: 0,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })

      // Update pool in predictions_display
      const newYes = side === 'YES' ? yes + amtFloat : yes
      const newNo = side === 'NO' ? no + amtFloat : no
      await supabase.from('predictions_display').update({ yes_pool: newYes, no_pool: newNo }).eq('id', p.id)

      // Update leaderboard total_volume
      await supabase.from('leaderboard').upsert({
        wallet_address: wallet,
        total_calls: (await supabase.from('bets').select('*', { count: 'exact', head: true }).eq('wallet_address', wallet)).count ?? 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'wallet_address' })

      await supabase.from('wallet_transactions').insert({
        wallet_address: wallet,
        type: 'bet',
        label: `Bet ${amount} USDC on ${side} — ${p.title.slice(0, 40)}`,
        amount: amtFloat,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })

      window.dispatchEvent(new Event('arc-bet-placed'))
      await loadBalances()
      setUserBet({ side, amount: amtFloat })
      setAmount('')
      setSide(null)
      onUpdate?.()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 80) ?? 'Bet failed')
    } finally {
      setPlacing(false)
    }
  }

  const handleClaim = async () => {
    if (!sessionWallet) return
    setClaiming(true)
    showPending('Claiming winnings...')
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: p.status === 'refunded' ? 'claimRefund' : 'claimWinnings',
        args: [BigInt(p.id)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Winnings claimed!')

      // Update bet result in Supabase
      const wallet = sessionWallet.address.toLowerCase()
      const claimable = await publicClient.readContract({
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI,
        functionName: 'getClaimableAmount',
        args: [BigInt(p.id), sessionWallet.address],
      })
      const payout = parseFloat(formatUnits(claimable, USDC_DECIMALS))
      await supabase.from('bets').update({ result: p.status === 'refunded' ? 'refunded' : 'won', payout }).eq('prediction_id', p.id).eq('wallet_address', wallet)

      await loadBalances()
      onUpdate?.()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 80) ?? 'Claim failed')
    } finally {
      setClaiming(false)
    }
  }

  const isOpen = p.status === 'open'
  const isSettled = p.status === 'yes_wins' || p.status === 'no_wins'
  const isRefunded = p.status === 'refunded'
  const canBet = isOpen && !userBet
  const canClaim = (isSettled || isRefunded) && userBet
  const payout = calcPayout()
  const now = Date.now()
  const deadlineMs = new Date(p.deadline).getTime()
  const locked = p.status === 'locked' || (isOpen && now >= deadlineMs - 5 * 60 * 1000)

  return (
    <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
      {/* Banner */}
      {p.banner_url && (
        <div style={{ position: 'relative' }}>
          <img src={p.banner_url} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
          <span className={`badge ${STATUS_CLASS[p.status]}`} style={{ position: 'absolute', top: 10, right: 10 }}>
            {STATUS_LABELS[p.status]}
          </span>
        </div>
      )}

      <div style={{ padding: 20 }}>
        {!p.banner_url && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <span className={`badge ${p.category === 'official_calls' ? 'badge-official' : p.category === 'community_calls' ? 'badge-community' : 'badge-refund'}`}>
              {p.category === 'official_calls' ? '⚡ Official' : p.category === 'community_calls' ? '🌐 Community' : ''}
            </span>
            <span className={`badge ${STATUS_CLASS[p.status]}`}>{STATUS_LABELS[p.status]}</span>
          </div>
        )}

        {/* Title */}
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.4 }}>{p.title}</div>

        {/* Description */}
        {p.description && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {p.description}
          </div>
        )}

        {/* Pool bars */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 3, height: 30, borderRadius: 8, overflow: 'hidden', marginBottom: 7 }}>
            <div className="pool-bar-yes" style={{ width: `${yesP}%` }}>{yesP > 15 ? `${yesP}%` : ''}</div>
            <div className="pool-bar-no"  style={{ width: `${noP}%`  }}>{noP  > 15 ? `${noP}%`  : ''}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span className="mono" style={{ color: 'var(--yes-color)' }}>YES {yes.toFixed(2)} USDC</span>
            <span className="mono" style={{ color: 'var(--no-color)' }}>NO {no.toFixed(2)} USDC</span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span>{bettorCount} bettor{bettorCount !== 1 ? 's' : ''}</span>
          <Countdown deadline={p.deadline} noDeadline={p.no_deadline} />
        </div>

        {/* User's existing bet */}
        {userBet && (
          <div style={{ padding: '8px 12px', background: 'var(--bg-glass)', borderRadius: 8, marginBottom: 12, fontSize: 12, display: 'flex', gap: 10 }}>
            <span>Your bet:</span>
            <span className={userBet.side === 'YES' ? 'badge badge-yes' : 'badge badge-no'}>{userBet.side}</span>
            <span className="mono">{Number(userBet.amount).toFixed(2)} USDC</span>
          </div>
        )}

        {/* Bet panel */}
        {canBet && !locked && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setSide('YES')} className={`btn-yes${side === 'YES' ? ' selected' : ''}`}>YES</button>
              <button onClick={() => setSide('NO')} className={`btn-no${side === 'NO' ? ' selected' : ''}`}>NO</button>
            </div>

            <div style={{ position: 'relative' }}>
              <input
                type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder={`Amount USDC (min ${MIN_BET_DISPLAY})`} min={MIN_BET_DISPLAY} step="0.1"
              />
            </div>

            {/* Quick chips */}
            <div style={{ display: 'flex', gap: 6 }}>
              {['0.5', '1', '5', '10'].map(v => (
                <button key={v} onClick={() => setAmount(a => String((parseFloat(a || '0') + parseFloat(v)).toFixed(1)))}
                  style={{ background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                  +{v}
                </button>
              ))}
            </div>

            {payout && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 10px', background: 'var(--bg-glass)', borderRadius: 6 }}>
                Potential payout: <span className="mono" style={{ color: 'var(--yes-color)' }}>{payout} USDC</span>
              </div>
            )}

            <button
              onClick={handleBet}
              disabled={placing || !side || !amount || parseFloat(amount) < parseFloat(MIN_BET_DISPLAY)}
              className="btn-primary"
              style={{ background: 'var(--accent-blue)', fontWeight: 700, padding: '12px' }}
            >
              {placing ? 'Placing...' : 'Place Bet'}
            </button>
          </div>
        )}

        {locked && isOpen && !userBet && (
          <div style={{ padding: '10px 14px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--pending)', textAlign: 'center' }}>
            🔒 Betting is locked
          </div>
        )}

        {/* Claim */}
        {canClaim && (
          <button onClick={handleClaim} disabled={claiming} className="btn-primary"
            style={{ width: '100%', background: 'rgba(74,222,128,0.2)', border: '1px solid var(--yes-color)', color: 'var(--yes-color)', fontWeight: 700, padding: '12px' }}>
            {claiming ? 'Claiming...' : isRefunded ? 'Claim Refund' : 'Claim USDC'}
          </button>
        )}

        {/* Explorer link */}
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <a href={`${EXPLORER_URL}/address/${BETTING_POOL_ADDRESS}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            View on Arc Explorer ↗
          </a>
        </div>
      </div>
    </div>
  )
}
