export default function Footer() {
  const links = [
    { label: 'Arc', href: 'https://www.arc.io/' },
    { label: 'Arc X', href: 'https://x.com/arc' },
    { label: 'Arc Studio', href: 'https://studio.arc.io/' },
    { label: 'Arc Community', href: 'https://community.arc.io/home' },
  ]

  return (
    <footer style={{
      borderTop: '1px solid var(--border-subtle)',
      padding: '20px 24px',
      position: 'relative',
      zIndex: 10,
      background: 'transparent',
      width: '100%',
      flexShrink: 0,
    }}>
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500, fontFamily: 'var(--font-mono, monospace)' }}>
          Built on Arc
        </span>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {links.map(l => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                transition: 'color 200ms ease',
                textDecoration: 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
