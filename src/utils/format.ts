export function shortAddress(addr: string): string {
  if (!addr) return ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function calcOdds(yesPool: number, noPool: number) {
  const total = yesPool + noPool
  if (total === 0) return { yesPct: 50, noPct: 50, yesMulti: '2.00x', noMulti: '2.00x' }
  const yesPct = Math.round((yesPool / total) * 100)
  const noPct = 100 - yesPct
  const yesMulti = yesPool > 0 ? (total / yesPool).toFixed(2) + 'x' : '—'
  const noMulti = noPool > 0 ? (total / noPool).toFixed(2) + 'x' : '—'
  return { yesPct, noPct, yesMulti, noMulti }
}

export function formatCountdown(secondsLeft: number): { text: string; level: 'danger' | 'warning' | 'normal' | 'closed' } {
  if (secondsLeft <= 0) return { text: 'Expired', level: 'closed' }
  if (secondsLeft < 3600) {
    const m = Math.floor(secondsLeft / 60)
    const s = secondsLeft % 60
    return { text: `${m}m ${s}s`, level: 'danger' }
  }
  if (secondsLeft < 86400) {
    const h = Math.floor(secondsLeft / 3600)
    const m = Math.floor((secondsLeft % 3600) / 60)
    return { text: `${h}h ${m}m`, level: 'warning' }
  }
  const d = Math.floor(secondsLeft / 86400)
  const h = Math.floor((secondsLeft % 86400) / 3600)
  return { text: `${d}d ${h}h`, level: 'normal' }
}

export function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export function buildXShareUrl(text: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
}

export function formatMonthYear(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/**
 * Resize image client-side using canvas → compact JPEG data URL.
 * Max 200px on longest side, quality 0.72, input capped at 1.5 MB.
 */
export function imageToDataUrl(file: File, maxPx = 200, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 1.5 * 1024 * 1024) {
      reject(new Error(`Image too large. Max 1.5 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB.`))
      return
    }
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not available')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')) }
    img.src = objectUrl
  })
}

export function validateBetAmount(amount: string): string | null {
  const n = parseFloat(amount)
  if (!amount || isNaN(n)) return 'Enter an amount'
  if (n <= 0) return 'Amount must be greater than 0'
  if (n < 0.1) return 'Minimum call is 0.1 USDC'
  return null
}
