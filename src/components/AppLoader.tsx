import { useEffect, useState } from 'react'
import { useProfile } from '../contexts/ProfileContext'
import ArcLogo from './ArcLogo'

export default function AppLoader({ children }: { children: React.ReactNode }) {
  const { appInitialized } = useProfile()
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (appInitialized) {
      const t = setTimeout(() => setVisible(false), 400)
      return () => clearTimeout(t)
    }
  }, [appInitialized])

  return (
    <>
      {visible && (
        <div className={`app-loader${appInitialized ? ' fade-out' : ''}`}>
          <ArcLogo size={64} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
              Arc Calls
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              Community Prediction Platform
            </div>
          </div>
          <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
        </div>
      )}
      {children}
    </>
  )
}
