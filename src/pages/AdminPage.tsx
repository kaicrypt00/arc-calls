import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useNavigate } from 'react-router-dom'
import { useSessionWallet, getMaxFeePerGas, publicClient, writeContract } from '../contexts/SessionWalletContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, type DbPrediction, type DbTemplate, type DbPoll, type DbXMonitorLog } from '../lib/supabase'
import { BETTING_POOL_ADDRESS, POLL_REGISTRY_ADDRESS, ADMIN_WALLETS } from '../constants'
import { BETTING_POOL_ABI, POLL_REGISTRY_ABI } from '../abis'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

type AdminTab = 'predictions' | 'polls' | 'resolver'

const CONDITION_TYPES = [
  'follower_count','tweet_count','new_post','pfp_change','verification_change',
  'next_tweet_views','next_tweet_likes','next_tweet_reposts','next_tweet_replies',
  'post_views','post_likes','post_reposts','post_replies',
]

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  open:     { bg: 'rgba(74,222,128,0.1)',  color: '#4ade80', border: 'rgba(74,222,128,0.3)'  },
  locked:   { bg: 'rgba(251,191,36,0.1)',  color: '#fbbf24', border: 'rgba(251,191,36,0.3)'  },
  yes_wins: { bg: 'rgba(74,222,128,0.1)',  color: '#4ade80', border: 'rgba(74,222,128,0.3)'  },
  no_wins:  { bg: 'rgba(248,113,113,0.1)', color: '#f87171', border: 'rgba(248,113,113,0.3)' },
  refunded: { bg: 'rgba(142,159,176,0.1)', color: '#8e9fb0', border: 'rgba(142,159,176,0.3)' },
  deleted:  { bg: 'rgba(100,100,100,0.1)', color: '#666',    border: 'rgba(100,100,100,0.3)' },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.deleted
  return (
    <span style={{
      padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.5px', textTransform: 'uppercase', flexShrink: 0,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>{status.replace('_', ' ')}</span>
  )
}

export default function AdminPage() {
  const { address } = useAccount()
  const navigate = useNavigate()
  const { sessionWallet } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()

  const isAdmin = address ? ADMIN_WALLETS.includes(address.toLowerCase() as typeof ADMIN_WALLETS[number]) : false
  useEffect(() => { if (!isAdmin) navigate('/') }, [isAdmin, navigate])

  const [tab, setTab] = useState<AdminTab>('predictions')
  const [predictions, setPredictions] = useState<DbPrediction[]>([])
  const [templates, setTemplates]     = useState<DbTemplate[]>([])
  const [polls, setPolls]             = useState<DbPoll[]>([])
  const [resolverLogs, setResolverLogs] = useState<DbXMonitorLog[]>([])
  const [loading, setLoading] = useState(false)

  // Create form
  const [cTitle, setCTitle]         = useState('')
  const [cDesc, setCDesc]           = useState('')
  const [cBanner, setCBanner]       = useState('')
  const [cBannerFile, setCBannerFile] = useState<File | null>(null)
  const [cDeadline, setCDeadline]   = useState('')
  const [cNoDeadline, setCNoDeadline] = useState(false)
  const [cCategory, setCCategory]   = useState<'community_calls'|'official_calls'>('community_calls')
  const [cXMonitor, setCXMonitor]   = useState(false)
  const [cHandle, setCHandle]       = useState('')
  const [cCondition, setCCondition] = useState('follower_count')
  const [cThreshold, setCThreshold] = useState('')
  const [cTweetUrl, setCTweetUrl]   = useState('')
  const [creating, setCreating]     = useState(false)

  // Extend
  const [extendId, setExtendId]     = useState<number | null>(null)
  const [extendDate, setExtendDate] = useState('')

  // Close round
  const [winner1, setWinner1]       = useState('')
  const [winner2, setWinner2]       = useState('')
  const [winner3, setWinner3]       = useState('')
  const [closingRound, setClosingRound] = useState(false)

  const fetchAll = async () => {
    setLoading(true)
    const [{ data: preds }, { data: tmpl }, { data: p }, { data: logs }] = await Promise.all([
      supabase.from('predictions_display').select('*').order('id', { ascending: false }),
      supabase.from('templates').select('*').order('created_at', { ascending: false }),
      supabase.from('polls').select('*').eq('status', 'active').order('vote_count', { ascending: false }),
      supabase.from('x_monitor_logs').select('*').order('checked_at', { ascending: false }).limit(50),
    ])
    if (preds) setPredictions(preds as DbPrediction[])
    if (tmpl)  setTemplates(tmpl as DbTemplate[])
    if (p)     setPolls(p as DbPoll[])
    if (logs)  setResolverLogs(logs as DbXMonitorLog[])
    setLoading(false)
  }

  useEffect(() => { if (isAdmin) fetchAll() }, [isAdmin])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    setCreating(true); showPending('Creating prediction...')
    try {
      let bannerUrl = cBanner
      if (cBannerFile) {
        const ext = cBannerFile.name.split('.').pop()
        const path = `banners/${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('banners').upload(path, cBannerFile, { upsert: true })
        if (!error) { const { data: u } = supabase.storage.from('banners').getPublicUrl(path); bannerUrl = u.publicUrl }
      }
      const deadlineTs = cNoDeadline
        ? Math.floor(new Date('2099-01-01').getTime() / 1000)
        : Math.floor(new Date(cDeadline).getTime() / 1000)
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: BETTING_POOL_ADDRESS, abi: BETTING_POOL_ABI as never,
        functionName: 'createPrediction',
        args: [cTitle.slice(0, 120), cDesc, bannerUrl, BigInt(deadlineTs)],
        maxFeePerGas,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Prediction created!')
      let predId = predictions.length + 1
      try { const log = receipt.logs[0]; if (log?.topics[1]) predId = Number(BigInt(log.topics[1])) } catch { /* fallback */ }
      const xMonitorData = cXMonitor ? {
        handle: cHandle.replace('@', ''), condition_type: cCondition,
        threshold: cThreshold || null, tweet_id: null, last_tweet_id: null,
        last_pfp_url: null, last_verified: null,
        activation_timestamp: Math.floor(Date.now() / 1000), tracking_tweet_id: null,
      } : null
      await supabase.from('predictions_display').insert({
        id: predId, title: cTitle, description: cDesc,
        banner_url: bannerUrl || null,
        deadline: cNoDeadline ? '2099-01-01T00:00:00Z' : new Date(cDeadline).toISOString(),
        no_deadline: cNoDeadline, status: 'open', yes_pool: 0, no_pool: 0,
        category: cCategory, winner: null, settled_at: null,
        x_monitor: xMonitorData, created_at: new Date().toISOString(),
      })
      setCTitle(''); setCDesc(''); setCBanner(''); setCBannerFile(null)
      setCDeadline(''); setCNoDeadline(false); setCXMonitor(false)
      setCHandle(''); setCCondition('follower_count'); setCThreshold(''); setCTweetUrl('')
      await fetchAll()
    } catch (e) { showFailed((e as Error).message?.slice(0, 100) ?? 'Create failed') }
    finally { setCreating(false) }
  }

  const adminAction = async (fn: string, args: unknown[], label: string) => {
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    showPending(`${label}...`)
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: BETTING_POOL_ADDRESS, abi: BETTING_POOL_ABI as never,
        functionName: fn, args, maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, `${label} done!`)
      const statusMap: Record<string, string> = {
        lockBetting: 'locked', unlockBetting: 'open',
        refundPrediction: 'refunded', deletePrediction: 'deleted',
      }
      if (statusMap[fn]) {
        const id = args[0] as bigint
        await supabase.from('predictions_display').update({ status: statusMap[fn] }).eq('id', Number(id))
      }
      await fetchAll()
    } catch (e) { showFailed((e as Error).message?.slice(0, 80) ?? `${label} failed`) }
  }

  const handleDeclare = async (id: number, side: 'YES' | 'NO') => {
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    showPending(`Declaring ${side} wins...`)
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: BETTING_POOL_ADDRESS, abi: BETTING_POOL_ABI as never,
        functionName: 'declareWinner', args: [BigInt(id), side === 'YES' ? 1n : 2n], maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, `${side} wins declared!`)
      await supabase.from('predictions_display').update({
        status: side === 'YES' ? 'yes_wins' : 'no_wins',
        winner: side, settled_at: new Date().toISOString(),
      }).eq('id', id)
      await fetchAll()
    } catch (e) { showFailed((e as Error).message?.slice(0, 80) ?? 'Declare failed') }
  }

  const handleExtend = async (id: number) => {
    if (!extendDate) return
    const ts = BigInt(Math.floor(new Date(extendDate).getTime() / 1000))
    await adminAction('extendDeadline', [BigInt(id), ts], 'Extend deadline')
    await supabase.from('predictions_display').update({ deadline: new Date(extendDate).toISOString() }).eq('id', id)
    setExtendId(null); setExtendDate('')
  }

  const handleCloseRound = async () => {
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    if (!winner1 || !winner2 || !winner3) { showFailed('Select 3 winners'); return }
    setClosingRound(true); showPending('Closing round...')
    try {
      const ids = [BigInt(winner1), BigInt(winner2), BigInt(winner3)] as [bigint, bigint, bigint]
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: POLL_REGISTRY_ADDRESS, abi: POLL_REGISTRY_ABI as never,
        functionName: 'closeRound', args: [ids], maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Round closed!')
      const roundRes = await publicClient.readContract({ address: POLL_REGISTRY_ADDRESS, abi: POLL_REGISTRY_ABI, functionName: 'currentRound' })
      const round = Number(roundRes) - 1
      for (const id of [winner1, winner2, winner3]) {
        const poll = polls.find(p => p.id === Number(id))
        if (!poll) continue
        await supabase.from('poll_history').insert({
          round_number: round, poll_id: Number(id), poll_title: poll.title,
          description: poll.description, submitted_by_name: poll.created_by_name,
          final_vote_count: poll.vote_count, closed_at: new Date().toISOString(),
        })
      }
      setWinner1(''); setWinner2(''); setWinner3('')
      await fetchAll()
    } catch (e) { showFailed((e as Error).message?.slice(0, 80) ?? 'Close round failed') }
    finally { setClosingRound(false) }
  }

  const handleDeletePoll = async (pollId: number) => {
    if (!sessionWallet) return
    showPending('Deleting poll...')
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: POLL_REGISTRY_ADDRESS, abi: POLL_REGISTRY_ABI as never,
        functionName: 'deletePoll', args: [BigInt(pollId)], maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Poll deleted!')
      await supabase.from('polls').update({ status: 'deleted' }).eq('id', pollId)
      await fetchAll()
    } catch (e) { showFailed((e as Error).message?.slice(0, 80) ?? 'Delete poll failed') }
  }

  if (!isAdmin) return null

  const openPreds    = predictions.filter(p => p.status === 'open')
  const lockedPreds  = predictions.filter(p => p.status === 'locked')
  const settledPreds = predictions.filter(p => ['yes_wins','no_wins','refunded'].includes(p.status))

  return (
    <div className="page" style={{ position: 'relative', zIndex: 1 }}>
      <Navbar />
      <div className="container" style={{ padding: '32px 20px', maxWidth: 1280 }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '2px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>Arc Calls</div>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px', lineHeight: 1 }}>Admin Panel</h1>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { label: 'Open', value: openPreds.length, color: 'var(--yes-color)' },
              { label: 'Locked', value: lockedPreds.length, color: 'var(--pending)' },
              { label: 'Settled', value: settledPreds.length, color: 'var(--text-secondary)' },
            ].map(s => (
              <div key={s.label} style={{ padding: '8px 16px', background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 10, textAlign: 'center' }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="tab-bar" style={{ marginBottom: 28 }}>
          {([['predictions','Predictions'],['polls','Poll Management'],['resolver','X Resolver']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className={`tab-btn${tab === t ? ' active' : ''}`}>{label}</button>
          ))}
        </div>

        {/* ── Predictions Tab ── */}
        {tab === 'predictions' && (
          <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, alignItems: 'start' }}>

            {/* Left — Create form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Templates */}
              {templates.length > 0 && (
                <div className="card" style={{ padding: 16 }}>
                  <div className="admin-section-title">Templates</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {templates.map(t => (
                      <button key={t.id} onClick={() => { setCTitle(t.title); setCDesc(t.description) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: 12, transition: 'border-color 150ms, background 150ms', cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(54,97,132,0.2)'; e.currentTarget.style.borderColor = 'var(--border-default)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-glass)'; e.currentTarget.style.borderColor = 'var(--border-subtle)' }}>
                        {t.title.slice(0, 65)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="card" style={{ padding: 22 }}>
                <div className="admin-section-title">Create Prediction</div>
                <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Title *</span><span style={{ color: 'var(--text-tertiary)' }}>{cTitle.length}/120</span>
                    </label>
                    <input value={cTitle} onChange={e => setCTitle(e.target.value.slice(0, 120))} placeholder="Will BTC hit $100k this year?" maxLength={120} required />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5, display: 'block' }}>Description *</label>
                    <textarea value={cDesc} onChange={e => setCDesc(e.target.value)} placeholder="Describe what YES and NO mean…" rows={3} required style={{ resize: 'none' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5, display: 'block' }}>Banner image</label>
                    <input value={cBanner} onChange={e => setCBanner(e.target.value)} placeholder="https://…" style={{ marginBottom: 6 }} />
                    <input type="file" accept="image/*" onChange={e => setCBannerFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5, display: 'block' }}>Category</label>
                    <select value={cCategory} onChange={e => setCCategory(e.target.value as 'community_calls'|'official_calls')}>
                      <option value="community_calls">Community Calls</option>
                      <option value="official_calls">Official Calls</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
                      <input type="checkbox" checked={cNoDeadline} onChange={e => setCNoDeadline(e.target.checked)} style={{ width: 'auto' }} />
                      No deadline (open-ended)
                    </label>
                    {!cNoDeadline && <input type="datetime-local" value={cDeadline} onChange={e => setCDeadline(e.target.value)} required={!cNoDeadline} />}
                  </div>
                  <div style={{ padding: 12, background: 'var(--bg-glass)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: cXMonitor ? 12 : 0 }}>
                      <input type="checkbox" checked={cXMonitor} onChange={e => setCXMonitor(e.target.checked)} style={{ width: 'auto' }} />
                      <span style={{ fontWeight: 600 }}>X Monitor</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>— auto-lock on trigger</span>
                    </label>
                    {cXMonitor && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input value={cHandle} onChange={e => setCHandle(e.target.value)} placeholder="@handle" />
                        <select value={cCondition} onChange={e => setCCondition(e.target.value)}>
                          {CONDITION_TYPES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                        </select>
                        <input value={cThreshold} onChange={e => setCThreshold(e.target.value)} placeholder="Threshold (for count conditions)" />
                        <input value={cTweetUrl} onChange={e => setCTweetUrl(e.target.value)} placeholder="Tweet URL (for post_ conditions)" />
                      </div>
                    )}
                  </div>
                  <button type="submit" disabled={creating} className="btn-primary" style={{ padding: '12px', fontWeight: 700, background: 'var(--accent-blue)', marginTop: 4 }}>
                    {creating ? '⏳ Creating…' : 'Create Prediction'}
                  </button>
                </form>
              </div>
            </div>

            {/* Right — Manage list */}
            <div>
              <div className="admin-section-title">
                Manage Predictions
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                  {predictions.length} total
                </span>
              </div>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 12 }} />)}
                </div>
              ) : predictions.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-glass)', borderRadius: 16, border: '1px solid var(--border-subtle)' }}>
                  No predictions yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {predictions.map(p => (
                    <div key={p.id} style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                      borderRadius: 12, padding: '14px 16px',
                      transition: 'border-color 200ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'JetBrains Mono, monospace', marginRight: 6 }}>#{p.id}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.title.slice(0, 60)}{p.title.length > 60 ? '…' : ''}</span>
                        </div>
                        <StatusBadge status={p.status} />
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, fontFamily: 'JetBrains Mono, monospace' }}>
                        <span style={{ color: 'var(--yes-color)' }}>YES {Number(p.yes_pool).toFixed(2)}</span>
                        <span style={{ color: 'var(--no-color)' }}>NO {Number(p.no_pool).toFixed(2)}</span>
                        <span style={{ marginLeft: 'auto' }}>
                          {p.no_deadline ? 'No deadline' : new Date(p.deadline).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {p.status === 'open'   && <button onClick={() => adminAction('lockBetting',   [BigInt(p.id)], 'Lock')}   className="admin-action-btn admin-action-lock">Lock</button>}
                        {p.status === 'locked' && <button onClick={() => adminAction('unlockBetting', [BigInt(p.id)], 'Unlock')} className="admin-action-btn admin-action-unlock">Unlock</button>}
                        {(p.status === 'open' || p.status === 'locked') && <>
                          <button onClick={() => handleDeclare(p.id, 'YES')} className="admin-action-btn admin-action-yes">YES Wins</button>
                          <button onClick={() => handleDeclare(p.id, 'NO')}  className="admin-action-btn admin-action-no">NO Wins</button>
                          <button onClick={() => adminAction('refundPrediction',  [BigInt(p.id)], 'Refund')} className="admin-action-btn admin-action-danger">Refund</button>
                          <button onClick={() => adminAction('deletePrediction',  [BigInt(p.id)], 'Delete')} className="admin-action-btn admin-action-danger">Delete</button>
                        </>}
                        {(p.status === 'open' || p.status === 'locked') && (
                          extendId === p.id ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '1 0 100%', marginTop: 4 }}>
                              <input type="datetime-local" value={extendDate} onChange={e => setExtendDate(e.target.value)} style={{ flex: 1, fontSize: 11, padding: '5px 8px' }} />
                              <button onClick={() => handleExtend(p.id)} className="admin-action-btn admin-action-extend">Set</button>
                              <button onClick={() => setExtendId(null)} style={{ background: 'none', color: 'var(--text-tertiary)', fontSize: 13, padding: '0 6px', border: 'none', cursor: 'pointer' }}>✕</button>
                            </div>
                          ) : (
                            <button onClick={() => setExtendId(p.id)} className="admin-action-btn admin-action-extend">Extend</button>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Poll Management Tab ── */}
        {tab === 'polls' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }}>
            {/* Active polls */}
            <div>
              <div className="admin-section-title">Active Polls <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>{polls.length} active</span></div>
              {polls.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-glass)', borderRadius: 16, border: '1px solid var(--border-subtle)' }}>
                  No active polls
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {polls.map(poll => (
                    <div key={poll.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, transition: 'border-color 200ms' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'JetBrains Mono, monospace' }}>#{poll.id}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{poll.title}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          by <span style={{ color: 'var(--accent-bright)' }}>{poll.created_by_name}</span>
                          <span style={{ marginLeft: 12, color: 'var(--text-tertiary)', fontFamily: 'JetBrains Mono, monospace' }}>{poll.vote_count} votes</span>
                        </div>
                      </div>
                      <button onClick={() => handleDeletePoll(poll.id)} className="admin-action-btn admin-action-danger">Delete</button>
                    </div>
                  ))}
                </div>
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

        {/* ── Resolver Tab ── */}
        {tab === 'resolver' && (
          <div>
            <div className="admin-section-title">X Resolver Logs</div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 16, overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '56px 1fr 130px 130px 80px 70px 110px',
                padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)',
                fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.8px', background: 'rgba(1,16,41,0.4)',
              }}>
                <span>ID</span><span>Market</span><span>Handle</span><span>Condition</span>
                <span style={{ textAlign: 'right' }}>Value</span>
                <span style={{ textAlign: 'center' }}>Triggered</span>
                <span style={{ textAlign: 'right' }}>Checked At</span>
              </div>
              {resolverLogs.length === 0 ? (
                <div style={{ padding: 56, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>🔍</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>No resolver logs yet</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Logs appear once the X resolver workflow runs</div>
                </div>
              ) : resolverLogs.map((log, i) => (
                <div key={log.id} style={{
                  display: 'grid', gridTemplateColumns: '56px 1fr 130px 130px 80px 70px 110px',
                  padding: '11px 18px', borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 12, alignItems: 'center',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(6,42,81,0.15)',
                  transition: 'background 150ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(54,97,132,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(6,42,81,0.15)')}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>#{log.prediction_id}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12, fontSize: 12, color: 'var(--text-primary)' }}>{log.condition_type}</span>
                  <span style={{ fontSize: 11, color: 'var(--accent-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{log.handle}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.condition_type.replace(/_/g, ' ')}</span>
                  <span className="mono" style={{ fontSize: 11, textAlign: 'right' }}>{log.current_value ?? '—'}</span>
                  <span style={{ textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                      background: log.triggered ? 'rgba(74,222,128,0.1)' : 'rgba(142,159,176,0.1)',
                      color: log.triggered ? 'var(--yes-color)' : 'var(--text-tertiary)',
                      border: `1px solid ${log.triggered ? 'rgba(74,222,128,0.3)' : 'rgba(142,159,176,0.2)'}`,
                    }}>{log.triggered ? 'YES' : 'NO'}</span>
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                    {new Date(log.checked_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
      <Footer />
    </div>
  )
}
