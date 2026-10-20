import { useCallback, useEffect, useState } from 'react'
import { approveClaim, loadClaimRequests, loadFeaturedOrders, rejectClaim } from './api'

const money = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`
const when = (value) => (value ? new Date(value).toLocaleString() : '-')
const btn = 'rounded-2xl border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60'

// Admin dashboard: claim queue and featured orders. Loads its own data.
export default function AdminFeaturedPanel({ Card, refreshKey }) {
  const [claims, setClaims] = useState([])
  const [orders, setOrders] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState({ text: '', error: false })

  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([loadClaimRequests(), loadFeaturedOrders()])
      setClaims(c.claims || [])
      setOrders(o.orders || [])
    } catch (error) {
      setMessage({ text: error.message, error: true })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function act(claim, approve) {
    const reason = approve ? '' : window.prompt('Optional note to include in the rejection email:', '')
    if (reason === null) return
    if (approve && !window.confirm(`Create a login for ${claim.email} on ${claim.business_name}?`)) return
    setBusyId(claim.id)
    try {
      const data = approve ? await approveClaim(claim.id) : await rejectClaim(claim.id, reason)
      setMessage({ text: `${approve ? 'Approved' : 'Rejected'}. Email ${data.email_sent ? 'sent' : 'NOT sent (mail not configured)'}.`, error: false })
      await load()
    } catch (error) {
      setMessage({ text: error.message, error: true })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Listing claims">
        {message.text ? <p className={`mb-3 text-sm ${message.error ? 'text-rose-300' : 'text-emerald-300'}`}>{message.text}</p> : null}
        {!claims.length ? (
          <p className="text-sm text-slate-400">No claim requests yet.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {claims.map((claim) => (
              <li key={claim.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">{claim.business_name} (employer #{claim.employer_id})</span>
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-400">{claim.status}</span>
                </div>
                <div className="mt-1 text-slate-300">
                  {claim.name} &lt;{claim.email}&gt;{claim.role ? `, ${claim.role}` : ''}{claim.phone ? `, ${claim.phone}` : ''}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Says organization: {claim.organization || '-'} | Job #{claim.job_id}: {claim.job_title || '-'} | {when(claim.created_at)}
                </div>
                <div className="mt-1 text-xs">
                  <span className={claim.domain_match ? 'text-emerald-300' : 'text-amber-300'}>
                    Email domain {claim.domain_match ? 'matches' : 'does NOT match'}
                  </span>
                  <span className="text-slate-500"> {claim.website || ''} {claim.source_url || ''}</span>
                </div>
                {claim.login_count ? <div className="mt-1 text-xs text-amber-300">This employer already has {claim.login_count} login(s).</div> : null}
                {claim.message ? <p className="mt-2 whitespace-pre-line text-slate-300">{claim.message}</p> : null}
                {claim.status === 'pending' ? (
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busyId === claim.id} onClick={() => act(claim, true)} className={`${btn} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`}>Approve</button>
                    <button type="button" disabled={busyId === claim.id} onClick={() => act(claim, false)} className={`${btn} border-rose-500/30 bg-rose-500/10 text-rose-200`}>Reject</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Featured orders">
        {!orders.length ? (
          <p className="text-sm text-slate-400">No featured orders yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {orders.map((order) => (
              <li key={order.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-white">{order.job_title || `Job #${order.job_id}`}</span>
                  <span className={order.status === 'paid' ? 'text-emerald-300' : 'text-slate-400'}>{order.status} {money(order.price_cents)}</span>
                </div>
                <div className="text-xs text-slate-400">
                  {order.business_name} | {order.weeks} week(s) | ordered {when(order.created_at)}
                  {order.paid_at ? ` | paid ${when(order.paid_at)}` : ''}
                  {order.featured_until ? ` | featured until ${when(order.featured_until)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
