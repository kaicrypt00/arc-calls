import { useState, useEffect } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { useNavigate } from 'react-router-dom'
import { useSessionWallet, getMaxFeePerGas, publicClient } from '../contexts/SessionWalletContext'
import { arc } from '../config'
import { useToast } from '../contexts/ToastContext'
import { supabase, type DbPrediction, type DbTemplate, type DbPoll, type DbPollHistory, type DbXMonitorLog } from '../lib/supabase'
import { BETTING_POOL_ADDRESS, POLL_REGISTRY_ADDRESS, ADMIN_WALLETS } from '../constants'
import { BETTING_POOL_ABI, POLL_REGISTRY_ABI } from '../abis'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

type AdminTab = 'predictions' | 'polls' | 'resolver'
type PredictionSubTab = 'active' | 'history'

const CONDITION_TYPES = [
  'follower_count','tweet_count','new_post','pfp_change','verification_change',
  'next_tweet_views','next_tweet_likes','next_tweet_reposts','next_tweet_replies',
  'post_views','post_likes','post_reposts','post_replies',
]

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  open:     { bg: 'rgba(74,222,128,0.12)',  color: '#4ade80', border: 'rgba(74,222,128,0.35)'  },
  locked:   { bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', border: 'rgba(251,191,36,0.35)'  },
  yes_wins: { bg: 'rgba(74,222,128,0.15)',  color: '#4ade80', border: 'rgba(74,222,128,0.4)'   },
  no_wins:  { bg: 'rgba(248,113,113,0.15)', color: '#f87171', border: 'rgba(248,113,113,0.4)'  },
  refunded: { bg: 'rgba(142,159,176,0.12)', color: '#8e9fb0', border: 'rgba(142,159,176,0.3)'  },

}

function StatusBadge({ status, isLocked }: { status: string; isLocked?: boolean }) {
  const displayStatus = isLocked ? 'locked' : status
  const c = STATUS_COLORS[displayStatus] ?? STATUS_COLORS.open
  const label = isLocked ? 'LOCKED' :
                status === 'yes_wins' ? 'YES WINS' :
                status === 'no_wins'  ? 'NO WINS' :
                status === 'open'     ? 'LIVE' : status.toUpperCase()
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.6px', textTransform: 'uppercase', flexShrink: 0,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      fontFamily: 'JetBrains Mono, monospace', display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      {status === 'open' && !isLocked && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', display: 'inline-block' }} />
      )}
      {label}
    </span>
  )
}

function AdminModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(2,8,20,0.85)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: 'rgba(6,18,38,0.96)', border: '1px solid rgba(54,97,132,0.35)',
        borderRadius: 18, padding: '24px 28px', maxWidth: 480, width: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.85), 0 0 40px rgba(54,97,132,0.18)',
        position: 'relative', animation: 'adminModalIn 200ms ease both',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer', padding: '2px 8px', lineHeight: 1,
            borderRadius: 6, transition: 'color 150ms'
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function AdminPage() {
  const { address } = useAccount()
  const navigate = useNavigate()
  const { data: walletClient } = useWalletClient()
  useSessionWallet() // keep context active
  const { showPending, showConfirmed, showFailed } = useToast()

  const isAdmin = address ? ADMIN_WALLETS.includes(address.toLowerCase() as typeof ADMIN_WALLETS[number]) : false
  useEffect(() => { if (!isAdmin) navigate('/') }, [isAdmin, navigate])

  // Helper: call contract via connected main admin wallet (required for onlyAdmin)
  const adminWriteContract = async (
    params: { address: `0x${string}`; abi: never; functionName: string; args?: unknown[]; maxFeePerGas?: bigint }
  ): Promise<`0x${string}`> => {
    if (!walletClient) throw new Error('Main admin wallet not connected')
    return walletClient.writeContract({ ...params, chain: arc, account: walletClient.account })
  }

  const [tab, setTab] = useState<AdminTab>('predictions')
  const [predSubTab, setPredSubTab] = useState<PredictionSubTab>('active')
  const [predictions, setPredictions] = useState<DbPrediction[]>([])
  const [templates, setTemplates]     = useState<DbTemplate[]>([])
  const [polls, setPolls]             = useState<DbPoll[]>([])
  const [pollHistory, setPollHistory] = useState<DbPollHistory[]>([])
  const [pollSubTab, setPollSubTab]   = useState<'active' | 'history'>('active')
  const [resolverLogs, setResolverLogs] = useState<DbXMonitorLog[]>([])
  // Resolver tab state
  const [resolverSubTab, setResolverSubTab] = useState<'watching' | 'history'>('watching')
  const [openPredsForResolver, setOpenPredsForResolver] = useState<DbPrediction[]>([])
  const [resolverHistoryLogs, setResolverHistoryLogs] = useState<(DbXMonitorLog & { prediction_title?: string })[]>([])
  const [resolverLastRanAt, setResolverLastRanAt] = useState<Date | null>(null)
  const [resolverExpandedId, setResolverExpandedId] = useState<number | null>(null)
  const [resolverConfigForm, setResolverConfigForm] = useState<{
    handle: string; condition_type: string; threshold: string; tweet_url: string;
  }>({ handle: '', condition_type: '', threshold: '', tweet_url: '' })
  const [resolverActivating, setResolverActivating] = useState<number | null>(null)
  const [loading, setLoading]         = useState(false)
  const [onChainLocks, setOnChainLocks] = useState<Record<number, boolean>>({})
  const [isBusy, setIsBusy]           = useState(false)

  // Modals
  const [lockModal, setLockModal]       = useState<DbPrediction | null>(null)
  const [declareModal, setDeclareModal] = useState<DbPrediction | null>(null)
  const [extendModal, setExtendModal]   = useState<{ pred: DbPrediction; newDeadline: string } | null>(null)
  const [deleteModal, setDeleteModal]   = useState<DbPrediction | null>(null)
  const [refundModal, setRefundModal]   = useState<DbPrediction | null>(null)
  const [deletePollModal, setDeletePollModal] = useState<DbPoll | null>(null)
  const [deletePollHistoryModal, setDeletePollHistoryModal] = useState<DbPollHistory | null>(null)
  const [bannerModal, setBannerModal]   = useState<DbPrediction | null>(null)
  const [editBannerFile, setEditBannerFile] = useState<File | null>(null)
  const [editBannerPreview, setEditBannerPreview] = useState<string | null>(null)
  const [editBannerUrl, setEditBannerUrl] = useState('')
  const [savingBanner, setSavingBanner] = useState(false)

  // Create form state
  const [cTitle, setCTitle]           = useState('')
  const [cDesc, setCDesc]             = useState('')
  const [cBanner, setCBanner]         = useState('')
  const [cBannerFile, setCBannerFile] = useState<File | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)
  const [cDeadline, setCDeadline]     = useState('')
  const [cNoDeadline, setCNoDeadline] = useState(false)
  const [cCategory, setCCategory]     = useState<'community_calls'|'official_calls'>('community_calls')
  const [cXMonitor, setCXMonitor]     = useState(false)
  const [cHandle, setCHandle]         = useState('')
  const [cCondition, setCCondition]   = useState('follower_count')
  const [cThreshold, setCThreshold]   = useState('')
  const [cTweetUrl, setCTweetUrl]     = useState('')
  const [creating, setCreating]       = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showTemplatesDropdown, setShowTemplatesDropdown] = useState(false)
  const [formErrors, setFormErrors]   = useState<Record<string, string>>({})

  // Close round
  const [winner1, setWinner1] = useState('')
  const [winner2, setWinner2] = useState('')
  const [winner3, setWinner3] = useState('')
  const [closingRound, setClosingRound] = useState(false)

  const minDatetime = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 16)

  const fetchAll = async () => {
    setLoading(true)
    const [{ data: preds }, { data: tmpl }, { data: p }, { data: logs }, { data: histPolls }] = await Promise.all([
      supabase.from('predictions_display').select('*').order('id', { ascending: false }),
      supabase.from('templates').select('*').order('created_at', { ascending: false }),
      supabase.from('polls').select('*').eq('status', 'active').order('vote_count', { ascending: false }),
      supabase.from('x_monitor_logs').select('*').order('checked_at', { ascending: false }).limit(50),
      supabase.from('poll_history').select('*').order('round_number', { ascending: false }),
    ])
    if (preds) {
      setPredictions(preds as DbPrediction[])
      // Sync on-chain isBettingLocked state
      const activePreds = (preds as DbPrediction[]).filter(pr => ['open', 'locked'].includes(pr.status))
      if (activePreds.length > 0) {
        Promise.allSettled(
          activePreds.map(pr => publicClient.readContract({
            address: BETTING_POOL_ADDRESS,
            abi: BETTING_POOL_ABI,
            functionName: 'isBettingLocked',
            args: [BigInt(pr.id)],
          }))
        ).then(results => {
          const locks: Record<number, boolean> = {}
          activePreds.forEach((pr, idx) => {
            const res = results[idx]
            if (res.status === 'fulfilled') locks[pr.id] = res.value
          })
          setOnChainLocks(locks)
        }).catch(() => {})
      }
    }
    if (tmpl)  setTemplates(tmpl as DbTemplate[])
    if (p)         setPolls(p as DbPoll[])
    if (histPolls) setPollHistory(histPolls as DbPollHistory[])
    if (logs)      setResolverLogs(logs as DbXMonitorLog[])
    setLoading(false)
  }

  const loadResolverData = async () => {
    const { data: preds } = await supabase
      .from('predictions_display')
      .select('id, title, deadline, x_monitor, status')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    setOpenPredsForResolver((preds as DbPrediction[]) || [])

    const { data: latestLogs } = await supabase
      .from('x_monitor_logs')
      .select('*')
      .order('checked_at', { ascending: false })
      .limit(100)
    setResolverLogs(latestLogs as DbXMonitorLog[] || [])

    const { data: triggered } = await supabase
      .from('x_monitor_logs')
      .select('*')
      .eq('triggered', true)
      .order('checked_at', { ascending: false })
      .limit(50)
    if (triggered && triggered.length > 0) {
      const predIds = [...new Set(triggered.map((l: DbXMonitorLog) => l.prediction_id))]
      const { data: predTitles } = await supabase
        .from('predictions_display')
        .select('id, title')
        .in('id', predIds)
      const titleMap: Record<number, string> = {}
      if (predTitles) (predTitles as { id: number; title: string }[]).forEach(p => { titleMap[p.id] = p.title })
      setResolverHistoryLogs(
        (triggered as DbXMonitorLog[]).map(l => ({
          ...l,
          prediction_title: titleMap[l.prediction_id] || `#${l.prediction_id}`,
        }))
      )
    } else {
      setResolverHistoryLogs([])
    }
    if (latestLogs && latestLogs.length > 0) {
      setResolverLastRanAt(new Date((latestLogs[0] as DbXMonitorLog).checked_at))
    }
  }

  useEffect(() => { if (isAdmin) fetchAll() }, [isAdmin])
  useEffect(() => { if (isAdmin && tab === 'resolver') loadResolverData() }, [isAdmin, tab])

  // Realtime subscription on predictions_display
  useEffect(() => {
    const ch = supabase.channel('admin-predictions-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'predictions_display' }, () => {
        fetchAll()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Handle banner selection with preview & cleanup
  const handleBannerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setFormErrors(prev => ({ ...prev, banner: 'File exceeds 5MB limit' }))
      return
    }
    setFormErrors(prev => { const n = { ...prev }; delete n.banner; return n })
    setCBannerFile(file)
    setBannerPreview(prev => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  const clearBanner = () => {
    if (bannerPreview && bannerPreview.startsWith('blob:')) URL.revokeObjectURL(bannerPreview)
    setCBannerFile(null)
    setBannerPreview(null)
    setCBanner('')
  }

  const handleSaveTemplate = async () => {
    if (!cTitle.trim()) {
      showFailed('Enter a title to save template')
      return
    }
    const { error } = await supabase.from('templates').insert({
      title: cTitle.trim(),
      description: cDesc.trim(),
    })
    if (error) {
      showFailed(error.message)
    } else {
      showConfirmed(undefined, 'Template saved!')
      const { data } = await supabase.from('templates').select('*').order('created_at', { ascending: false })
      if (data) setTemplates(data as DbTemplate[])
    }
  }

  const handleDeleteTemplate = async (tmplId: string) => {
    await supabase.from('templates').delete().eq('id', tmplId)
    setTemplates(prev => prev.filter(t => t.id !== tmplId))
  }

  const handleLoadTemplate = (tmpl: DbTemplate) => {
    setCTitle(tmpl.title)
    setCDesc(tmpl.description)
    setShowTemplatesDropdown(false)
  }

  const validateForm = () => {
    const errs: Record<string, string> = {}
    if (!cTitle.trim()) errs.title = 'Title is required'
    if (cTitle.trim().length > 120) errs.title = 'Max 120 characters'
    if (!cNoDeadline) {
      if (!cDeadline) {
        errs.deadline = 'Select a deadline or choose No Deadline'
      } else {
        const dl = new Date(cDeadline).getTime()
        if (dl < Date.now() + 5 * 60 * 1000) {
          errs.deadline = 'Deadline must be at least 5 minutes in the future'
        }
      }
    }
    return errs
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validateForm()
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs)
      return
    }
    setFormErrors({})

    if (!walletClient) { showFailed('Connect your main wallet first'); return }
    setCreating(true)
    showPending('Publishing prediction...')

    try {
      let bannerUrl = cBanner.trim()
      if (cBannerFile) {
        showPending('Uploading banner image...')
        const ext = cBannerFile.name.split('.').pop() || 'jpg'
        const path = `banner_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
        const { error: upErr } = await supabase.storage.from('banners').upload(path, cBannerFile, {
          upsert: true,
          contentType: cBannerFile.type || 'image/jpeg',
        })
        if (upErr) {
          showFailed(`Banner upload failed: ${upErr.message}`)
          throw upErr
        }
        const { data: u } = supabase.storage.from('banners').getPublicUrl(path)
        bannerUrl = u.publicUrl
      }

      const deadlineTs = cNoDeadline
        ? Math.floor(new Date('2099-01-01').getTime() / 1000)
        : Math.floor(new Date(cDeadline).getTime() / 1000)

      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await adminWriteContract({
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: 'createPrediction',
        args: [cTitle.trim().slice(0, 120), cDesc.trim(), bannerUrl || '', BigInt(deadlineTs)],
        maxFeePerGas,
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status === 'reverted') throw new Error('Transaction reverted on-chain')
      showConfirmed(hash, 'Prediction published on-chain!')

      let predId = predictions.length + 1
      try {
        const log = receipt.logs[0]
        if (log?.topics[1]) predId = Number(BigInt(log.topics[1]))
      } catch {
        const total = await publicClient.readContract({
          address: BETTING_POOL_ADDRESS,
          abi: BETTING_POOL_ABI,
          functionName: 'totalPredictions',
        })
        predId = Number(total)
      }

      // Check if newly recycled ID is locked on-chain, and clear lock if so
      try {
        const isLocked = await publicClient.readContract({
          address: BETTING_POOL_ADDRESS,
          abi: BETTING_POOL_ABI,
          functionName: 'isBettingLocked',
          args: [BigInt(predId)],
        })
        if (isLocked) {
          const unlockHash = await adminWriteContract({
            address: BETTING_POOL_ADDRESS,
            abi: BETTING_POOL_ABI as never,
            functionName: 'unlockBetting',
            args: [BigInt(predId)],
            maxFeePerGas,
          })
          await publicClient.waitForTransactionReceipt({ hash: unlockHash })
        }
      } catch { /* ignore */ }

      const xMonitorData = cXMonitor ? {
        handle: cHandle.replace('@', ''),
        condition_type: cCondition,
        threshold: cThreshold || null,
        tweet_id: null,
        last_tweet_id: null,
        last_pfp_url: null,
        last_verified: null,
        activation_timestamp: Math.floor(Date.now() / 1000),
        tracking_tweet_id: null,
      } : null

      const { error: insertErr } = await supabase.from('predictions_display').insert({
        id: predId,
        title: cTitle.trim(),
        description: cDesc.trim(),
        banner_url: bannerUrl || '',
        deadline: cNoDeadline ? '2099-01-01T00:00:00Z' : new Date(cDeadline).toISOString(),
        no_deadline: cNoDeadline,
        status: 'open',
        yes_pool: 0,
        no_pool: 0,
        category: cCategory,
        winner: null,
        settled_at: null,
        x_monitor: xMonitorData,
        created_at: new Date().toISOString(),
      })
      if (insertErr) {
        console.error('[AdminPage] predictions_display insert error:', insertErr.message)
        throw new Error(`Prediction created on-chain but failed to save in database: ${insertErr.message}`)
      }

      await supabase.from('wallet_transactions').insert({
        wallet_address: address,
        type: 'admin_action',
        label: `Created prediction #${predId}: ${cTitle.trim().slice(0, 45)}`,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })

      // Reset form
      setCTitle('')
      setCDesc('')
      setCBanner('')
      clearBanner()
      setCDeadline('')
      setCNoDeadline(false)
      setCXMonitor(false)
      setCHandle('')
      setCThreshold('')
      setCTweetUrl('')
      setShowPreview(false)
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 100) ?? 'Creation failed')
    } finally {
      setCreating(false)
    }
  }

  // Lock Betting Action
  const doLock = async (pred: DbPrediction) => {
    if (!walletClient) { showFailed('Connect your main wallet first'); return }
    setIsBusy(true)
    showPending('Locking betting on-chain...')
    setLockModal(null)
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await adminWriteContract({
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: 'lockBetting',
        args: [BigInt(pred.id)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, `Locked call #${pred.id}!`)
      await supabase.from('predictions_display').update({ status: 'locked' }).eq('id', pred.id)
      await supabase.from('wallet_transactions').insert({
        wallet_address: address,
        type: 'admin_action',
        label: `Locked call #${pred.id}: ${pred.title.slice(0, 40)}`,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Lock failed')
    } finally {
      setIsBusy(false)
    }
  }

  // Unlock Betting Action
  const doUnlock = async (pred: DbPrediction) => {
    if (!walletClient) { showFailed('Connect your main wallet first'); return }
    setIsBusy(true)
    showPending('Unlocking betting on-chain...')
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await adminWriteContract({
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: 'unlockBetting',
        args: [BigInt(pred.id)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, `Unlocked call #${pred.id}!`)
      await supabase.from('predictions_display').update({ status: 'open' }).eq('id', pred.id)
      await supabase.from('wallet_transactions').insert({
        wallet_address: address,
        type: 'admin_action',
        label: `Unlocked call #${pred.id}: ${pred.title.slice(0, 40)}`,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Unlock failed')
    } finally {
      setIsBusy(false)
    }
  }

  // Declare Winner Action (Settlement)
  const doDeclare = async (pred: DbPrediction, side: 'YES' | 'NO') => {
    if (!walletClient) { showFailed('Connect your main wallet first'); return }
    setIsBusy(true)
    showPending(`Declaring ${side} wins on-chain...`)
    setDeclareModal(null)

    try {
      const sideNum = side === 'YES' ? 1n : 2n
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await adminWriteContract({
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: 'declareWinner',
        args: [BigInt(pred.id), sideNum],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })

      // Verify whether contract declared winner or refunded (e.g. if one pool was empty)
      const onChainPred = await publicClient.readContract({
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI,
        functionName: 'getPrediction',
        args: [BigInt(pred.id)],
      }) as { status: number }

      const isRefunded = Number(onChainPred.status) === 4 // Status.REFUNDED

      if (isRefunded) {
        showConfirmed(hash, 'Empty opposing pool: market was refunded on-chain.')
        await supabase.from('predictions_display').update({
          status: 'refunded',
          winner: null,
          settled_at: new Date().toISOString(),
        }).eq('id', pred.id)

        await supabase.from('bets').update({ result: 'refunded' })
          .eq('prediction_id', pred.id)

        await supabase.from('wallet_transactions').insert({
          wallet_address: address,
          type: 'admin_action',
          label: `Market #${pred.id} refunded (empty pool): ${pred.title.slice(0, 45)}`,
          tx_hash: hash,
          created_at: new Date().toISOString(),
        })

        await fetchAll()
        return
      }

      showConfirmed(hash, `${side} wins declared!`)

      const statusVal = side === 'YES' ? 'yes_wins' : 'no_wins'
      await supabase.from('predictions_display').update({
        status: statusVal,
        winner: side,
        settled_at: new Date().toISOString(),
      }).eq('id', pred.id)

      // Update bets table
      const winningSide = side
      const losingSide = side === 'YES' ? 'NO' : 'YES'
      await supabase.from('bets').update({ result: 'won' })
        .eq('prediction_id', pred.id).ilike('side', winningSide)
      await supabase.from('bets').update({ result: 'lost' })
        .eq('prediction_id', pred.id).ilike('side', losingSide)

      // Update leaderboard stats for winners & losers
      try {
        const [{ data: loserBets }, { data: winnerBets }] = await Promise.all([
          supabase.from('bets').select('wallet_address, amount').eq('prediction_id', pred.id).ilike('side', losingSide),
          supabase.from('bets').select('wallet_address, amount').eq('prediction_id', pred.id).ilike('side', winningSide),
        ])
        const winningPool = (winnerBets || []).reduce((s, b) => s + parseFloat(String(b.amount || 0)), 0)
        const losingPool  = (loserBets  || []).reduce((s, b) => s + parseFloat(String(b.amount || 0)), 0)

        for (const lb of (loserBets || [])) {
          const { data: row } = await supabase.from('leaderboard')
            .select('wins, losses, total_pnl').eq('wallet_address', lb.wallet_address).single()
          if (row) {
            const newLosses = (row.losses || 0) + 1
            const newWins   = row.wins || 0
            const winRate   = (newWins + newLosses) > 0 ? (newWins / (newWins + newLosses)) * 100 : 0
            await supabase.from('leaderboard').update({
              losses: newLosses,
              total_pnl: parseFloat(((row.total_pnl || 0) - parseFloat(String(lb.amount || 0))).toFixed(4)),
              win_rate: parseFloat(winRate.toFixed(2)),
            }).eq('wallet_address', lb.wallet_address)
          }
        }
        for (const wb of (winnerBets || [])) {
          const betAmt = parseFloat(String(wb.amount || 0))
          const profit = winningPool > 0 ? (betAmt / winningPool) * losingPool : 0
          const { data: row } = await supabase.from('leaderboard')
            .select('wins, losses, total_pnl').eq('wallet_address', wb.wallet_address).single()
          if (row) {
            const newWins   = (row.wins || 0) + 1
            const newLosses = row.losses || 0
            const winRate   = (newWins + newLosses) > 0 ? (newWins / (newWins + newLosses)) * 100 : 0
            await supabase.from('leaderboard').update({
              wins: newWins,
              total_pnl: parseFloat(((Number(row.total_pnl) || 0) + profit).toFixed(4)),
              win_rate: parseFloat(winRate.toFixed(2)),
            }).eq('wallet_address', wb.wallet_address)
          }
        }
      } catch (err) {
        console.error('[AdminPage] leaderboard update error:', err)
      }

      await supabase.from('wallet_transactions').insert({
        wallet_address: address,
        type: 'admin_action',
        label: `Declared ${side} wins on #${pred.id}: ${pred.title.slice(0, 45)}`,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })

      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Declare failed')
    } finally {
      setIsBusy(false)
    }
  }

  // Extend Deadline Action
  const doExtend = async (pred: DbPrediction, newDateIso: string) => {
    if (!walletClient) { showFailed('Connect your main wallet first'); return }
    if (!newDateIso) return
    setIsBusy(true)
    showPending('Extending deadline on-chain...')
    setExtendModal(null)
    try {
      const ts = BigInt(Math.floor(new Date(newDateIso).getTime() / 1000))
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await adminWriteContract({
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: 'extendDeadline',
        args: [BigInt(pred.id), ts],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, `Deadline extended on #${pred.id}!`)
      await supabase.from('predictions_display').update({
        deadline: new Date(newDateIso).toISOString(),
      }).eq('id', pred.id)
      await supabase.from('wallet_transactions').insert({
        wallet_address: address,
        type: 'admin_action',
        label: `Extended deadline on #${pred.id} to ${new Date(newDateIso).toLocaleDateString()}`,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Extend failed')
    } finally {
      setIsBusy(false)
    }
  }

  // Remove from History — Supabase-only cleanup for already-settled markets.
  // The on-chain record is permanent. Bettors can always claim via the blockchain.
  // This only hides the market from the website history tab.
  const doDelete = async (pred: DbPrediction) => {
    setIsBusy(true)
    showPending('Removing from history...')
    setDeleteModal(null)
    try {
      if (pred.banner_url) {
        const parts = pred.banner_url.split('/banners/')
        if (parts.length > 1) {
          await supabase.storage.from('banners').remove([parts[1]])
        }
      }
      await supabase.from('predictions_display').delete().eq('id', pred.id)
      await supabase.from('bets').delete().eq('prediction_id', pred.id)
      showConfirmed(undefined, `Market #${pred.id} removed from history!`)
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Remove failed')
    } finally {
      setIsBusy(false)
    }
  }

  // Refund Market — marks an OPEN or LOCKED market as REFUNDED on-chain.
  // Both YES and NO bettors can then claim their full original stake back.
  // This is a permanent on-chain state change — it cannot be undone.
  // The market stays visible in history so bettors know to claim their refund.
  const doRefund = async (pred: DbPrediction) => {
    if (!walletClient) { showFailed('Connect your main wallet first'); return }
    setIsBusy(true)
    showPending('Marking market as refunded on-chain...')
    setRefundModal(null)
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await adminWriteContract({
        address: BETTING_POOL_ADDRESS,
        abi: BETTING_POOL_ABI as never,
        functionName: 'refundPrediction',
        args: [BigInt(pred.id)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      await supabase.from('predictions_display').update({ status: 'refunded' }).eq('id', pred.id)
      await supabase.from('bets').update({ result: 'refunded' }).eq('prediction_id', pred.id)
      await supabase.from('wallet_transactions').insert({
        wallet_address: address,
        type: 'admin_action',
        label: `Refunded market #${pred.id}: ${pred.title.slice(0, 45)}`,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })
      showConfirmed(hash, `Market #${pred.id} refunded — all bettors can now claim back!`)
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Refund failed')
    } finally {
      setIsBusy(false)
    }
  }

  // Banner Update & Remove Handlers
  const handleUpdateBanner = async (pred: DbPrediction) => {
    setSavingBanner(true)
    showPending('Updating banner...')
    try {
      let finalUrl = editBannerUrl.trim()
      if (editBannerFile) {
        const ext = editBannerFile.name.split('.').pop() || 'jpg'
        const path = `banner_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
        const { error: upErr } = await supabase.storage.from('banners').upload(path, editBannerFile, {
          upsert: true,
          contentType: editBannerFile.type || 'image/jpeg',
        })
        if (upErr) {
          showFailed(`Upload failed: ${upErr.message}`)
          throw upErr
        }
        const { data: u } = supabase.storage.from('banners').getPublicUrl(path)
        finalUrl = u.publicUrl
      }

      const { error: dbErr } = await supabase.from('predictions_display').update({
        banner_url: finalUrl || '',
      }).eq('id', pred.id)

      if (dbErr) throw dbErr

      showConfirmed(undefined, `Banner updated for prediction #${pred.id}!`)
      if (editBannerPreview && editBannerPreview.startsWith('blob:')) URL.revokeObjectURL(editBannerPreview)
      setBannerModal(null)
      setEditBannerFile(null)
      setEditBannerPreview(null)
      setEditBannerUrl('')
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Banner update failed')
    } finally {
      setSavingBanner(false)
    }
  }

  const handleRemoveBanner = async (pred: DbPrediction) => {
    setSavingBanner(true)
    showPending('Removing banner...')
    try {
      if (pred.banner_url) {
        const parts = pred.banner_url.split('/banners/')
        if (parts.length > 1) {
          await supabase.storage.from('banners').remove([parts[1]])
        }
      }
      const { error: dbErr } = await supabase.from('predictions_display').update({
        banner_url: '',
      }).eq('id', pred.id)

      if (dbErr) throw dbErr

      showConfirmed(undefined, `Banner removed for prediction #${pred.id}!`)
      if (editBannerPreview && editBannerPreview.startsWith('blob:')) URL.revokeObjectURL(editBannerPreview)
      setBannerModal(null)
      setEditBannerFile(null)
      setEditBannerPreview(null)
      setEditBannerUrl('')
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Remove failed')
    } finally {
      setSavingBanner(false)
    }
  }

  // Close Round Action (Polls)
  const handleCloseRound = async () => {
    if (!walletClient) { showFailed('Connect your main wallet first'); return }
    if (!winner1 || !winner2 || !winner3) { showFailed('Select 3 winners'); return }
    setClosingRound(true)
    showPending('Closing round on-chain...')
    try {
      const ids = [BigInt(winner1), BigInt(winner2), BigInt(winner3)] as [bigint, bigint, bigint]
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await adminWriteContract({
        address: POLL_REGISTRY_ADDRESS,
        abi: POLL_REGISTRY_ABI as never,
        functionName: 'closeRound',
        args: [ids],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Round closed!')
      const roundRes = await publicClient.readContract({
        address: POLL_REGISTRY_ADDRESS,
        abi: POLL_REGISTRY_ABI,
        functionName: 'currentRound',
      })
      const round = Number(roundRes) - 1
      for (const id of [winner1, winner2, winner3]) {
        const poll = polls.find(p => p.id === Number(id))
        if (!poll) continue
        await supabase.from('poll_history').insert({
          round_number: round,
          poll_id: Number(id),
          poll_title: poll.title,
          description: poll.description,
          submitted_by_name: poll.created_by_name,
          final_vote_count: poll.vote_count,
          closed_at: new Date().toISOString(),
        })
      }
      setWinner1(''); setWinner2(''); setWinner3('')
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 80) ?? 'Close round failed')
    } finally {
      setClosingRound(false)
    }
  }

  const doDeletePoll = async (poll: DbPoll) => {
    setIsBusy(true)
    showPending('Deleting poll from website...')
    setDeletePollModal(null)
    try {
      if (walletClient) {
        try {
          const maxFeePerGas = await getMaxFeePerGas()
          const hash = await adminWriteContract({
            address: POLL_REGISTRY_ADDRESS,
            abi: POLL_REGISTRY_ABI as never,
            functionName: 'deletePoll',
            args: [BigInt(poll.id)],
            maxFeePerGas,
          })
          await publicClient.waitForTransactionReceipt({ hash })
          await supabase.from('wallet_transactions').insert({
            wallet_address: address,
            type: 'admin_action',
            label: `Deleted poll #${poll.id}: ${poll.title.slice(0, 45)}`,
            tx_hash: hash,
            created_at: new Date().toISOString(),
          })
        } catch (onChainErr) {
          console.warn('[AdminPage] on-chain deletePoll bypassed or failed:', onChainErr)
        }
      }

      await supabase.from('poll_votes').delete().eq('poll_id', poll.id)
      await supabase.from('polls').delete().eq('id', poll.id)

      showConfirmed(undefined, `Poll #${poll.id} deleted from website!`)
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Delete poll failed')
    } finally {
      setIsBusy(false)
    }
  }

  const doDeletePollHistory = async (item: DbPollHistory) => {
    setIsBusy(true)
    showPending('Removing poll from history...')
    setDeletePollHistoryModal(null)
    try {
      await supabase.from('poll_history').delete().eq('id', item.id)
      showConfirmed(undefined, 'Poll history entry removed!')
      await fetchAll()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 90) ?? 'Remove poll history failed')
    } finally {
      setIsBusy(false)
    }
  }

  if (!isAdmin) return null

  const activePredictions = predictions.filter(p => ['open', 'locked'].includes(p.status))
  const historyPredictions = predictions.filter(p => ['yes_wins', 'no_wins', 'refunded'].includes(p.status))

  return (
    <div className="page" style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />
      <main style={{ flex: 1, width: '100%' }}>
        <div className="container" style={{ padding: '32px 20px 80px', maxWidth: 1280 }}>

          {/* Header */}
          <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '2px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace', marginBottom: 6 }}>
                Arc Calls · Arena Operations
              </div>
              <h1 style={{ fontSize: 'clamp(24px, 3.5vw, 34px)', fontWeight: 800, letterSpacing: '-0.5px', margin: 0, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                Admin Operations
              </h1>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>
                Admin: <span style={{ color: 'var(--accent-bright)' }}>{address}</span>
              </div>
            </div>

            {/* Quick Stat Badges */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { label: 'Active Calls', value: activePredictions.length, color: 'var(--yes-color)', icon: '🟢' },
                { label: 'Locked Calls', value: activePredictions.filter(p => onChainLocks[p.id] || p.status === 'locked').length, color: 'var(--pending)', icon: '🔒' },
                { label: 'Settled History', value: historyPredictions.length, color: 'var(--text-secondary)', icon: '📜' },
              ].map(s => (
                <div key={s.label} style={{
                  padding: '10px 18px', background: 'rgba(6,18,38,0.75)', border: '1px solid rgba(54,97,132,0.25)',
                  borderRadius: 12, backdropFilter: 'blur(12px)', minWidth: 105, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1, marginBottom: 4 }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Primary Top Tab Navigation */}
          <div style={{
            display: 'flex', gap: 6, background: 'rgba(6,18,38,0.85)', padding: 5, borderRadius: 12,
            border: '1px solid rgba(54,97,132,0.22)', width: 'fit-content', marginBottom: 28,
          }}>
            {[
              { id: 'predictions', label: '📊 Predictions & Live Management' },
              { id: 'polls',       label: '🗳 Poll Management' },
              { id: 'resolver',    label: '🔗 X Resolver' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as AdminTab)}
                style={{
                  background: tab === t.id ? 'rgba(54,97,132,0.3)' : 'transparent',
                  color: tab === t.id ? 'var(--accent-bright)' : 'var(--text-secondary)',
                  border: tab === t.id ? '1px solid rgba(90,138,176,0.4)' : '1px solid transparent',
                  padding: '9px 20px', borderRadius: 8, fontFamily: 'var(--font-display)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 200ms ease',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════════════════════════════════════════════ */}
          {/* TAB 1: PREDICTIONS & MANAGEMENT                                        */}
          {/* ══════════════════════════════════════════════════════════════════════ */}
          {tab === 'predictions' && (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 420px) 1fr', gap: 24, alignItems: 'start' }}>

              {/* ── LEFT COLUMN: Templates + Create Form ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Templates Section */}
                <div style={{
                  background: 'rgba(6,18,38,0.75)', border: '1px solid rgba(54,97,132,0.22)',
                  borderRadius: 16, padding: 20, backdropFilter: 'blur(16px)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>📁</span> Saved Templates
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {templates.length} saved
                    </span>
                  </div>

                  {templates.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '12px 0', textAlign: 'center' }}>
                      No saved templates yet. Enter title & description below then click &quot;Save Template&quot;.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                      {templates.map(t => (
                        <div
                          key={t.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                            padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(54,97,132,0.18)',
                            borderRadius: 8, transition: 'all 150ms ease',
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => handleLoadTemplate(t)}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.title}
                            </div>
                            {t.description && (
                              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                                {t.description}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => handleLoadTemplate(t)}
                              style={{
                                background: 'rgba(54,97,132,0.25)', border: '1px solid rgba(90,138,176,0.3)',
                                color: 'var(--accent-bright)', padding: '3px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
                              }}
                            >
                              Load
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(t.id)}
                              style={{
                                background: 'transparent', border: '1px solid rgba(248,113,113,0.3)',
                                color: 'var(--no-color)', padding: '3px 7px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Create Prediction Form */}
                <div style={{
                  background: 'rgba(6,18,38,0.75)', border: '1px solid rgba(54,97,132,0.25)',
                  borderRadius: 16, padding: 22, backdropFilter: 'blur(16px)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>➕</span> Create Prediction
                    </div>
                    {templates.length > 0 && (
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          onClick={() => setShowTemplatesDropdown(s => !s)}
                          style={{
                            background: 'rgba(54,97,132,0.18)', border: '1px solid rgba(90,138,176,0.3)',
                            color: 'var(--accent-bright)', borderRadius: 7, padding: '4px 10px', fontSize: 11,
                            fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          Load Template ▾
                        </button>
                        {showTemplatesDropdown && (
                          <div style={{
                            position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 100,
                            background: 'rgba(6,18,38,0.98)', border: '1px solid rgba(54,97,132,0.4)',
                            borderRadius: 10, width: 260, boxShadow: '0 12px 32px rgba(0,0,0,0.8)',
                            overflow: 'hidden', padding: 4,
                          }}>
                            {templates.map(t => (
                              <div
                                key={t.id}
                                onClick={() => handleLoadTemplate(t)}
                                style={{
                                  padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 6,
                                  color: 'var(--text-primary)', transition: 'background 150ms',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(54,97,132,0.25)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                {t.title.slice(0, 36)}...
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Title */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Title *</span>
                        <span style={{ color: cTitle.length > 110 ? 'var(--pending)' : 'var(--text-tertiary)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {cTitle.length}/120
                        </span>
                      </label>
                      <input
                        value={cTitle}
                        onChange={e => {
                          setCTitle(e.target.value.slice(0, 120))
                          if (formErrors.title) setFormErrors(prev => { const n = { ...prev }; delete n.title; return n })
                        }}
                        placeholder="e.g. Will Arc reach $100M total value locked by Q3?"
                        maxLength={120}
                        style={{
                          width: '100%', padding: '10px 14px', borderRadius: 9,
                          background: 'rgba(3,10,24,0.6)', border: formErrors.title ? '1px solid var(--no-color)' : '1px solid rgba(54,97,132,0.3)',
                          color: 'var(--text-primary)', fontSize: 13, outline: 'none',
                        }}
                      />
                      {formErrors.title && <div style={{ fontSize: 11, color: 'var(--no-color)', marginTop: 4 }}>{formErrors.title}</div>}
                    </div>

                    {/* Description */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                        Description &amp; Resolution Criteria *
                      </label>
                      <textarea
                        value={cDesc}
                        onChange={e => setCDesc(e.target.value)}
                        placeholder="Define clear resolution parameters for YES and NO..."
                        rows={3}
                        style={{
                          width: '100%', padding: '10px 14px', borderRadius: 9,
                          background: 'rgba(3,10,24,0.6)', border: '1px solid rgba(54,97,132,0.3)',
                          color: 'var(--text-primary)', fontSize: 13, outline: 'none', resize: 'vertical', minHeight: 70,
                        }}
                      />
                    </div>

                    {/* Banner Image Upload & Aspect Ratio Info */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                        Banner Image (Optional)
                      </label>
                      <div style={{
                        border: '1px dashed rgba(54,97,132,0.4)', borderRadius: 10, padding: 14,
                        textAlign: 'center', background: 'rgba(3,10,24,0.3)', position: 'relative',
                      }}>
                        {bannerPreview ? (
                          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
                            <img src={bannerPreview} alt="Banner preview" style={{ width: '100%', maxHeight: 150, objectFit: 'cover', borderRadius: 8 }} />
                            <button
                              type="button"
                              onClick={clearBanner}
                              style={{
                                position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.7)',
                                border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, color: '#fff',
                                padding: '3px 8px', fontSize: 12, cursor: 'pointer',
                              }}
                            >
                              ✕ Remove
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: 26, marginBottom: 4 }}>🖼️</div>
                            <label htmlFor="admin-banner-upload" style={{ cursor: 'pointer', display: 'inline-block', color: 'var(--accent-bright)', fontSize: 12, fontWeight: 600 }}>
                              Choose Banner Image
                              <input
                                id="admin-banner-upload"
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={handleBannerFileChange}
                                style={{ display: 'none' }}
                              />
                            </label>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                              Best: <span style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>2:1 aspect ratio</span> (e.g. 1280×640px) · Max 5MB
                            </div>
                          </div>
                        )}
                      </div>
                      {formErrors.banner && <div style={{ fontSize: 11, color: 'var(--no-color)', marginTop: 4 }}>{formErrors.banner}</div>}

                      {/* Fallback Direct URL */}
                      {!bannerPreview && (
                        <input
                          value={cBanner}
                          onChange={e => setCBanner(e.target.value)}
                          placeholder="Or paste image URL (https://...)"
                          style={{
                            width: '100%', padding: '7px 12px', borderRadius: 8, marginTop: 8,
                            background: 'rgba(3,10,24,0.6)', border: '1px solid rgba(54,97,132,0.2)',
                            color: 'var(--text-primary)', fontSize: 11, outline: 'none',
                          }}
                        />
                      )}
                    </div>

                    {/* Deadline Toggle (Set Deadline vs No Deadline) */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>
                        Deadline Settings
                      </label>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button
                          type="button"
                          onClick={() => setCNoDeadline(false)}
                          style={{
                            flex: 1, padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            background: !cNoDeadline ? 'rgba(54,97,132,0.3)' : 'rgba(3,10,24,0.5)',
                            color: !cNoDeadline ? 'var(--accent-bright)' : 'var(--text-tertiary)',
                            border: !cNoDeadline ? '1px solid rgba(90,138,176,0.5)' : '1px solid rgba(54,97,132,0.2)',
                          }}
                        >
                          📅 Set Deadline
                        </button>
                        <button
                          type="button"
                          onClick={() => setCNoDeadline(true)}
                          style={{
                            flex: 1, padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            background: cNoDeadline ? 'rgba(54,97,132,0.3)' : 'rgba(3,10,24,0.5)',
                            color: cNoDeadline ? 'var(--accent-bright)' : 'var(--text-tertiary)',
                            border: cNoDeadline ? '1px solid rgba(90,138,176,0.5)' : '1px solid rgba(54,97,132,0.2)',
                          }}
                        >
                          ♾️ No Deadline
                        </button>
                      </div>

                      {!cNoDeadline ? (
                        <div>
                          <input
                            type="datetime-local"
                            min={minDatetime}
                            value={cDeadline}
                            onChange={e => {
                              setCDeadline(e.target.value)
                              if (formErrors.deadline) setFormErrors(prev => { const n = { ...prev }; delete n.deadline; return n })
                            }}
                            style={{
                              width: '100%', padding: '9px 12px', borderRadius: 8,
                              background: 'rgba(3,10,24,0.6)', border: formErrors.deadline ? '1px solid var(--no-color)' : '1px solid rgba(54,97,132,0.3)',
                              color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                            }}
                          />
                          {formErrors.deadline && <div style={{ fontSize: 11, color: 'var(--no-color)', marginTop: 4 }}>{formErrors.deadline}</div>}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'rgba(54,97,132,0.1)', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(54,97,132,0.2)' }}>
                          ℹ️ Open-ended call. Betting stays active until you manually lock it or declare a winner.
                        </div>
                      )}
                    </div>

                    {/* Category */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                        Category
                      </label>
                      <select
                        value={cCategory}
                        onChange={e => setCCategory(e.target.value as 'community_calls'|'official_calls')}
                        style={{
                          width: '100%', padding: '9px 12px', borderRadius: 8,
                          background: 'rgba(3,10,24,0.6)', border: '1px solid rgba(54,97,132,0.3)',
                          color: 'var(--text-primary)', fontSize: 12, outline: 'none', cursor: 'pointer',
                        }}
                      >
                        <option value="community_calls">Community Calls</option>
                        <option value="official_calls">Official Calls</option>
                      </select>
                    </div>

                    {/* X Monitor Section */}
                    <div style={{
                      padding: 14, background: 'rgba(3,10,24,0.5)', borderRadius: 10,
                      border: '1px solid rgba(54,97,132,0.25)',
                    }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: 'var(--text-primary)' }}>
                        <input
                          type="checkbox"
                          checked={cXMonitor}
                          onChange={e => setCXMonitor(e.target.checked)}
                          style={{ width: 'auto', accentColor: 'var(--accent-bright)' }}
                        />
                        <span style={{ fontWeight: 700 }}>Enable X Monitor (Automated Oracle)</span>
                      </label>
                      {cXMonitor && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
                          <input
                            value={cHandle}
                            onChange={e => setCHandle(e.target.value)}
                            placeholder="@TwitterHandle"
                            style={{
                              padding: '8px 12px', borderRadius: 7, background: 'rgba(6,18,38,0.8)',
                              border: '1px solid rgba(54,97,132,0.3)', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                            }}
                          />
                          <select
                            value={cCondition}
                            onChange={e => setCCondition(e.target.value)}
                            style={{
                              padding: '8px 12px', borderRadius: 7, background: 'rgba(6,18,38,0.8)',
                              border: '1px solid rgba(54,97,132,0.3)', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                            }}
                          >
                            {CONDITION_TYPES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                          </select>
                          <input
                            value={cThreshold}
                            onChange={e => setCThreshold(e.target.value)}
                            placeholder="Threshold (e.g. 50000)"
                            style={{
                              padding: '8px 12px', borderRadius: 7, background: 'rgba(6,18,38,0.8)',
                              border: '1px solid rgba(54,97,132,0.3)', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                            }}
                          />
                          <input
                            value={cTweetUrl}
                            onChange={e => setCTweetUrl(e.target.value)}
                            placeholder="Tweet URL (for post-specific conditions)"
                            style={{
                              padding: '8px 12px', borderRadius: 7, background: 'rgba(6,18,38,0.8)',
                              border: '1px solid rgba(54,97,132,0.3)', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Live Preview Card */}
                    {showPreview && (
                      <div style={{
                        border: '1px solid rgba(54,97,132,0.4)', borderRadius: 14, overflow: 'hidden',
                        background: 'rgba(6,18,38,0.9)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                      }}>
                        <div style={{
                          padding: '8px 14px', background: 'rgba(54,97,132,0.2)', fontSize: 11,
                          color: 'var(--accent-bright)', fontWeight: 600, display: 'flex', justifyContent: 'space-between',
                        }}>
                          <span>Card Preview (How users see it)</span>
                          <span>Live Simulation</span>
                        </div>
                        {(bannerPreview || cBanner) && (
                          <div style={{ width: '100%', height: 140, overflow: 'hidden' }}>
                            <img src={bannerPreview || cBanner} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        )}
                        <div style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                              {cCategory === 'official_calls' ? 'Official Call' : 'Community Call'}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--yes-color)', fontWeight: 700 }}>OPEN</span>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, lineHeight: 1.3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {cTitle || 'Your prediction title will appear here...'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {cDesc || 'Resolution criteria and context will show here...'}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6, fontFamily: 'JetBrains Mono, monospace' }}>
                            <span style={{ color: 'var(--yes-color)' }}>YES 50%</span>
                            <span style={{ color: 'var(--no-color)' }}>NO 50%</span>
                          </div>
                          <div style={{ height: 6, background: 'rgba(248,113,113,0.3)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: '50%', height: '100%', background: 'var(--yes-color)' }} />
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, textAlign: 'right' }}>
                            {cNoDeadline ? 'Real-time' : cDeadline ? `Ends ${new Date(cDeadline).toLocaleDateString()}` : 'Deadline not set'}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="submit"
                        disabled={creating}
                        style={{
                          flex: 1, padding: '12px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
                          background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)', color: '#fff',
                          border: 'none', cursor: creating ? 'not-allowed' : 'pointer',
                          boxShadow: '0 4px 16px rgba(14,165,233,0.3)', transition: 'all 200ms ease',
                        }}
                      >
                        {creating ? 'Publishing on Arc...' : '🚀 Publish Prediction'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowPreview(s => !s)}
                        style={{
                          padding: '12px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600,
                          background: 'rgba(54,97,132,0.2)', border: '1px solid rgba(90,138,176,0.3)',
                          color: 'var(--accent-bright)', cursor: 'pointer', transition: 'all 150ms ease',
                        }}
                      >
                        {showPreview ? 'Hide Preview' : '👁 Preview'}
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveTemplate}
                        disabled={!cTitle.trim()}
                        style={{
                          padding: '12px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600,
                          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(54,97,132,0.25)',
                          color: 'var(--text-secondary)', cursor: !cTitle.trim() ? 'not-allowed' : 'pointer',
                          opacity: !cTitle.trim() ? 0.5 : 1, transition: 'all 150ms ease',
                        }}
                      >
                        💾 Save Template
                      </button>
                    </div>

                  </form>
                </div>
              </div>

              {/* ── RIGHT COLUMN: Manage Predictions (Active vs Settled History) ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Sub-tab Navigation */}
                <div style={{
                  background: 'rgba(6,18,38,0.75)', border: '1px solid rgba(54,97,132,0.22)',
                  borderRadius: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', flexWrap: 'wrap', gap: 12, backdropFilter: 'blur(12px)',
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>📊</span>
                    <span>{predSubTab === 'active' ? 'Active Arena Calls' : 'Settled History & Archives'}</span>
                  </div>

                  <div style={{ display: 'flex', gap: 6, background: 'rgba(3,10,24,0.6)', padding: 4, borderRadius: 8, border: '1px solid rgba(54,97,132,0.2)' }}>
                    <button
                      onClick={() => setPredSubTab('active')}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                        background: predSubTab === 'active' ? 'rgba(54,97,132,0.4)' : 'transparent',
                        color: predSubTab === 'active' ? 'var(--accent-bright)' : 'var(--text-secondary)',
                      }}
                    >
                      Active ({activePredictions.length})
                    </button>
                    <button
                      onClick={() => setPredSubTab('history')}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                        background: predSubTab === 'history' ? 'rgba(54,97,132,0.4)' : 'transparent',
                        color: predSubTab === 'history' ? 'var(--accent-bright)' : 'var(--text-secondary)',
                      }}
                    >
                      History ({historyPredictions.length})
                    </button>
                  </div>
                </div>

                {/* Predictions Content */}
                {loading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} className="skeleton" style={{ height: 110, borderRadius: 14 }} />
                    ))}
                  </div>
                ) : (predSubTab === 'active' ? activePredictions : historyPredictions).length === 0 ? (
                  <div style={{
                    padding: 56, textAlign: 'center', color: 'var(--text-secondary)',
                    background: 'rgba(6,18,38,0.75)', borderRadius: 16, border: '1px solid rgba(54,97,132,0.2)',
                  }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>
                      {predSubTab === 'active' ? '📋' : '📜'}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                      {predSubTab === 'active' ? 'No Active Predictions' : 'No Settled History'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                      {predSubTab === 'active' ? 'Publish a new prediction using the form on the left.' : 'Settled predictions will appear here once declared.'}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(predSubTab === 'active' ? activePredictions : historyPredictions).map(p => {
                      const isLocked = onChainLocks[p.id] ?? (p.status === 'locked')
                      return (
                        <div
                          key={p.id}
                          style={{
                            background: 'rgba(6,18,38,0.75)', border: '1px solid rgba(54,97,132,0.22)',
                            borderRadius: 14, padding: '16px 18px', transition: 'border-color 150ms ease, box-shadow 150ms ease',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'rgba(90,138,176,0.5)'
                            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'rgba(54,97,132,0.22)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          {/* Top Row: Thumbnail, ID, Title, Status */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                              {p.banner_url ? (
                                <div style={{
                                  width: 68, height: 46, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
                                  border: '1px solid rgba(54,97,132,0.35)', background: 'rgba(3,10,24,0.7)',
                                }}>
                                  <img
                                    src={p.banner_url}
                                    alt=""
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    onError={e => { (e.currentTarget as HTMLElement).style.display = 'none' }}
                                  />
                                </div>
                              ) : (
                                <div style={{
                                  width: 68, height: 46, borderRadius: 8, flexShrink: 0,
                                  border: '1px dashed rgba(54,97,132,0.3)', display: 'flex', alignItems: 'center',
                                  justifyContent: 'center', fontSize: 16, background: 'rgba(3,10,24,0.4)', color: 'var(--text-tertiary)',
                                }}>
                                  🔮
                                </div>
                              )}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'JetBrains Mono, monospace' }}>#{p.id}</span>
                                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 4, background: 'rgba(54,97,132,0.2)', color: 'var(--accent-bright)' }}>
                                    {p.category === 'official_calls' ? 'Official' : 'Community'}
                                  </span>
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35 }}>
                                  {p.title}
                                </div>
                              </div>
                            </div>
                            <StatusBadge status={p.status} isLocked={isLocked} />
                          </div>

                          {/* Meta Row: Pools, Winner, Deadline */}
                          <div style={{
                            display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-secondary)',
                            marginBottom: 12, flexWrap: 'wrap', alignItems: 'center',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}>
                            <span style={{ color: 'var(--yes-color)' }}>YES {Number(p.yes_pool).toFixed(2)} USDC</span>
                            <span style={{ color: 'var(--no-color)' }}>NO {Number(p.no_pool).toFixed(2)} USDC</span>
                            {p.winner && (
                              <span style={{ color: p.winner === 'YES' ? 'var(--yes-color)' : 'var(--no-color)', fontWeight: 700 }}>
                                Winner: {p.winner}
                              </span>
                            )}
                            {p.settled_at && (
                              <span>Settled: {new Date(p.settled_at).toLocaleDateString()}</span>
                            )}
                            <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>
                              {p.no_deadline ? 'Deadline: Real-time' : `Deadline: ${new Date(p.deadline).toLocaleDateString()}`}
                            </span>
                          </div>

                          {/* Action Row */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderTop: '1px solid rgba(54,97,132,0.15)', paddingTop: 12 }}>
                            {predSubTab === 'history' ? (
                              <>
                                <button
                                  onClick={() => {
                                    setBannerModal(p)
                                    setEditBannerUrl(p.banner_url || '')
                                    setEditBannerPreview(p.banner_url || null)
                                    setEditBannerFile(null)
                                  }}
                                  disabled={isBusy}
                                  className="admin-action-btn"
                                  style={{
                                    background: 'rgba(54,97,132,0.18)', border: '1px solid rgba(90,138,176,0.3)',
                                    color: 'var(--accent-bright)', padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                                    cursor: isBusy ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  🖼 Edit Banner
                                </button>
                                <button
                                  onClick={() => setDeleteModal(p)}
                                  disabled={isBusy}
                                  className="admin-action-btn admin-action-danger"
                                >
                                  🗑 Remove from History
                                </button>
                              </>
                            ) : (
                              <>
                                {/* Extend Deadline */}
                                {!p.no_deadline && !isLocked && (
                                  <button
                                    onClick={() => setExtendModal({ pred: p, newDeadline: '' })}
                                    disabled={isBusy}
                                    className="admin-action-btn admin-action-extend"
                                  >
                                    📅 Extend Deadline
                                  </button>
                                )}

                                {/* Lock / Unlock Betting */}
                                {!isLocked ? (
                                  <button
                                    onClick={() => setLockModal(p)}
                                    disabled={isBusy}
                                    className="admin-action-btn admin-action-lock"
                                  >
                                    🔒 Lock Betting
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => doUnlock(p)}
                                    disabled={isBusy}
                                    className="admin-action-btn admin-action-unlock"
                                  >
                                    🔓 Unlock Betting
                                  </button>
                                )}

                                {/* Declare Winner */}
                                <button
                                  onClick={() => setDeclareModal(p)}
                                  disabled={isBusy}
                                  className="admin-action-btn admin-action-yes"
                                >
                                  🏆 Declare Winner
                                </button>

                                {/* Edit Banner */}
                                <button
                                  onClick={() => {
                                    setBannerModal(p)
                                    setEditBannerUrl(p.banner_url || '')
                                    setEditBannerPreview(p.banner_url || null)
                                    setEditBannerFile(null)
                                  }}
                                  disabled={isBusy}
                                  className="admin-action-btn"
                                  style={{
                                    background: 'rgba(54,97,132,0.18)', border: '1px solid rgba(90,138,176,0.3)',
                                    color: 'var(--accent-bright)', padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                                    cursor: isBusy ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  🖼 Edit Banner
                                </button>

                                {/* Refund Market */}
                                <button
                                  onClick={() => setRefundModal(p)}
                                  disabled={isBusy}
                                  className="admin-action-btn admin-action-danger"
                                >
                                  💸 Refund Market
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

              </div>

            </div>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════════ */}
          {/* TAB 2: POLL MANAGEMENT                                                 */}
          {/* ══════════════════════════════════════════════════════════════════════ */}
          {tab === 'polls' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }}>
              <div>
                {/* Sub-tabs: Active Polls vs Round History */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setPollSubTab('active')}
                      style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: pollSubTab === 'active' ? 'rgba(54,97,132,0.35)' : 'rgba(6,24,48,0.5)',
                        border: `1px solid ${pollSubTab === 'active' ? 'rgba(90,138,176,0.6)' : 'rgba(54,97,132,0.2)'}`,
                        color: pollSubTab === 'active' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        cursor: 'pointer', transition: 'all 150ms',
                      }}
                    >
                      Active Polls ({polls.length})
                    </button>
                    <button
                      onClick={() => setPollSubTab('history')}
                      style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: pollSubTab === 'history' ? 'rgba(54,97,132,0.35)' : 'rgba(6,24,48,0.5)',
                        border: `1px solid ${pollSubTab === 'history' ? 'rgba(90,138,176,0.6)' : 'rgba(54,97,132,0.2)'}`,
                        color: pollSubTab === 'history' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        cursor: 'pointer', transition: 'all 150ms',
                      }}
                    >
                      Round History ({pollHistory.length})
                    </button>
                  </div>
                </div>

                {pollSubTab === 'active' ? (
                  polls.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-glass)', borderRadius: 16, border: '1px solid var(--border-subtle)' }}>
                      No active polls
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {polls.map(poll => (
                        <div key={poll.id} style={{
                          background: 'rgba(6,18,38,0.75)', border: '1px solid rgba(54,97,132,0.22)',
                          borderRadius: 14, padding: '16px 18px', display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', gap: 16, transition: 'border-color 150ms ease, box-shadow 150ms ease',
                        }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'rgba(90,138,176,0.5)'
                            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'rgba(54,97,132,0.22)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'JetBrains Mono, monospace' }}>#{poll.id}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{poll.title}</span>
                            </div>
                            {poll.description && (
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>
                                {poll.description.length > 140 ? `${poll.description.slice(0, 140)}…` : poll.description}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                              by <span style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>{poll.created_by_name}</span>
                              <span style={{ marginLeft: 12, color: 'var(--accent-primary)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{poll.vote_count} votes</span>
                              {poll.created_at && (
                                <span style={{ marginLeft: 12, color: 'var(--text-tertiary)' }}>{new Date(poll.created_at).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => setDeletePollModal(poll)}
                            disabled={isBusy}
                            className="admin-action-btn admin-action-danger"
                            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            🗑 Delete Poll
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  pollHistory.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-glass)', borderRadius: 16, border: '1px solid var(--border-subtle)' }}>
                      No past round history
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {pollHistory.map(item => (
                        <div key={item.id} style={{
                          background: 'rgba(6,18,38,0.75)', border: '1px solid rgba(54,97,132,0.22)',
                          borderRadius: 14, padding: '16px 18px', display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', gap: 16, transition: 'border-color 150ms ease, box-shadow 150ms ease',
                        }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'rgba(90,138,176,0.5)'
                            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'rgba(54,97,132,0.22)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: 'rgba(54,97,132,0.2)', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, monospace' }}>
                                Round #{item.round_number}
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.poll_title}</span>
                            </div>
                            {item.description && (
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>
                                {item.description.length > 140 ? `${item.description.slice(0, 140)}…` : item.description}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                              by <span style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>{item.submitted_by_name}</span>
                              <span style={{ marginLeft: 12, color: 'var(--yes-color)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{item.final_vote_count} votes</span>
                              {item.closed_at && (
                                <span style={{ marginLeft: 12, color: 'var(--text-tertiary)' }}>Closed: {new Date(item.closed_at).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => setDeletePollHistoryModal(item)}
                            disabled={isBusy}
                            className="admin-action-btn admin-action-danger"
                            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            🗑 Remove from History
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Close round */}
              <div>
                <div className="admin-section-title">Close Round</div>
                <div className="card" style={{ padding: 22 }}>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.6 }}>
                    Select the 3 winning polls to close the current round and record history.
                  </p>
                  {[['Winner 1', winner1, setWinner1], ['Winner 2', winner2, setWinner2], ['Winner 3', winner3, setWinner3]].map(([label, val, set]) => (
                    <div key={label as string} style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5, display: 'block' }}>{label as string}</label>
                      <select value={val as string} onChange={e => (set as React.Dispatch<React.SetStateAction<string>>)(e.target.value)}>
                        <option value="">Select a poll…</option>
                        {polls.map(p => <option key={p.id} value={String(p.id)}>#{p.id}: {p.title.slice(0, 45)} ({p.vote_count}v)</option>)}
                      </select>
                    </div>
                  ))}
                  <button onClick={handleCloseRound} disabled={closingRound || !winner1 || !winner2 || !winner3}
                    className="btn-primary" style={{ width: '100%', padding: '12px', fontWeight: 700, marginTop: 8 }}>
                    {closingRound ? 'Closing…' : 'Close Round & Record Winners'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════ */}
          {/* TAB 3: RESOLVER                                                         */}
          {/* ══════════════════════════════════════════════════════════════════════ */}
          {tab === 'resolver' && (() => {
            const watchingPreds = openPredsForResolver.filter(p => p.x_monitor !== null)
            const unwatchedPreds = openPredsForResolver.filter(p => p.x_monitor === null)

            const getLatestLog = (predId: number) =>
              resolverLogs.find(l => l.prediction_id === predId) || null

            const nextRunMinutes = () => 60 - new Date().getMinutes()

            const needsThreshold = (c: string) =>
              !['pfp_change', 'new_post', 'verification_change'].includes(c)
            const needsTweetUrl = (c: string) =>
              ['post_views', 'post_likes', 'post_reposts', 'post_replies'].includes(c)

            const autoFill = (pred: DbPrediction) => {
              const handleMatch = pred.title.match(/@([A-Za-z0-9_]+)/)
              const numberMatch = pred.title.match(/\b(\d[\d,]*[kKmM]?)\b/)
              let target: number | '' = ''
              if (numberMatch) {
                const raw = numberMatch[1].replace(/,/g, '')
                if (raw.toLowerCase().endsWith('k'))      target = parseInt(raw) * 1000
                else if (raw.toLowerCase().endsWith('m')) target = parseInt(raw) * 1_000_000
                else                                      target = parseInt(raw)
              }
              return {
                handle: handleMatch ? handleMatch[1] : '',
                condition_type: '',
                threshold: target ? String(target) : '',
                tweet_url: '',
              }
            }

            const extractTweetId = (url: string) => {
              const match = url.match(/status\/(\d+)/)
              return match ? match[1] : url.trim()
            }

            const openResolverConfig = (pred: DbPrediction) => {
              if (resolverExpandedId === pred.id) { setResolverExpandedId(null); return }
              setResolverExpandedId(pred.id)
              setResolverConfigForm(autoFill(pred))
            }

            const handleActivate = async (pred: DbPrediction) => {
              const { handle, condition_type, threshold, tweet_url } = resolverConfigForm
              if (!handle)         { showFailed('X handle required'); return }
              if (!condition_type) { showFailed('Condition required'); return }
              if (needsThreshold(condition_type) && !threshold) { showFailed('Target number required'); return }
              if (needsTweetUrl(condition_type) && !tweet_url)  { showFailed('Tweet URL required'); return }

              const tweetId = tweet_url ? extractTweetId(tweet_url) : null

              const monitor = {
                handle: handle.replace('@', ''),
                condition_type,
                threshold: threshold ? String(threshold) : null,
                tweet_id: tweetId,
                has_deadline: !!pred.deadline,
                activation_timestamp: Math.floor(Date.now() / 1000),
                last_tweet_id: null,
                last_pfp_url: null,
                last_verified: null,
                tracking_tweet_id: null,
              }

              setResolverActivating(pred.id)
              try {
                await supabase.from('predictions_display').update({ x_monitor: monitor }).eq('id', pred.id)
                setResolverExpandedId(null)
                await loadResolverData()
              } catch {
                showFailed('Failed to activate resolver')
              } finally {
                setResolverActivating(null)
              }
            }

            const handleDeactivate = async (pred: DbPrediction) => {
              await supabase.from('predictions_display').update({ x_monitor: null }).eq('id', pred.id)
              await loadResolverData()
            }

            const CONDITION_LABELS: Record<string, string> = {
              new_post: 'New Post', pfp_change: 'Profile Picture Change',
              verification_change: 'Verification Change', follower_count: 'Followers',
              tweet_count: 'Tweet Count', next_tweet_views: 'Next Tweet Views',
              next_tweet_likes: 'Next Tweet Likes', next_tweet_reposts: 'Next Tweet Reposts',
              next_tweet_replies: 'Next Tweet Replies', post_views: 'Specific Post Views',
              post_likes: 'Specific Post Likes', post_reposts: 'Specific Post Reposts',
              post_replies: 'Specific Post Replies',
            }

            const labelSt: React.CSSProperties = {
              color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase' as const,
              letterSpacing: '0.06em', marginBottom: 6, display: 'block',
            }
            const inputSt: React.CSSProperties = {
              width: '100%', background: 'rgba(1,16,41,0.6)',
              border: '1px solid rgba(54,97,132,0.3)',
              borderRadius: 8, padding: '10px 12px',
              color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }

            return (
              <div>
                {/* Status Bar */}
                <div style={{
                  display: 'flex', gap: 24, flexWrap: 'wrap',
                  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                  borderRadius: 12, padding: '16px 20px', marginBottom: 24,
                }}>
                  {[
                    { label: 'Last Ran', value: resolverLastRanAt
                        ? `${Math.round((Date.now() - resolverLastRanAt.getTime()) / 60000)}m ago`
                        : 'Not yet run' },
                    { label: 'Next Run', value: `in ${nextRunMinutes()}m` },
                    { label: 'Watching', value: `${watchingPreds.length} predictions` },
                    { label: 'Total Locked', value: resolverHistoryLogs.length, highlight: true },
                  ].map(stat => (
                    <div key={stat.label}>
                      <div style={labelSt}>{stat.label}</div>
                      <div style={{ color: stat.highlight ? 'var(--accent-bright)' : 'var(--text-primary)', fontSize: 14 }}>
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Sub-tabs */}
                <div style={{
                  display: 'flex', gap: 4, background: 'var(--bg-card)',
                  padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: 24,
                }}>
                  {(['watching', 'history'] as const).map(t => (
                    <button key={t} onClick={() => setResolverSubTab(t)} style={{
                      padding: '8px 20px', borderRadius: 7, border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: 500,
                      background: resolverSubTab === t ? 'rgba(54,97,132,0.25)' : 'transparent',
                      color: resolverSubTab === t ? 'var(--accent-bright)' : 'var(--text-tertiary)',
                      transition: 'all 0.2s',
                    }}>
                      {t === 'watching' ? 'Watching' : 'History'}
                    </button>
                  ))}
                </div>

                {/* ── WATCHING TAB ── */}
                {resolverSubTab === 'watching' && (
                  <div>
                    {watchingPreds.length > 0 && (
                      <div style={{ marginBottom: 32 }}>
                        <div style={{ ...labelSt, marginBottom: 12 }}>Currently Monitoring</div>
                        {watchingPreds.map(pred => {
                          const m = pred.x_monitor as {
                            handle: string; condition_type: string; threshold: string;
                          }
                          const log = getLatestLog(pred.id)
                          const hasThresh = needsThreshold(m.condition_type)
                          const current = log?.current_value || 'Not checked yet'
                          const target = hasThresh && m.threshold ? parseInt(m.threshold) : null
                          const currentNum = log ? parseInt((log.current_value || '').replace(/[^0-9]/g, '')) : 0
                          const pct = hasThresh && target ? Math.min(100, Math.round((currentNum / target) * 100)) : null
                          const condLabel = CONDITION_LABELS[m.condition_type] ?? m.condition_type.replace(/_/g, ' ')

                          return (
                            <div key={pred.id} style={{
                              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                              borderRadius: 12, padding: '16px 20px', marginBottom: 10,
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    color: 'var(--text-primary)', fontSize: 14, fontWeight: 500,
                                    marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>
                                    {pred.title}
                                  </div>
                                  <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: hasThresh ? 10 : 0 }}>
                                    @{m.handle} · {condLabel}
                                    {hasThresh && target ? ` · target: ${target.toLocaleString()}` : ''}
                                  </div>
                                  {hasThresh && target && (
                                    <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{current}</span>
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{pct}%</span>
                                      </div>
                                      <div style={{ background: 'rgba(54,97,132,0.15)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                                        <div style={{
                                          width: `${pct}%`, height: '100%',
                                          background: pct! >= 100 ? 'var(--accent-bright)' : 'rgba(54,97,132,0.7)',
                                          borderRadius: 4, transition: 'width 0.3s',
                                        }} />
                                      </div>
                                    </div>
                                  )}
                                  {!hasThresh && (
                                    <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{current}</div>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                                  {log && (
                                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                                      {Math.round((Date.now() - new Date(log.checked_at).getTime()) / 60000)}m ago
                                    </span>
                                  )}
                                  <div style={{
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: log?.error ? '#F59E0B' : '#4ade80',
                                    boxShadow: `0 0 6px ${log?.error ? '#F59E0B' : '#4ade80'}`,
                                  }} />
                                  <button
                                    onClick={() => handleDeactivate(pred)}
                                    style={{
                                      background: 'transparent',
                                      border: '1px solid rgba(248,113,113,0.3)',
                                      color: '#f87171', borderRadius: 6,
                                      padding: '5px 10px', fontSize: 12, cursor: 'pointer',
                                    }}
                                  >
                                    Deactivate
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Unmonitored open predictions */}
                    <div>
                      <div style={{ ...labelSt, marginBottom: 12 }}>
                        Open Predictions — Click to Add X Monitoring
                      </div>
                      {unwatchedPreds.length === 0 && (
                        <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '20px 0' }}>
                          All open predictions are already being monitored.
                        </div>
                      )}
                      {unwatchedPreds.map(pred => (
                        <div key={pred.id} style={{ marginBottom: 8 }}>
                          <div
                            onClick={() => openResolverConfig(pred)}
                            style={{
                              background: 'var(--bg-card)',
                              border: `1px solid ${resolverExpandedId === pred.id ? 'rgba(54,97,132,0.5)' : 'var(--border-subtle)'}`,
                              borderRadius: resolverExpandedId === pred.id ? '12px 12px 0 0' : 12,
                              padding: '14px 18px', cursor: 'pointer',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              transition: 'border-color 0.2s',
                            }}
                          >
                            <div style={{
                              color: 'var(--text-primary)', fontSize: 14, overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 12,
                            }}>
                              #{pred.id} — {pred.title}
                            </div>
                            <span style={{ color: 'var(--text-tertiary)', fontSize: 18, flexShrink: 0 }}>
                              {resolverExpandedId === pred.id ? '−' : '+'}
                            </span>
                          </div>

                          {resolverExpandedId === pred.id && (
                            <div style={{
                              background: 'rgba(1,16,41,0.6)',
                              border: '1px solid rgba(54,97,132,0.5)',
                              borderTop: 'none', borderRadius: '0 0 12px 12px',
                              padding: 20,
                            }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                <div>
                                  <label style={labelSt}>X Handle</label>
                                  <input
                                    value={resolverConfigForm.handle || ''}
                                    onChange={e => setResolverConfigForm(p => ({ ...p, handle: e.target.value }))}
                                    placeholder="elonmusk (no @)"
                                    style={inputSt}
                                  />
                                </div>
                                <div>
                                  <label style={labelSt}>What to Monitor</label>
                                  <select
                                    value={resolverConfigForm.condition_type || ''}
                                    onChange={e => setResolverConfigForm(p => ({ ...p, condition_type: e.target.value }))}
                                    style={{ ...inputSt, cursor: 'pointer' }}
                                  >
                                    <option value="">— Pick a condition —</option>
                                    <optgroup label="Account">
                                      <option value="new_post">New Post Appeared</option>
                                      <option value="follower_count">Follower Count</option>
                                      <option value="tweet_count">Total Tweet Count</option>
                                      <option value="pfp_change">Profile Picture Changed</option>
                                      <option value="verification_change">Verification Changed</option>
                                    </optgroup>
                                    <optgroup label="Next Tweet (after activation)">
                                      <option value="next_tweet_views">Next Tweet Views</option>
                                      <option value="next_tweet_likes">Next Tweet Likes</option>
                                      <option value="next_tweet_reposts">Next Tweet Reposts</option>
                                      <option value="next_tweet_replies">Next Tweet Replies</option>
                                    </optgroup>
                                    <optgroup label="Specific Tweet (needs URL)">
                                      <option value="post_views">Post Views</option>
                                      <option value="post_likes">Post Likes</option>
                                      <option value="post_reposts">Post Reposts</option>
                                      <option value="post_replies">Post Replies</option>
                                    </optgroup>
                                  </select>
                                </div>
                                {resolverConfigForm.condition_type && needsThreshold(resolverConfigForm.condition_type) && (
                                  <div>
                                    <label style={labelSt}>Target Number</label>
                                    <input
                                      type="number"
                                      value={resolverConfigForm.threshold || ''}
                                      onChange={e => setResolverConfigForm(p => ({ ...p, threshold: e.target.value }))}
                                      placeholder="e.g. 100000"
                                      style={inputSt}
                                    />
                                  </div>
                                )}
                                {resolverConfigForm.condition_type && needsTweetUrl(resolverConfigForm.condition_type) && (
                                  <div>
                                    <label style={labelSt}>Tweet URL</label>
                                    <input
                                      value={resolverConfigForm.tweet_url || ''}
                                      onChange={e => setResolverConfigForm(p => ({ ...p, tweet_url: e.target.value }))}
                                      placeholder="https://x.com/handle/status/..."
                                      style={inputSt}
                                    />
                                  </div>
                                )}
                              </div>
                              <div style={{
                                marginBottom: 16, padding: '10px 14px',
                                background: 'rgba(54,97,132,0.06)', border: '1px solid var(--border-subtle)', borderRadius: 8,
                              }}>
                                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Timeline: </span>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                                  {pred.deadline
                                    ? `Monitors until ${new Date(pred.deadline).toLocaleDateString()}`
                                    : 'No deadline — monitors until condition is met'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: 10 }}>
                                <button
                                  onClick={() => handleActivate(pred)}
                                  disabled={resolverActivating === pred.id}
                                  style={{
                                    flex: 1, background: 'rgba(54,97,132,0.25)',
                                    color: 'var(--accent-bright)',
                                    border: '1px solid rgba(54,97,132,0.5)',
                                    borderRadius: 8, padding: 11,
                                    fontSize: 14, fontWeight: 600,
                                    cursor: resolverActivating === pred.id ? 'not-allowed' : 'pointer',
                                    opacity: resolverActivating === pred.id ? 0.7 : 1,
                                  }}
                                >
                                  {resolverActivating === pred.id ? 'Activating...' : 'Activate Resolver ✅'}
                                </button>
                                <button
                                  onClick={() => setResolverExpandedId(null)}
                                  style={{
                                    background: 'transparent', border: '1px solid var(--border-subtle)',
                                    color: 'var(--text-secondary)', borderRadius: 8,
                                    padding: '11px 20px', fontSize: 14, cursor: 'pointer',
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── HISTORY TAB ── */}
                {resolverSubTab === 'history' && (
                  <div>
                    <div style={{ ...labelSt, marginBottom: 16 }}>Predictions Locked by Resolver</div>
                    {resolverHistoryLogs.length === 0 && (
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
                        <div style={{ fontSize: 28, marginBottom: 10 }}>🔒</div>
                        Resolver hasn't locked any predictions yet.
                      </div>
                    )}
                    {resolverHistoryLogs.map((log, i) => (
                      <div key={i} style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                        borderRadius: 10, padding: '14px 18px', marginBottom: 8,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            color: 'var(--text-primary)', fontSize: 14, marginBottom: 4,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            #{log.prediction_id} — {log.prediction_title || 'Prediction'}
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                            @{log.handle} · {log.condition_type?.replace(/_/g, ' ')} · {log.current_value}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ color: 'var(--accent-bright)', fontSize: 12, marginBottom: 2 }}>🔒 Locked</div>
                          <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                            {new Date(log.checked_at).toLocaleDateString()}{' '}
                            {new Date(log.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

        </div>
      </main>

      <Footer />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MODALS                                                                 */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      {/* 1. Declare Winner Modal */}
      {declareModal && (
        <AdminModal
          title={`🏆 Declare Winner — #${declareModal.id}`}
          onClose={() => setDeclareModal(null)}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.4 }}>
            {declareModal.title}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
            Select the winning outcome. This will settle the prediction on Arc Mainnet, calculate winnings, and distribute payouts to bettors.
            <strong style={{ display: 'block', marginTop: 6, color: 'var(--pending)' }}>
              ⚠️ This action is permanent and cannot be reversed.
            </strong>
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <button
              onClick={() => doDeclare(declareModal, 'YES')}
              disabled={isBusy}
              style={{
                flex: 1, padding: '14px', borderRadius: 10, fontSize: 14, fontWeight: 700,
                background: 'rgba(74,222,128,0.15)', color: 'var(--yes-color)',
                border: '1px solid rgba(74,222,128,0.4)', cursor: isBusy ? 'not-allowed' : 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              ✓ YES Wins
            </button>
            <button
              onClick={() => doDeclare(declareModal, 'NO')}
              disabled={isBusy}
              style={{
                flex: 1, padding: '14px', borderRadius: 10, fontSize: 14, fontWeight: 700,
                background: 'rgba(248,113,113,0.15)', color: 'var(--no-color)',
                border: '1px solid rgba(248,113,113,0.4)', cursor: isBusy ? 'not-allowed' : 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              ✗ NO Wins
            </button>
          </div>
          <button
            onClick={() => setDeclareModal(null)}
            style={{
              width: '100%', padding: '10px', background: 'transparent',
              border: '1px solid rgba(54,97,132,0.25)', borderRadius: 8,
              color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </AdminModal>
      )}

      {/* 2. Lock Betting Modal */}
      {lockModal && (
        <AdminModal
          title={`🔒 Lock Betting — #${lockModal.id}`}
          onClose={() => setLockModal(null)}
        >
          <div style={{
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 10, padding: 14, fontSize: 13, color: 'var(--pending)', marginBottom: 18, lineHeight: 1.5,
          }}>
            ⚠️ Are you sure you want to lock betting? No further calls will be accepted on-chain. You can unlock it later if needed.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => doLock(lockModal)}
              disabled={isBusy}
              style={{
                flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'rgba(251,191,36,0.2)', color: 'var(--pending)', border: '1px solid rgba(251,191,36,0.4)',
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Confirm Lock
            </button>
            <button
              onClick={() => setLockModal(null)}
              style={{
                padding: '11px 20px', borderRadius: 8, fontSize: 13,
                background: 'transparent', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </AdminModal>
      )}

      {/* 3. Extend Deadline Modal */}
      {extendModal && (
        <AdminModal
          title={`📅 Extend Deadline — #${extendModal.pred.id}`}
          onClose={() => setExtendModal(null)}
        >
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Choose a new future deadline. It must be further in the future than the existing deadline.
          </p>
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6, display: 'block' }}>
              New Deadline (Local Time)
            </label>
            <input
              type="datetime-local"
              min={minDatetime}
              value={extendModal.newDeadline}
              onChange={e => setExtendModal({ ...extendModal, newDeadline: e.target.value })}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                background: 'rgba(3,10,24,0.7)', border: '1px solid rgba(54,97,132,0.35)',
                color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => doExtend(extendModal.pred, extendModal.newDeadline)}
              disabled={!extendModal.newDeadline || isBusy}
              style={{
                flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'var(--accent-bright)', color: '#030a18', border: 'none',
                cursor: !extendModal.newDeadline || isBusy ? 'not-allowed' : 'pointer',
                opacity: !extendModal.newDeadline || isBusy ? 0.5 : 1,
              }}
            >
              Extend Deadline
            </button>
            <button
              onClick={() => setExtendModal(null)}
              style={{
                padding: '11px 20px', borderRadius: 8, fontSize: 13,
                background: 'transparent', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </AdminModal>
      )}

      {/* 4. Refund Market Modal */}
      {refundModal && (
        <AdminModal
          title={`💸 Refund Market — #${refundModal.id}`}
          onClose={() => setRefundModal(null)}
        >
          <div style={{
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 10, padding: 14, fontSize: 13, color: 'var(--text-primary)', marginBottom: 18, lineHeight: 1.5,
          }}>
            ⚠️ This marks the market as <strong>REFUNDED</strong> on-chain. Both YES and NO bettors can claim their full original stake back. This cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => doRefund(refundModal)}
              disabled={isBusy}
              style={{
                flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.4)',
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Yes, Refund Market
            </button>
            <button
              onClick={() => setRefundModal(null)}
              style={{
                padding: '11px 20px', borderRadius: 8, fontSize: 13,
                background: 'transparent', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </AdminModal>
      )}

      {/* 4b. Remove from History Modal */}
      {deleteModal && (
        <AdminModal
          title={`🗑 Remove from History — #${deleteModal.id}`}
          onClose={() => setDeleteModal(null)}
        >
          <div style={{
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
            borderRadius: 10, padding: 14, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.5,
          }}>
            This hides the market from the website history. The on-chain record is permanent — bettors can always claim winnings or refunds via the blockchain.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => doDelete(deleteModal)}
              disabled={isBusy}
              style={{
                flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'rgba(239,68,68,0.2)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.4)',
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Yes, Remove from History
            </button>
            <button
              onClick={() => setDeleteModal(null)}
              style={{
                padding: '11px 20px', borderRadius: 8, fontSize: 13,
                background: 'transparent', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </AdminModal>
      )}

{/* 6. Delete Poll Modal */}
      {deletePollModal && (
        <AdminModal
          title={`🗑 Delete Poll — #${deletePollModal.id}`}
          onClose={() => setDeletePollModal(null)}
        >
          <div style={{
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
            borderRadius: 10, padding: 14, fontSize: 13, color: 'var(--no-color)', marginBottom: 16, lineHeight: 1.5,
          }}>
            ⚠️ Are you sure you want to permanently delete this poll from the website?
            This will immediately remove it from active polls and clear all recorded votes.
          </div>
          <div style={{
            fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18,
            background: 'rgba(6,24,48,0.5)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12,
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {deletePollModal.title}
            </div>
            <div>
              Submitted by: <span style={{ color: 'var(--accent-bright)' }}>{deletePollModal.created_by_name}</span> · {deletePollModal.vote_count} votes
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => doDeletePoll(deletePollModal)}
              disabled={isBusy}
              style={{
                flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'rgba(239,68,68,0.2)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.4)',
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Yes, Permanently Delete
            </button>
            <button
              onClick={() => setDeletePollModal(null)}
              style={{
                padding: '11px 20px', borderRadius: 8, fontSize: 13,
                background: 'transparent', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </AdminModal>
      )}

      {/* 7. Remove Poll History Modal */}
      {deletePollHistoryModal && (
        <AdminModal
          title={`🗑 Remove from History — Round #${deletePollHistoryModal.round_number}`}
          onClose={() => setDeletePollHistoryModal(null)}
        >
          <div style={{
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
            borderRadius: 10, padding: 14, fontSize: 13, color: 'var(--no-color)', marginBottom: 16, lineHeight: 1.5,
          }}>
            ⚠️ Are you sure you want to permanently remove this poll from past round history?
          </div>
          <div style={{
            fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18,
            background: 'rgba(6,24,48,0.5)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12,
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {deletePollHistoryModal.poll_title}
            </div>
            <div>
              Round {deletePollHistoryModal.round_number} · Winner with {deletePollHistoryModal.final_vote_count} votes
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => doDeletePollHistory(deletePollHistoryModal)}
              disabled={isBusy}
              style={{
                flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'rgba(239,68,68,0.2)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.4)',
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Yes, Remove from History
            </button>
            <button
              onClick={() => setDeletePollHistoryModal(null)}
              style={{
                padding: '11px 20px', borderRadius: 8, fontSize: 13,
                background: 'transparent', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </AdminModal>
      )}

      {/* 5. Update Banner Modal */}
      {bannerModal && (
        <AdminModal
          title={`🖼 Update Banner — #${bannerModal.id}`}
          onClose={() => {
            if (editBannerPreview && editBannerPreview.startsWith('blob:')) URL.revokeObjectURL(editBannerPreview)
            setBannerModal(null)
            setEditBannerFile(null)
            setEditBannerPreview(null)
            setEditBannerUrl('')
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
            {bannerModal.title}
          </div>

          {/* Current / New Preview */}
          <div style={{
            width: '100%', height: 160, borderRadius: 10, overflow: 'hidden',
            border: '1px solid rgba(54,97,132,0.3)', marginBottom: 14, background: 'rgba(3,10,24,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
          }}>
            {editBannerPreview || editBannerUrl ? (
              <img
                src={editBannerPreview || editBannerUrl}
                alt="Banner preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.currentTarget as HTMLElement).style.display = 'none' }}
              />
            ) : (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
                <span style={{ fontSize: 24, display: 'block', marginBottom: 4 }}>🖼️</span>
                No banner set (default gradient will be used)
              </div>
            )}
          </div>

          {/* Upload File Input */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Upload Image (Best: 2:1 ratio · Max 5MB)
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                if (file.size > 5 * 1024 * 1024) {
                  showFailed('File exceeds 5MB limit')
                  return
                }
                setEditBannerFile(file)
                setEditBannerPreview(prev => {
                  if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
                  return URL.createObjectURL(file)
                })
              }}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8,
                background: 'rgba(3,10,24,0.7)', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-primary)', fontSize: 12,
              }}
            />
          </div>

          {/* Or Direct URL Input */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Or Image URL
            </label>
            <input
              type="text"
              placeholder="https://..."
              value={editBannerUrl}
              onChange={e => {
                setEditBannerUrl(e.target.value)
                if (!editBannerFile) setEditBannerPreview(e.target.value)
              }}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                background: 'rgba(3,10,24,0.7)', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => handleUpdateBanner(bannerModal)}
              disabled={savingBanner}
              style={{
                flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)', color: '#fff', border: 'none',
                cursor: savingBanner ? 'not-allowed' : 'pointer',
              }}
            >
              {savingBanner ? 'Saving...' : '💾 Save Banner'}
            </button>
            {(editBannerPreview || editBannerUrl || bannerModal.banner_url) && (
              <button
                onClick={() => handleRemoveBanner(bannerModal)}
                disabled={savingBanner}
                style={{
                  padding: '11px 14px', borderRadius: 8, fontSize: 13,
                  background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                  color: 'var(--no-color)', cursor: savingBanner ? 'not-allowed' : 'pointer',
                }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => {
                if (editBannerPreview && editBannerPreview.startsWith('blob:')) URL.revokeObjectURL(editBannerPreview)
                setBannerModal(null)
                setEditBannerFile(null)
                setEditBannerPreview(null)
                setEditBannerUrl('')
              }}
              style={{
                padding: '11px 20px', borderRadius: 8, fontSize: 13,
                background: 'transparent', border: '1px solid rgba(54,97,132,0.3)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </AdminModal>
      )}

      <style>{`
        @keyframes adminModalIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

    </div>
  )
}
