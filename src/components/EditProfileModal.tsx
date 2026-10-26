import { useState, useRef } from 'react'
import { useSessionWallet, getMaxFeePerGas, publicClient, writeContract } from '../contexts/SessionWalletContext'
import { useProfile } from '../contexts/ProfileContext'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import { PROFILE_REGISTRY_ADDRESS } from '../constants'
import { PROFILE_REGISTRY_ABI } from '../abis'
import { imageToDataUrl } from '../utils/format'

interface Props {
  isOpen: boolean
  onClose: () => void
  initialName: string
  initialBio: string
  initialX: string
  initialPfpUrl: string
}

function validate(name: string, bio: string, x: string): string | null {
  if (!name.trim()) return 'Name is required'
  if (name.trim().length > 50) return 'Name must be 50 chars or less'
  if (bio.length > 160) return 'Bio must be 160 chars or less'
  if (x.length > 15) return 'X username must be 15 chars or less'
  if (x && !/^[a-zA-Z0-9_]+$/.test(x)) return 'X username: letters, numbers, underscores only'
  return null
}

export default function EditProfileModal({ isOpen, onClose, initialName, initialBio, initialX, initialPfpUrl }: Props) {
  const { sessionWallet } = useSessionWallet()
  const { updateProfileData } = useProfile()
  const { showPending, showConfirmed, showFailed } = useToast()

  const [name, setName] = useState(initialName)
  const [bio, setBio] = useState(initialBio)
  const [x, setX] = useState(initialX)
  const [pfpUrl, setPfpUrl] = useState(initialPfpUrl)
  const [pfpFile, setPfpFile] = useState<File | null>(null)
  const [pfpPreview, setPfpPreview] = useState(initialPfpUrl)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      showFailed('Only JPEG, PNG, or WebP images allowed')
      e.target.value = ''
      return
    }
    if (f.size > 1.5 * 1024 * 1024) {
      showFailed('Image must be under 1.5MB')
      e.target.value = ''
      return
    }
    setPfpFile(f)
    const preview = await imageToDataUrl(f)
    setPfpPreview(preview)
  }

  const handleSave = async () => {
    const err = validate(name, bio, x)
    if (err) { showFailed(err); return }
    if (!sessionWallet) { showFailed('Activate your Arc Calls Wallet first'); return }

    setSaving(true)
    showPending('Saving profile...')

    try {
      let finalPfpUrl = pfpUrl

      // Upload new avatar if selected
      if (pfpFile) {
        const ext = pfpFile.name.split('.').pop() ?? 'jpg'
        const path = `${sessionWallet.address.toLowerCase()}/avatar.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(path, pfpFile, { upsert: true, contentType: pfpFile.type })
        if (uploadErr) throw new Error('Avatar upload failed')
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
        finalPfpUrl = urlData.publicUrl
      }

      const maxFeePerGas = await getMaxFeePerGas()

      const hash = await writeContract(sessionWallet.client, {
        address: PROFILE_REGISTRY_ADDRESS,
        abi: PROFILE_REGISTRY_ABI as never,
        functionName: 'updateProfile',
        args: [name.trim(), bio.trim(), finalPfpUrl, x.trim()],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })

      // Update Supabase profiles
      await supabase.from('profiles').upsert({
        wallet_address: sessionWallet.address.toLowerCase(),
        name: name.trim(),
        bio: bio.trim(),
        pfp_url: finalPfpUrl,
        x_username: x.trim(),
      }, { onConflict: 'wallet_address' })

      // Update leaderboard name + pfp
      await supabase.from('leaderboard')
        .update({ name: name.trim(), pfp_url: finalPfpUrl })
        .eq('wallet_address', sessionWallet.address.toLowerCase())

      // Instant optimistic update — no re-fetch needed
      updateProfileData({ name: name.trim(), bio: bio.trim(), pfp_url: finalPfpUrl, x_username: x.trim() })
      showConfirmed(hash, 'Profile updated!')
      onClose()
    } catch (e: unknown) {
      showFailed((e as Error)?.message?.slice(0, 80) ?? 'Update failed')
    }
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(1,16,41,0.97)',
      backdropFilter: 'blur(20px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '80px 16px 40px', overflowY: 'auto',
    }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 480, padding: 32, position: 'relative' }}>
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4,
          }}
          aria-label="Close"
        >✕</button>

        <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 24 }}>
          Edit Profile
        </h2>

        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              width: 72, height: 72, borderRadius: '50%', overflow: 'hidden',
              border: '2px dashed rgba(54,97,132,0.4)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(1,13,31,0.8)', flexShrink: 0,
            }}
          >
            {pfpPreview
              ? <img src={pfpPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 24 }}>📷</span>
            }
          </div>
          <div>
            <button onClick={() => fileRef.current?.click()} className="btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }}>
              Change Photo
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>JPEG, PNG, WebP · Max 1.5MB</div>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleFile} />
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Name <span style={{ color: 'var(--text-tertiary)' }}>{name.length}/50</span>
            </label>
            <input
              className="bet-input-field"
              value={name}
              onChange={e => setName(e.target.value.slice(0, 50))}
              placeholder="Your display name"
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Bio <span style={{ color: 'var(--text-tertiary)' }}>{bio.length}/160</span>
            </label>
            <textarea
              className="bet-input-field"
              value={bio}
              onChange={e => setBio(e.target.value.slice(0, 160))}
              placeholder="Tell the arena about yourself"
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              X Username <span style={{ color: 'var(--text-tertiary)' }}>(without @)</span>
            </label>
            <input
              className="bet-input-field"
              value={x}
              onChange={e => setX(e.target.value.replace('@', '').slice(0, 15))}
              placeholder="yourhandle"
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
          <button onClick={onClose} className="btn-secondary" style={{ flex: 1 }} disabled={saving}>
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary" style={{ flex: 2 }} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
