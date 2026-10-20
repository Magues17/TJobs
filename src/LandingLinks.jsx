import { landingPages } from '../shared/landingPages.js'

// Row of links to the town/category landing pages. Real hrefs so crawlers
// follow them; clicks stay in the SPA through onNavigate(slug).
export default function LandingLinks({ heading, currentSlug = null, onNavigate, className = 'mt-6' }) {
  return (
    <nav aria-label={heading} className={`${className} rounded-[24px] border border-slate-800 bg-slate-900/70 p-4 sm:p-5`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{heading}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {landingPages
          .filter((page) => page.slug !== currentSlug)
          .map((page) => (
            <a
              key={page.slug}
              href={page.path}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                event.preventDefault()
                onNavigate(page.slug)
              }}
              className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-300"
            >
              {page.h1}
            </a>
          ))}
      </div>
    </nav>
  )
}
