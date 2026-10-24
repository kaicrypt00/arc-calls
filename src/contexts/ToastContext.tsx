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
  showConfirmed: (txHash: string, message: string) => void
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
    setToasts(prev => [...prev, { id, type: 'pending', message }])
    return id
  }, [])

  const showConfirmed = useCallback((txHash: string, message: string) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev.filter(t => t.type !== 'pending'), { id, type: 'confirmed', message, txHash }])
    setTimeout(() => remove(id), 5000)
  }, [remove])

  const showFailed = useCallback((error: string) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev.filter(t => t.type !== 'pending'), { id, type: 'failed', message: error }])
    setTimeout(() => remove(id), 5000)
  }, [remove])

  const dismiss = useCallback((id: string) => remove(id), [remove])

  const icons: Record<ToastType, string> = {
    pending: '⏳',
    confirmed: '✅',
    failed: '❌',
  }

  return (
    <ToastContext.Provider value={{ showPending, showConfirmed, showFailed, dismiss }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => remove(t.id)} style={{ cursor: 'pointer' }}>
            <span className="toast-icon">{icons[t.type]}</span>
            <div className="toast-body">
              <div className="toast-title">
                {t.type === 'pending' ? 'Confirming...' : t.type === 'confirmed' ? 'Confirmed' : 'Failed'}
              </div>
              <div className="toast-msg">{t.message}</div>
              {t.txHash && (
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
