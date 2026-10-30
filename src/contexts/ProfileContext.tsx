import {
  createContext, useContext, useState, useEffect, useCallback, ReactNode
} from 'react'
import { useAccount } from 'wagmi'
import { publicClient } from './SessionWalletContext'
import { useSessionWallet } from './SessionWalletContext'
import { PROFILE_REGISTRY_ADDRESS, EVENT_SESSION_WALLET_READY } from '../constants'
import { PROFILE_REGISTRY_ABI } from '../abis'
import { supabase, type DbProfile } from '../lib/supabase'
import { useDataPrefetch } from './DataPrefetchContext'

interface ProfileContextValue {
  profile: DbProfile | null
  profileLoading: boolean
  showMintModal: boolean
  navState: 1 | 2 | 3
  appInitialized: boolean
  refreshProfile: () => Promise<void>
  updateProfileData: (patch: Partial<DbProfile>) => void
  setShowMintModal: (v: boolean) => void
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

const PROFILE_CACHE_KEY = 'arc_profile_'

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, status } = useAccount()
  const { sessionWallet, hasSessionWallet } = useSessionWallet()
  const dataPrefetch = useDataPrefetch()
  const dataReady = dataPrefetch?.dataReady ?? false

  const [profile, setProfile] = useState<DbProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileFetched, setProfileFetched] = useState(false)
  const [showMintModal, setShowMintModal] = useState(false)
  const [appInitialized, setAppInitialized] = useState(false)
  const [minTimePassed, setMinTimePassed] = useState(false)

  // Minimum loader duration (1300ms) to ensure smooth brand presentation and data hydration
  useEffect(() => {
    const t = setTimeout(() => setMinTimePassed(true), 1300)
    return () => clearTimeout(t)
  }, [])

  // navState: 1 = not connected, 2 = connected+session but no profile, 3 = fully onboarded
  let navState: 1 | 2 | 3 = 1
  if (isConnected && hasSessionWallet && profile) navState = 3
  else if (isConnected && hasSessionWallet) navState = 2
  else navState = 1

  const refreshProfile = useCallback(async () => {
    if (!sessionWallet?.address) {
      setProfile(null)
      setProfileFetched(true)
      return
    }
    const walletAddr = sessionWallet.address.toLowerCase()
    const cacheKey = PROFILE_CACHE_KEY + walletAddr

    setProfileLoading(true)

    // 1. Instant load from localStorage cache (< 5ms)
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        setProfile(JSON.parse(cached))
        setProfileFetched(true)
      }
    } catch { /* ignore */ }

    try {
      // Check onchain first
      const hasOnchain = PROFILE_REGISTRY_ADDRESS
        ? await publicClient.readContract({
            address: PROFILE_REGISTRY_ADDRESS,
            abi: PROFILE_REGISTRY_ABI,
            functionName: 'hasProfile',
            args: [sessionWallet.address],
          }).catch(() => false)
        : false

      if (!hasOnchain) {
        setProfile(null)
        try { localStorage.removeItem(cacheKey) } catch { /* ignore */ }
        return
      }

      // Fetch from Supabase
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('wallet_address', walletAddr)
        .single()

      if (data) {
        setProfile(data as DbProfile)
        try { localStorage.setItem(cacheKey, JSON.stringify(data)) } catch { /* ignore */ }
        setShowMintModal(false)
      } else {
        // Fallback: profile exists onchain but not in Supabase — sync from contract
        try {
          const profileData = await publicClient.readContract({
            address: PROFILE_REGISTRY_ADDRESS,
            abi: PROFILE_REGISTRY_ABI,
            functionName: 'getProfile',
            args: [sessionWallet.address],
          }) as [string, string, string, string, bigint]

          const [name, bio, pfpHash, xUsername, mintedAt] = profileData
          const row: DbProfile = {
            wallet_address: walletAddr,
            name: name || '',
            bio: bio || '',
            pfp_url: pfpHash || '',
            x_username: xUsername || '',
            minted_at: new Date(Number(mintedAt) * 1000).toISOString(),
          }
          await supabase.from('profiles').upsert(row, { onConflict: 'wallet_address' })
          await supabase.from('leaderboard').upsert({
            wallet_address: walletAddr,
            name: name || '',
            pfp_url: pfpHash || '',
            total_calls: 0,
            wins: 0,
            losses: 0,
            win_rate: 0,
            total_pnl: 0,
            total_volume: 0,
            is_agent: false,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'wallet_address', ignoreDuplicates: true })

          setProfile(row)
          try { localStorage.setItem(cacheKey, JSON.stringify(row)) } catch { /* ignore */ }
          setShowMintModal(false)
        } catch {
          // If contract read also fails and no cache, clear
          if (!localStorage.getItem(cacheKey)) setProfile(null)
        }
      }
    } catch {
      if (!localStorage.getItem(cacheKey)) setProfile(null)
    } finally {
      setProfileLoading(false)
      setProfileFetched(true)
    }
  }, [sessionWallet])

  // Run profile check on session wallet ready
  useEffect(() => {
    const handler = () => refreshProfile()
    window.addEventListener(EVENT_SESSION_WALLET_READY, handler)
    return () => window.removeEventListener(EVENT_SESSION_WALLET_READY, handler)
  }, [refreshProfile])

  // Check if account has stored session in localStorage
  const hasStoredSession = address
    ? !!localStorage.getItem(`arc_session_pk_${address.toLowerCase()}`)
    : false

  // Trigger profile loading when sessionWallet is ready or account changes
  useEffect(() => {
    if (sessionWallet) {
      refreshProfile()
    } else if (status === 'connected' && !hasStoredSession) {
      setProfile(null)
      setProfileFetched(true)
    } else if (status === 'disconnected') {
      setProfile(null)
      setProfileFetched(true)
    }
  }, [sessionWallet, status, hasStoredSession, refreshProfile])

  // Gate app initialization until min duration + data + wallet/profile state all resolved
  useEffect(() => {
    if (appInitialized) return
    if (!minTimePassed) return
    // Wait for Supabase data to be ready (predictions + leaderboard)
    if (!dataReady) return

    // Still reconnecting / connecting wallet
    if (status === 'reconnecting' || status === 'connecting') return

    if (status === 'disconnected') {
      setAppInitialized(true)
      return
    }

    if (status === 'connected') {
      // If user had a stored session, wait until sessionWallet is derived
      if (hasStoredSession && !sessionWallet) return

      // Wait until profile query finishes
      if (profileLoading || !profileFetched) return

      setAppInitialized(true)
    }
  }, [appInitialized, minTimePassed, dataReady, status, hasStoredSession, sessionWallet, profileLoading, profileFetched])

  // Safety net: after 8s unblock no matter what so app never gets stuck
  useEffect(() => {
    const t = setTimeout(() => setAppInitialized(true), 8000)
    return () => clearTimeout(t)
  }, [])

  // Reset on disconnect
  useEffect(() => {
    if (!address) {
      setProfile(null)
      setShowMintModal(false)
    }
  }, [address])

  const updateProfileData = useCallback((patch: Partial<DbProfile>) => {
    setProfile(prev => {
      if (!prev) return prev
      const updated = { ...prev, ...patch }
      if (sessionWallet?.address) {
        try {
          localStorage.setItem(PROFILE_CACHE_KEY + sessionWallet.address.toLowerCase(), JSON.stringify(updated))
        } catch { /* ignore */ }
      }
      return updated
    })
  }, [sessionWallet])

  return (
    <ProfileContext.Provider value={{
      profile,
      profileLoading,
      showMintModal,
      navState,
      appInitialized,
      refreshProfile,
      updateProfileData,
      setShowMintModal,
    }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile() {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider')
  return ctx
}
