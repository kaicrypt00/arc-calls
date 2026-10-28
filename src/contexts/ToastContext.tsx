import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { EXPLORER_URL } from '../config'

type ToastType = 'pending' | 'confirmed' | 'failed'

interface Toast {
  id: string
  type: ToastType
  message: string
  txHash?: string
}

interface ToastContextValue {
  showPending: (message: string) => string
  showConfirmed: (txHash?: string, message?: string) => void
  showFailed: (error: string) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showPending = useCallback((message: string) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev.filter(t => t.type !== 'pending'), { id, type: 'pending', message }])
    return id
  }, [])

  const showConfirmed = useCallback((txHash?: string, message: string = '') => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev.filter(t => t.type !== 'pending'), { id, type: 'confirmed', message, txHash }])
    setTimeout(() => remove(id), 8000)
  }, [remove])

  const showFailed = useCallback((error: string) => {
    let msg = error || 'Transaction failed'
    const lower = msg.toLowerCase()
    if (lower.includes('bets are lo') || lower.includes('betting is locked') || lower.includes('locked')) {
      msg = 'Betting is closed on this market.'
    } else if (lower.includes('already placed') || lower.includes('already bet')) {
      msg = "You've already placed a call on this market."
    } else if (lower.includes('insufficient')) {
      msg = 'Insufficient USDC balance.'
    }
    const id = crypto.randomUUID()
    setToasts(prev => [...prev.filter(t => t.type !== 'pending'), { id, type: 'failed', message: msg }])
    setTimeout(() => remove(id), 6000)
  }, [remove])

  const dismiss = useCallback((id: string) => remove(id), [remove])

  return (
    <ToastContext.Provider value={{ showPending, showConfirmed, showFailed, dismiss }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <ToastNotification key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

function ToastNotification({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div className={`toast toast-${t.type}`} onClick={onDismiss}>
      <div className="toast-icon">
        {t.type === 'pending' && <div className="spinner" />}
        {t.type === 'confirmed' && (
          <svg viewBox="0 0 20 20" fill="none" width="20" height="20" style={{ color: 'var(--yes-color)' }}>
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 10l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {t.type === 'failed' && (
          <svg viewBox="0 0 20 20" fill="none" width="20" height="20" style={{ color: 'var(--no-color)' }}>
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div className="toast-content">
        <div className="toast-title">{t.message}</div>
        {t.type === 'pending' && (
          <div className="toast-subtitle">Please wait, do not close this page</div>
        )}
        {t.type === 'confirmed' && t.txHash && (
          <a
            className="toast-link"
            href={`${EXPLORER_URL}/tx/${t.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >
            View on Arc Explorer →
          </a>
        )}
      </div>
    </div>
  )
}
