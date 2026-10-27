import { useState } from 'react'
import { Check, Facebook, Link2, MessageSquare, Share2 } from 'lucide-react'
import { track } from '../lib/track'

// One-tap sharing. `jobId` shares /jobs/<id>; without it the current page is
// shared. Every shared URL carries utm_source=share&utm_medium=<how> so the
// first-party analytics can tell which channel brought a visitor back.
const buttonClass =
  'inline-flex h-11 min-w-[44px] items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/85 px-3 text-sm font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-300'

function urlFor(jobId, medium) {
  const url = new URL(jobId ? `/jobs/${jobId}` : window.location.pathname, window.location.origin)
  url.searchParams.set('utm_source', 'share')
  url.searchParams.set('utm_medium', medium)
  return url.toString()
}

export default function ShareButtons({ title, jobId = null, compact = false, className = '' }) {
  const [copied, setCopied] = useState(false)
  const label = compact ? 'sr-only' : ''
  const canNative = typeof navigator.share === 'function'
  const isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '')

  const sent = () => track('share', jobId ? { job_id: jobId } : {})

  async function nativeShare() {
    sent()
    try {
      await navigator.share({ title, text: title, url: urlFor(jobId, 'native') })
    } catch {
      /* dismissed the share sheet */
    }
  }

  async function copyLink() {
    sent()
    const url = urlFor(jobId, 'copy')
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {canNative && (
        <button type="button" onClick={nativeShare} aria-label="Share" className={buttonClass}>
          <Share2 className="h-4 w-4 shrink-0" />
          <span className={label}>Share</span>
        </button>
      )}
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(urlFor(jobId, 'facebook'))}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={sent}
        aria-label="Share on Facebook"
        className={buttonClass}
      >
        <Facebook className="h-4 w-4 shrink-0" />
        <span className={label}>Facebook</span>
      </a>
      {isMobile && (
        <a
          href={`sms:?&body=${encodeURIComponent(`${title} ${urlFor(jobId, 'sms')}`)}`}
          onClick={sent}
          aria-label="Share by text message"
          className={buttonClass}
        >
          <MessageSquare className="h-4 w-4 shrink-0" />
          <span className={label}>Text</span>
        </a>
      )}
      <button type="button" onClick={copyLink} aria-label={copied ? 'Link copied' : 'Copy link'} className={buttonClass}>
        {copied ? <Check className="h-4 w-4 shrink-0 text-cyan-300" /> : <Link2 className="h-4 w-4 shrink-0" />}
        <span className={label}>{copied ? 'Copied' : 'Copy link'}</span>
      </button>
    </div>
  )
}
