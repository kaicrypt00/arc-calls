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
      padding: '24px 24px 80px',  // extra bottom padding to clear the studio watermark
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 16,
      position: 'relative',
      zIndex: 10,
      background: 'transparent',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>
        Built on Arc
      </span>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
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
    </footer>
  )
}
