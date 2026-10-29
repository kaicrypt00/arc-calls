import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useSessionWallet, getMaxFeePerGas, publicClient, writeContract } from '../contexts/SessionWalletContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, type DbPoll, type DbPollHistory } from '../lib/supabase'
import { POLL_REGISTRY_ADDRESS } from '../constants'
import { POLL_REGISTRY_ABI } from '../abis'
import { timeAgo, shortAddress } from '../utils/format'

type PollSubTab = 'live' | 'submit' | 'history'

interface RankConfig {
  color: string
  bg: string
  border: string
  cardBg: string
  cardBorder: string
  cardHoverBorder: string
  shadow: string
  barGradient: string
}

const RANK_STYLE: RankConfig[] = [
  {
    // Rank 1: Enhanced Arc Navy Azure (The Apex Winner)
    color: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.12)',
    border: 'rgba(56, 189, 248, 0.45)',
    cardBg: 'linear-gradient(135deg, rgba(6, 42, 81, 0.85) 0%, rgba(6, 26, 50, 0.7) 60%)',
    cardBorder: 'rgba(56, 189, 248, 0.40)',
    cardHoverBorder: 'rgba(56, 189, 248, 0.65)',
    shadow: '0 4px 22px rgba(0, 0, 0, 0.4), 0 0 20px rgba(56, 189, 248, 0.14)',
    barGradient: 'linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)',
  },
  {
    // Rank 2: Arc Celestial Ice Blue / Steel Sapphire
    color: '#7dd3fc',
    bg: 'rgba(125, 211, 252, 0.08)',
    border: 'rgba(125, 211, 252, 0.32)',
    cardBg: 'linear-gradient(135deg, rgba(16, 46, 82, 0.45) 0%, rgba(6, 26, 50, 0.55) 70%)',
    cardBorder: 'rgba(125, 211, 252, 0.28)',
    cardHoverBorder: 'rgba(125, 211, 252, 0.50)',
    shadow: '0 4px 18px rgba(0, 0, 0, 0.32), 0 0 14px rgba(125, 211, 252, 0.08)',
    barGradient: 'linear-gradient(90deg, #1e3a8a 0%, #7dd3fc 100%)',
  },
  {
    // Rank 3: Arc Starlight Titanium / Deep Slate Navy
    color: '#B4BFC9',
    bg: 'rgba(180, 191, 201, 0.07)',
    border: 'rgba(180, 191, 201, 0.24)',
    cardBg: 'linear-gradient(135deg, rgba(14, 34, 62, 0.35) 0%, rgba(6, 26, 50, 0.48) 70%)',
    cardBorder: 'rgba(180, 191, 201, 0.22)',
    cardHoverBorder: 'rgba(180, 191, 201, 0.42)',
    shadow: '0 4px 16px rgba(0, 0, 0, 0.26)',
    barGradient: 'linear-gradient(90deg, #1e293b 0%, #B4BFC9 100%)',
  },
]

const DEFAULT_RANK_STYLE: RankConfig = {
  color: 'var(--text-tertiary)',
  bg: 'rgba(228, 232, 236, 0.03)',
  border: 'rgba(228, 232, 236, 0.08)',
  cardBg: 'rgba(6, 30, 60, 0.45)',
  cardBorder: 'rgba(90, 138, 176, 0.18)',
  cardHoverBorder: 'rgba(90, 138, 176, 0.38)',
  shadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
  barGradient: 'rgba(90, 138, 176, 0.45)',
}

function DescriptionText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const isLong = text.length > 150 || text.split('\n').length > 3
  if (!isLong) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </div>
    )
  }
  const display = expanded ? text : `${text.slice(0, 150).trim()}... `
  return (
    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      <span>{display}</span>
      <span
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(!expanded) }}
        style={{
          color: 'var(--accent-bright)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          textDecoration: 'underline',
          marginLeft: expanded ? 6 : 2,
          display: 'inline-block',
        }}
      >
        {expanded ? 'Show less' : 'Read more'}
      </span>
    </div>
  )
}

export default function PollTab() {
  const { address } = useAccount()
  const { sessionWallet } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()

  const [subTab, setSubTab] = useState<PollSubTab>('live')
  const [polls, setPolls] = useState<DbPoll[]>([])
  const [history, setHistory] = useState<DbPollHistory[]>([])
  const [votedIds, setVotedIds] = useState<Set<number>>(new Set())
  const [profilesMap, setProfilesMap] = useState<Record<string, { name: string; pfp_url?: string }>>({})
  const [voting, setVoting] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const wallet = sessionWallet?.address ?? address

  const fetchPolls = useCallback(async () => {
    const { data } = await supabase
      .from('polls')
      .select('*')
      .eq('status', 'active')
      .order('vote_count', { ascending: false })

    if (data) {
      const pollList = (data as DbPoll[]).sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
      setPolls(pollList)

      const wallets = [...new Set(pollList.map(p => p.created_by_wallet.toLowerCase()))]
      if (wallets.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('wallet_address, name, pfp_url')
          .in('wallet_address', wallets)

        if (profs) {
          const map: Record<string, { name: string; pfp_url?: string }> = {}
          profs.forEach((pr: { wallet_address: string; name: string; pfp_url?: string }) => {
            map[pr.wallet_address.toLowerCase()] = { name: pr.name, pfp_url: pr.pfp_url }
          })
          setProfilesMap(prev => ({ ...prev, ...map }))
        }
      }
    }

    const { data: hist } = await supabase
      .from('poll_history')
      .select('*')
      .order('round_number', { ascending: false })
      .limit(30)
    if (hist) setHistory(hist as DbPollHistory[])

    if (wallet) {
      const { data: votes } = await supabase
        .from('poll_votes')
        .select('poll_id')
        .eq('wallet_address', wallet.toLowerCase())
      if (votes) setVotedIds(new Set((votes as { poll_id: number }[]).map(v => v.poll_id)))
    }
  }, [wallet])

  useEffect(() => {
    fetchPolls()
    const ch = supabase
      .channel('polls-live-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, () => {
        fetchPolls()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, () => {
        fetchPolls()
      })
      .subscribe()

    const interval = setInterval(() => {
      fetchPolls()
    }, 8000)

    return () => {
      supabase.removeChannel(ch)
      clearInterval(interval)
    }
  }, [fetchPolls])

  const handleVote = async (pollId: number) => {
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    const pollIdNum = Number(pollId)
    if (votedIds.has(pollIdNum)) return

    setVoting(pollIdNum)
    showPending('Voting...')
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: POLL_REGISTRY_ADDRESS,
        abi: POLL_REGISTRY_ABI as never,
        functionName: 'vote',
        args: [BigInt(pollIdNum)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Vote recorded!')
      await supabase.from('poll_votes').insert({
        poll_id: pollIdNum,
        wallet_address: sessionWallet.address.toLowerCase(),
        created_at: new Date().toISOString(),
      })
      const currentVoteCount = polls.find(p => p.id === pollIdNum)?.vote_count ?? 0
      await supabase.from('polls').update({ vote_count: currentVoteCount + 1 }).eq('id', pollIdNum)
      await supabase.from('wallet_transactions').insert({
        wallet_address: sessionWallet.address.toLowerCase(),
        type: 'vote',
        label: 'Voted on poll',
        amount: null,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })
      setVotedIds(prev => new Set([...prev, pollIdNum]))
      setPolls(prev => {
        const updated = prev.map(p => p.id === pollIdNum ? { ...p, vote_count: p.vote_count + 1 } : p)
        return [...updated].sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
      })
      await fetchPolls()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 80) ?? 'Vote failed')
    } finally {
      setVoting(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    if (!title.trim()) { showFailed('Title required'); return }
    setSubmitting(true)
    showPending('Submitting idea...')
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: POLL_REGISTRY_ADDRESS,
        abi: POLL_REGISTRY_ABI as never,
        functionName: 'submitPoll',
        args: [title.trim().slice(0, 120), description.trim().slice(0, 500)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Idea submitted!')
      const profileResp = await supabase.from('profiles').select('name').eq('wallet_address', sessionWallet.address.toLowerCase()).single()
      await supabase.from('polls').insert({
        title: title.trim(),
        description: description.trim(),
        created_by_wallet: sessionWallet.address.toLowerCase(),
        created_by_name: profileResp.data?.name ?? 'Unknown',
        vote_count: 0,
        status: 'active',
        created_at: new Date().toISOString(),
      })
      await supabase.from('wallet_transactions').insert({
        wallet_address: sessionWallet.address.toLowerCase(),
        type: 'poll_submit',
        label: `Submitted: ${title.slice(0, 40)}`,
        amount: null,
        tx_hash: hash,
        created_at: new Date().toISOString(),
      })
      setTitle('')
      setDescription('')
      await fetchPolls()
      setSubTab('live')
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 80) ?? 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  // Group history by round
  const rounds = history.reduce<Record<number, DbPollHistory[]>>((acc, h) => {
    if (!acc[h.round_number]) acc[h.round_number] = []
    acc[h.round_number].push(h)
    return acc
  }, {})

  const SUB_TABS: { id: PollSubTab; label: string }[] = [
    { id: 'live', label: 'Live Polls' },
    { id: 'submit', label: 'Submit Idea' },
    { id: 'history', label: 'History' },
  ]

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Sub-tab switcher */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        background: 'var(--bg-glass)', padding: 4, borderRadius: 10,
        width: 'fit-content', border: '1px solid var(--border-subtle)',
      }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: '7px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: subTab === t.id ? 'var(--bg-secondary)' : 'transparent',
              color: subTab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: subTab === t.id ? '1px solid var(--border-default)' : '1px solid transparent',
              transition: 'all 200ms ease', whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── LIVE POLLS ── */}
      {subTab === 'live' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {polls.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🗳</div>
              <div style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No polls yet</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
                Be the first to submit a bet idea for the community to vote on.
              </div>
              <button
                onClick={() => setSubTab('submit')}
                className="btn-primary"
                style={{ padding: '10px 24px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
              >
                Submit an Idea →
              </button>
            </div>
          ) : (() => {
            const totalVotes = polls.reduce((sum, p) => sum + (p.vote_count ?? 0), 0)
            return polls.map((poll, i) => {
              const voted = votedIds.has(poll.id)
              const isVoting = voting === poll.id
              const voteCount = poll.vote_count ?? 0
              const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0
              const hasRank = voteCount > 0 && i < 3
              const rank = hasRank ? RANK_STYLE[i] : DEFAULT_RANK_STYLE
              const isTop = i === 0 && voteCount > 0
              const profileInfo = profilesMap[poll.created_by_wallet.toLowerCase()]
              const authorName = profileInfo?.name || poll.created_by_name || shortAddress(poll.created_by_wallet)
              const avatarUrl = profileInfo?.pfp_url

              return (
                <div
                  key={poll.id}
                  style={{
                    background: hasRank ? rank.cardBg : 'rgba(6, 30, 60, 0.45)',
                    border: `1px solid ${hasRank ? rank.cardBorder : 'rgba(90, 138, 176, 0.18)'}`,
                    borderRadius: 14,
                    overflow: 'hidden',
                    position: 'relative',
                    transition: 'transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease',
                    boxShadow: hasRank ? rank.shadow : '0 4px 16px rgba(0, 0, 0, 0.25)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.borderColor = hasRank ? rank.cardHoverBorder : 'rgba(90, 138, 176, 0.38)'
                    if (isTop) {
                      e.currentTarget.style.boxShadow = '0 6px 24px rgba(0, 0, 0, 0.4), 0 0 25px rgba(56, 189, 248, 0.2)'
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.borderColor = hasRank ? rank.cardBorder : 'rgba(90, 138, 176, 0.18)'
                    if (isTop) {
                      e.currentTarget.style.boxShadow = rank.shadow
                    }
                  }}
                >
                  {/* Top crown accent bar for #1 */}
                  {isTop && (
                    <div style={{
                      height: 2,
                      background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.4) 30%, rgba(125, 211, 252, 0.95) 50%, rgba(56, 189, 248, 0.4) 70%, transparent)',
                    }} />
                  )}

                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>

                      {/* Left: Rank Badge (42×42px, vertically centered) */}
                      <div style={{
                        flexShrink: 0,
                        width: 42,
                        height: 42,
                        borderRadius: '50%',
                        background: hasRank ? rank.bg : 'rgba(228, 232, 236, 0.03)',
                        border: `1px solid ${hasRank ? rank.border : 'rgba(228, 232, 236, 0.08)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: isTop ? '0 0 14px rgba(56, 189, 248, 0.2)' : undefined,
                      }}>
                        {voteCount > 0 && i === 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                            <svg width="15" height="11" viewBox="0 0 24 18" fill="none" style={{ marginBottom: 2 }}>
                              <path d="M2 4l4 10h12l4-10-5 3.5L12 2l-5 5.5L2 4z" fill="#38bdf8" />
                            </svg>
                            <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8', letterSpacing: '-0.02em' }}>
                              #1
                            </span>
                          </div>
                        ) : voteCount > 0 && i === 1 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                            <svg width="13" height="11" viewBox="0 0 24 20" fill="none" style={{ marginBottom: 2 }}>
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#7dd3fc" />
                            </svg>
                            <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: '#7dd3fc', letterSpacing: '-0.02em' }}>
                              #2
                            </span>
                          </div>
                        ) : voteCount > 0 && i === 2 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                            <svg width="12" height="11" viewBox="0 0 24 22" fill="none" style={{ marginBottom: 2 }}>
                              <path d="M12 2l7 4v6c0 5.25-3.5 10-7 11-3.5-1-7-5.75-7-11V6l7-4z" fill="#B4BFC9" />
                            </svg>
                            <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: '#B4BFC9', letterSpacing: '-0.02em' }}>
                              #3
                            </span>
                          </div>
                        ) : (
                          <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)' }}>
                            #{i + 1}
                          </span>
                        )}
                      </div>

                      {/* Centre: Main content area */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ marginBottom: 4, lineHeight: 1.35 }}>
                          {isTop && (
                            <span style={{
                              display: 'inline-block',
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              color: '#38bdf8',
                              background: 'rgba(56, 189, 248, 0.12)',
                              border: '1px solid rgba(56, 189, 248, 0.38)',
                              boxShadow: '0 0 10px rgba(56, 189, 248, 0.15)',
                              padding: '2px 7px',
                              borderRadius: 4,
                              marginRight: 8,
                              verticalAlign: 'middle',
                            }}>
                              Top Pick
                            </span>
                          )}
                          <span style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            verticalAlign: 'middle',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}>
                            {poll.title}
                          </span>
                        </div>

                        {/* Description text with truncation + Read more */}
                        {poll.description && (
                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            <DescriptionText text={poll.description} />
                          </div>
                        )}

                        {/* Progress bar */}
                        <div style={{ marginBottom: 8 }}>
                          <div style={{
                            height: 4,
                            background: 'rgba(54, 97, 132, 0.18)',
                            borderRadius: 4,
                            overflow: 'hidden',
                            width: '100%',
                          }}>
                            <div style={{
                              height: '100%',
                              borderRadius: 4,
                              width: `${pct}%`,
                              background: hasRank
                                ? rank.barGradient
                                : 'rgba(90, 138, 176, 0.45)',
                              transition: 'width 0.5s ease',
                            }} />
                          </div>
                          {totalVotes > 0 && (
                            <div style={{
                              color: 'var(--text-tertiary)',
                              fontSize: 10,
                              marginTop: 4,
                              fontFamily: 'var(--font-mono)',
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                            }}>
                              {pct}% of all votes
                            </div>
                          )}
                        </div>

                        {/* Submitter avatar + username · relative time */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            background: 'rgba(54, 97, 132, 0.2)',
                            border: '1px solid rgba(90, 138, 176, 0.25)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            overflow: 'hidden',
                            fontSize: 9,
                          }}>
                            {avatarUrl ? (
                              <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <span style={{ fontSize: 9, opacity: 0.6 }}>👤</span>
                            )}
                          </div>
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                              {authorName}
                            </span>
                            {' · '}
                            {timeAgo(poll.created_at)}
                          </span>
                        </div>
                      </div>

                      {/* Right: Vote count on top + Vote button below */}
                      <div style={{
                        flexShrink: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        minWidth: 78,
                        paddingLeft: 8,
                      }}>
                        <div style={{ textAlign: 'center' }}>
                          <span className="mono" style={{
                            fontSize: 20,
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            lineHeight: 1,
                            display: 'block',
                          }}>
                            {voteCount}
                          </span>
                          <div style={{
                            color: 'var(--text-tertiary)',
                            fontSize: 9,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                            marginTop: 2,
                            fontWeight: 600,
                          }}>
                            VOTES
                          </div>
                        </div>

                        <button
                          onClick={() => handleVote(poll.id)}
                          disabled={voted || isVoting || !sessionWallet}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 5,
                            minWidth: 76,
                            cursor: voted || isVoting || !sessionWallet ? 'default' : 'pointer',
                            transition: 'all 150ms ease',
                            background: voted
                              ? 'rgba(34, 197, 94, 0.08)'
                              : isVoting
                                ? 'rgba(54, 97, 132, 0.1)'
                                : 'rgba(54, 97, 132, 0.15)',
                            border: voted
                              ? '1px solid rgba(34, 197, 94, 0.3)'
                              : isVoting
                                ? '1px solid rgba(54, 97, 132, 0.2)'
                                : '1px solid rgba(90, 138, 176, 0.35)',
                            color: voted ? '#4ade80' : isVoting ? 'var(--text-tertiary)' : 'var(--text-primary)',
                          }}
                          onMouseEnter={e => {
                            if (!voted && !isVoting && sessionWallet) {
                              e.currentTarget.style.background = 'rgba(54, 97, 132, 0.28)'
                              e.currentTarget.style.borderColor = 'rgba(90, 138, 176, 0.6)'
                            }
                          }}
                          onMouseLeave={e => {
                            if (!voted && !isVoting && sessionWallet) {
                              e.currentTarget.style.background = 'rgba(54, 97, 132, 0.15)'
                              e.currentTarget.style.borderColor = 'rgba(90, 138, 176, 0.35)'
                            }
                          }}
                        >
                          {isVoting ? (
                            <span style={{
                              width: 11,
                              height: 11,
                              border: '1.5px solid rgba(228,232,236,0.3)',
                              borderTopColor: '#E4E8EC',
                              borderRadius: '50%',
                              display: 'inline-block',
                              animation: 'poll-spin 0.7s linear infinite',
                            }} />
                          ) : voted ? (
                            <>✓ Voted</>
                          ) : (
                            <>
                              <span style={{ fontSize: 11 }}>👍</span>
                              <span>Vote</span>
                            </>
                          )}
                        </button>
                      </div>

                    </div>
                  </div>
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Submit Idea */}
      {subTab === 'submit' && (
        <div className="card" style={{ padding: 24, maxWidth: 600, margin: '0 auto' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Submit a Prediction Idea</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Your idea goes onchain. The community votes and top ideas become real markets.
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                Prediction Title * <span style={{ color: 'var(--text-tertiary)' }}>({title.length}/120)</span>
              </label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value.slice(0, 120))}
                placeholder="e.g. Will Arc hit 1M transactions by end of year?"
                maxLength={120}
                required
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                Description <span style={{ color: 'var(--text-tertiary)' }}>({description.length}/500)</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value.slice(0, 500))}
                placeholder="Add context, resolution criteria, or sources... (optional)"
                maxLength={500}
                rows={4}
                style={{ resize: 'none' }}
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !sessionWallet || !title.trim()}
              className="btn-primary"
              style={{ padding: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              {submitting ? 'Submitting...' : !sessionWallet ? 'Activate Wallet to Submit' : 'Submit Idea Onchain'}
            </button>
            {!sessionWallet && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                Activate your Arc Calls Wallet from the navbar to submit ideas.
              </div>
            )}
          </form>
        </div>
      )}

      {/* History */}
      {subTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 800, margin: '0 auto' }}>
          {Object.keys(rounds).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
              No closed rounds yet.
            </div>
          ) : (
            Object.entries(rounds).sort((a, b) => Number(b[0]) - Number(a[0])).map(([round, winners]) => (
              <div key={round} className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: 'var(--accent-bright)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Round {round} — Winners
                </div>
                {winners.map((w, i) => (
                  <div key={w.id} style={{
                    padding: '10px 0',
                    borderBottom: i < winners.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{w.poll_title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>submitted by {w.submitted_by_name}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 14 }}>🏆</span>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-bright)' }}>{w.final_vote_count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      <style>{`
        @keyframes poll-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
