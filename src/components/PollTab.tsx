import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useSessionWallet, getMaxFeePerGas, publicClient, writeContract } from '../contexts/SessionWalletContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, type DbPoll, type DbPollHistory } from '../lib/supabase'
import { POLL_REGISTRY_ADDRESS } from '../constants'
import { POLL_REGISTRY_ABI } from '../abis'

type PollSubTab = 'live' | 'submit' | 'history'

function truncate(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function PollTab() {
  const { address } = useAccount()
  const { sessionWallet } = useSessionWallet()
  const { showPending, showConfirmed, showFailed } = useToast()

  const [subTab, setSubTab] = useState<PollSubTab>('live')
  const [polls, setPolls] = useState<DbPoll[]>([])
  const [history, setHistory] = useState<DbPollHistory[]>([])
  const [votedIds, setVotedIds] = useState<Set<number>>(new Set())
  const [voting, setVoting] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const wallet = sessionWallet?.address ?? address

  const fetchPolls = useCallback(async () => {
    const { data } = await supabase.from('polls').select('*').eq('status', 'active').order('vote_count', { ascending: false })
    if (data) setPolls(data as DbPoll[])

    const { data: hist } = await supabase.from('poll_history').select('*').order('round_number', { ascending: false }).limit(30)
    if (hist) setHistory(hist as DbPollHistory[])

    if (wallet) {
      const { data: votes } = await supabase.from('poll_votes').select('poll_id').eq('wallet_address', wallet.toLowerCase())
      if (votes) setVotedIds(new Set((votes as { poll_id: number }[]).map(v => v.poll_id)))
    }
  }, [wallet])

  useEffect(() => { fetchPolls() }, [fetchPolls])

  const handleVote = async (pollId: number) => {
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }
    setVoting(pollId)
    showPending('Voting...')
    try {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: POLL_REGISTRY_ADDRESS,
        abi: POLL_REGISTRY_ABI as never,
        functionName: 'vote',
        args: [BigInt(pollId)],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Vote recorded!')
      await supabase.from('poll_votes').insert({ poll_id: pollId, wallet_address: sessionWallet.address.toLowerCase(), created_at: new Date().toISOString() })
      await supabase.from('polls').update({ vote_count: (polls.find(p => p.id === pollId)?.vote_count ?? 0) + 1 }).eq('id', pollId)
      await supabase.from('wallet_transactions').insert({ wallet_address: sessionWallet.address.toLowerCase(), type: 'vote', label: 'Voted on poll', amount: null, tx_hash: hash, created_at: new Date().toISOString() })
      setVotedIds(prev => new Set([...prev, pollId]))
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
      await supabase.from('wallet_transactions').insert({ wallet_address: sessionWallet.address.toLowerCase(), type: 'poll_submit', label: `Submitted: ${title.slice(0, 40)}`, amount: null, tx_hash: hash, created_at: new Date().toISOString() })
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
    <div>
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
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Live Polls */}
      {subTab === 'live' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {polls.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
              No live polls right now. Be the first to submit an idea!
            </div>
          ) : polls.map(poll => {
            const voted = votedIds.has(poll.id)
            return (
              <div key={poll.id} className="card" style={{ padding: 18, display: 'flex', gap: 16, alignItems: 'flex-start', transition: 'transform 200ms ease, box-shadow 200ms ease' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, lineHeight: 1.4 }}>{poll.title}</div>
                  {poll.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>{poll.description}</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    by {poll.created_by_name || truncate(poll.created_by_wallet)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, minWidth: 64 }}>
                  <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{poll.vote_count}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>votes</span>
                  {voted ? (
                    <span style={{ fontSize: 11, color: 'var(--yes-color)', marginTop: 4 }}>Voted ✓</span>
                  ) : (
                    <button
                      onClick={() => handleVote(poll.id)}
                      disabled={voting === poll.id || !sessionWallet}
                      className="btn-primary"
                      style={{ fontSize: 12, padding: '5px 14px', marginTop: 4 }}
                    >
                      {voting === poll.id ? '...' : 'Vote'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Submit Idea */}
      {subTab === 'submit' && (
        <div className="card" style={{ padding: 24, maxWidth: 600 }}>
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
              style={{ padding: '12px', fontWeight: 700 }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{w.poll_title}</div>
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
    </div>
  )
}
