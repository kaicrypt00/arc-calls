import { useState, useRef, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useSessionWallet, getMaxFeePerGas, publicClient, writeContract } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { useToast } from '../contexts/ToastContext'
import { PROFILE_REGISTRY_ADDRESS } from '../constants'
import { PROFILE_REGISTRY_ABI } from '../abis'
import { supabase } from '../lib/supabase'
import ArcLogo from './ArcLogo'

export default function MintProfileModal() {
  const { address } = useAccount()
  const { sessionWallet } = useSessionWallet()
  const { showMintModal, refreshProfile, setShowMintModal } = useProfile()
  const { showPending, showConfirmed, showFailed } = useToast()

  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [xUsername, setXUsername] = useState('')
  const [pfpFile, setPfpFile] = useState<File | null>(null)
  const [pfpPreview, setPfpPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<'form' | 'success'>('form')
  const [txHash, setTxHash] = useState('')
  const [walletBalance, setWalletBalance] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Auto-close after 3 seconds on success
  useEffect(() => {
    if (step === 'success') {
      const t = setTimeout(() => setShowMintModal(false), 3000)
      return () => clearTimeout(t)
    }
  }, [step, setShowMintModal])

  // Check session wallet USDC balance when modal opens
  useEffect(() => {
    if (!sessionWallet || !showMintModal) return
    publicClient.getBalance({ address: sessionWallet.address }).then(bal => {
      // Arc native balance is USDC in 18 decimals — convert to 6-decimal display
      const usdc6 = bal / 10n ** 12n // 18dec → 6dec
      const formatted = (Number(usdc6) / 1_000_000).toFixed(4)
      setWalletBalance(formatted)
    }).catch(() => setWalletBalance(null))
  }, [sessionWallet, showMintModal])

  if (!showMintModal) return null

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 1.5 * 1024 * 1024) {
      showFailed('Image must be under 1.5MB')
      e.target.value = ''
      return
    }
    setPfpFile(f)
    setPfpPreview(URL.createObjectURL(f))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionWallet || !address) return
    if (!name.trim()) { showFailed('Display name is required'); return }
    if (!xUsername.trim()) { showFailed('X username is required'); return }

    const cleanX = xUsername.replace('@', '').trim().slice(0, 15)
    setSubmitting(true)
    showPending('Checking wallet balance...')

    // Pre-flight: check session wallet has enough USDC to cover gas
    try {
      const nativeBal = await publicClient.getBalance({ address: sessionWallet.address })
      // On Arc, native balance IS USDC in 18-decimal units. Minimum ~0.01 USDC native = 10^16
      const MIN_GAS_BALANCE = 10_000_000_000_000n // ~0.00001 USDC in 18-dec (very small, just confirms non-zero)
      if (nativeBal < MIN_GAS_BALANCE) {
        showFailed(`Your Arc Calls wallet needs USDC for gas. Fund: ${sessionWallet.address.slice(0, 10)}...`)
        setSubmitting(false)
        return
      }
    } catch {
      // If balance check fails, proceed anyway and let the tx fail naturally
    }

    showPending('Minting profile...')

    try {
      // Upload avatar if provided
      let pfpUrl = ''
      if (pfpFile) {
        const ext = pfpFile.name.split('.').pop()
        const path = `${sessionWallet.address.toLowerCase()}/avatar.${ext}`
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, pfpFile, { upsert: true })
        if (!upErr) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
          pfpUrl = urlData.publicUrl
        }
      }

      const maxFeePerGas = await getMaxFeePerGas()

      // Call mintProfile on ProfileRegistry
      const hash = await writeContract(sessionWallet.client, {
        address: PROFILE_REGISTRY_ADDRESS,
        abi: PROFILE_REGISTRY_ABI as never,
        functionName: 'mintProfile',
        args: [name.trim().slice(0, 50), bio.trim().slice(0, 160), pfpUrl, cleanX],
        maxFeePerGas,
      })
      setTxHash(hash)

      await publicClient.waitForTransactionReceipt({ hash })
      showConfirmed(hash, 'Profile minted!')

      // Insert into Supabase profiles
      await supabase.from('profiles').upsert({
        wallet_address: sessionWallet.address.toLowerCase(),
        name: name.trim(),
        bio: bio.trim(),
        pfp_url: pfpUrl,
        x_username: cleanX,
        minted_at: new Date().toISOString(),
      })

      // Insert into leaderboard with initial zeroes (ignore if already exists)
      await supabase.from('leaderboard').upsert({
        wallet_address: sessionWallet.address.toLowerCase(),
        name: name.trim(),
        pfp_url: pfpUrl,
        total_calls: 0,
        wins: 0,
        losses: 0,
        win_rate: 0,
        total_pnl: 0,
        total_volume: 0,
        is_agent: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'wallet_address', ignoreDuplicates: true })

      setStep('success')
      await refreshProfile()
    } catch (e) {
      showFailed((e as Error).message?.slice(0, 100) ?? 'Minting failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(1,16,41,0.97)', backdropFilter: 'blur(20px)',
      overflowY: 'auto', padding: '72px 20px 40px',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: 28, position: 'relative', zIndex: 1, margin: '0 auto' }}>
        {/* Close button */}
        <button
          onClick={() => setShowMintModal(false)}
          style={{
            position: 'absolute', top: 14, right: 14,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: 20, lineHeight: 1,
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, transition: 'color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          aria-label="Close"
        >
          ✕
        </button>

        {step === 'success' ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Profile Created!</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Welcome to Arc Calls, {name}. Enter the arena.</div>
            {txHash && (
              <a href={`https://explorer.arc.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--accent-blue)', display: 'block', marginTop: 8, textDecoration: 'none' }}>
                View on Arc Explorer ↗
              </a>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 12 }}>Auto-closing in 3 seconds…</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 20 }}>
              <ArcLogo size={36} />
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Create Your Profile</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
                One profile per wallet. Gas fee only. Required to use Arc Calls.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Avatar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{
                    width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-glass)',
                    border: '2px dashed var(--border-default)', overflow: 'hidden', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  {pfpPreview
                    ? <img src={pfpPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 24 }}>📷</span>
                  }
                </button>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>Profile Picture</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Optional · JPEG or PNG</div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                  Display Name * <span style={{ color: 'var(--text-tertiary)' }}>({name.length}/50)</span>
                </label>
                <input
                  value={name} onChange={e => setName(e.target.value.slice(0, 50))}
                  placeholder="Your name" maxLength={50} required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                  Bio <span style={{ color: 'var(--text-tertiary)' }}>({bio.length}/160)</span>
                </label>
                <textarea
                  value={bio} onChange={e => setBio(e.target.value.slice(0, 160))}
                  placeholder="Short bio (optional)" maxLength={160} rows={2}
                  style={{ resize: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>X Username *</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14 }}>@</span>
                  <input
                    value={xUsername} onChange={e => setXUsername(e.target.value.replace('@', '').slice(0, 15))}
                    placeholder="username" maxLength={15} required
                    style={{ paddingLeft: 28 }}
                  />
                </div>
              </div>

              {/* Session wallet balance / funding notice */}
              {sessionWallet && (
                <div style={{
                  background: parseFloat(walletBalance ?? '0') < 0.001 ? 'rgba(255,180,0,0.08)' : 'rgba(90,138,176,0.08)',
                  border: `1px solid ${parseFloat(walletBalance ?? '0') < 0.001 ? 'rgba(255,180,0,0.3)' : 'rgba(90,138,176,0.2)'}`,
                  borderRadius: 10, padding: '10px 14px', fontSize: 12,
                }}>
                  {parseFloat(walletBalance ?? '0') < 0.001 ? (
                    <>
                      <div style={{ fontWeight: 600, color: '#f5c842', marginBottom: 4 }}>⚠ Fund your Arc Calls wallet to pay gas</div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
                        Send a small amount of USDC to your Arc Calls wallet on Arc Mainnet:
                      </div>
                      <div style={{
                        fontFamily: 'monospace', fontSize: 11, background: 'rgba(0,0,0,0.3)',
                        borderRadius: 6, padding: '6px 10px', wordBreak: 'break-all',
                        color: 'var(--text-primary)', userSelect: 'all',
                      }}>
                        {sessionWallet.address}
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 4 }}>
                        Current balance: {walletBalance ?? '0.0000'} USDC
                      </div>
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Arc Calls wallet balance</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{walletBalance} USDC</span>
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !name.trim() || !xUsername.trim() || parseFloat(walletBalance ?? '0') < 0.001}
                className="btn-primary"
                style={{ padding: '12px 20px', fontSize: 14, fontWeight: 700, marginTop: 4 }}
              >
                {submitting ? 'Minting...' : 'Mint Profile (gas only)'}
              </button>

              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                Gas fee paid in USDC · No additional token required
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
