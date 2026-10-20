import { Star } from 'lucide-react'

export default function FeaturedBadge({ job, className = '' }) {
  if (!job?.featured) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200 ${className}`}>
      <Star className="h-3 w-3" /> Featured
    </span>
  )
}
