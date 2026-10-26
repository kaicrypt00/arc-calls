import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          padding: 24, borderRadius: 16,
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          color: '#f87171', fontSize: 13,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <strong>Something went wrong</strong>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
            {this.state.error?.message ?? 'Unknown error'}
          </span>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 4, padding: '6px 14px', borderRadius: 8,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171', cursor: 'pointer', fontSize: 12, width: 'fit-content',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
