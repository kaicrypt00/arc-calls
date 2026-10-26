import { Routes, Route, Navigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { Suspense, useEffect } from 'react'
import ParticleBackground from './components/ParticleBackground'
import AppLoader from './components/AppLoader'
import MintProfileModal from './components/MintProfileModal'
import LandingPage from './pages/LandingPage'
import CallsPage from './pages/CallsPage'
import LeaderboardPage from './pages/LeaderboardPage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/AdminPage'
import { ADMIN_WALLETS } from './constants'
import { useDataCache } from './contexts/DataPrefetchContext'
import { useProfile } from './contexts/ProfileContext'

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { address } = useAccount()
  const isAdmin = address ? ADMIN_WALLETS.includes(address.toLowerCase() as typeof ADMIN_WALLETS[number]) : false
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

// Warms the data cache exactly once after app is initialized
function CacheWarmer() {
  const { warmCache } = useDataCache()
  const { appInitialized } = useProfile()
  useEffect(() => {
    if (appInitialized) warmCache()
  }, [appInitialized]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function App() {
  return (
    <>
      <div className="navbar-sweep-glow" />
      <ParticleBackground />
      <AppLoader>
        <MintProfileModal />
        <CacheWarmer />
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/calls" element={<CallsPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/admin" element={<AdminGuard><AdminPage /></AdminGuard>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppLoader>
    </>
  )
}
