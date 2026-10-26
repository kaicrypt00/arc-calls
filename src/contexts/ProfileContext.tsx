import {
  createContext, useContext, useState, useEffect, useCallback, ReactNode
} from 'react'
import { useAccount } from 'wagmi'
import { publicClient } from './SessionWalletContext'
import { useSessionWallet } from './SessionWalletContext'
import { PROFILE_REGISTRY_ADDRESS, EVENT_SESSION_WALLET_READY } from '../constants'
import { PROFILE_REGISTRY_ABI } from '../abis'
import { supabase, type DbProfile } from '../lib/supabase'

interface ProfileContextValue {
  profile: DbProfile | null
  showMintModal: boolean
  navState: 1 | 2 | 3
  appInitialized: boolean
  refreshProfile: () => Promise<void>
  updateProfileData: (patch: Partial<DbProfile>) => void
  setShowMintModal: (v: boolean) => void
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const { sessionWallet, hasSessionWallet } = useSessionWallet()

  const [profile, setProfile] = useState<DbProfile | null>(null)
  const [showMintModal, setShowMintModal] = useState(false)
  const [appInitialized, setAppInitialized] = useState(false)

  // navState: 1 = not connected, 2 = connected+session but no profile, 3 = fully onboarded
  let navState: 1 | 2 | 3 = 1
  if (isConnected && hasSessionWallet && profile) navState = 3
  else if (isConnected && hasSessionWallet) navState = 2
  else navState = 1

  const refreshProfile = useCallback(async () => {
    if (!sessionWallet?.address) {
      setProfile(null)
      return
    }
    try {
      // Check onchain first
      const hasOnchain = PROFILE_REGISTRY_ADDRESS
        ? await publicClient.readContract({
            address: PROFILE_REGISTRY_ADDRESS,
            abi: PROFILE_REGISTRY_ABI,
            functionName: 'hasProfile',
            args: [sessionWallet.address],
          })
        : false

      if (!hasOnchain) {
        setProfile(null)
        // Never auto-open modal — user must click Set Up Profile themselves
        return
      }

      // Fetch from Supabase
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('wallet_address', sessionWallet.address.toLowerCase())
        .single()

      if (data) {
        setProfile(data as DbProfile)
        setShowMintModal(false)
      } else {
        setProfile(null)
        // No auto-open — let user trigger it
      }
    } catch {
      setProfile(null)
    }
  }, [sessionWallet])

  // Run profile check on session wallet ready
  useEffect(() => {
    const handler = () => refreshProfile()
    window.addEventListener(EVENT_SESSION_WALLET_READY, handler)
    return () => window.removeEventListener(EVENT_SESSION_WALLET_READY, handler)
  }, [refreshProfile])

  // Run on sessionWallet change
  useEffect(() => {
    if (sessionWallet) {
      refreshProfile().finally(() => setAppInitialized(true))
    } else if (!isConnected) {
      setProfile(null)
      setShowMintModal(false)
      setAppInitialized(true)
    } else {
      setAppInitialized(true)
    }
  }, [sessionWallet, isConnected, refreshProfile])

  // Reset on disconnect
  useEffect(() => {
    if (!address) {
      setProfile(null)
      setShowMintModal(false)
    }
  }, [address])

  const updateProfileData = useCallback((patch: Partial<DbProfile>) => {
    setProfile(prev => prev ? { ...prev, ...patch } : prev)
  }, [])

  return (
    <ProfileContext.Provider value={{
      profile,
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
