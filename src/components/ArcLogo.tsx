import React from 'react'

interface ArcLogoProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

export default function ArcLogo({ size = 32, className, style }: ArcLogoProps) {
  const [failed, setFailed] = React.useState(false)

  // Once the real PNG is in /public/arc-logo.png this renders perfectly.
  // If the file is missing, renders nothing — no broken icon, no placeholder SVG.
  if (failed) {
    return (
      <span
        className={className}
        style={{ display: 'inline-block', width: size, height: size, ...style }}
      />
    )
  }

  return (
    <img
      src="/arc-logo.png"
      alt="Arc"
      width={size}
      height={size}
      className={className}
      draggable={false}
      onError={() => setFailed(true)}
      style={{ objectFit: 'contain', display: 'block', ...style }}
    />
  )
}
