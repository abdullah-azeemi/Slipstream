'use client'

import { use, useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import DriverHero from '@/components/drivers/DriverHero'
import { api, APIError } from '@/lib/api'
import { normaliseDriverCode } from '@/lib/driver-image'
import type { DriverProfile } from '@/types/f1'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; profile: DriverProfile }

export default function DriverPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params)
  const code = normaliseDriverCode(raw)
  const { getToken, isLoaded } = useAuth()
  const [state, setState] = useState<State>(
    code ? { status: 'loading' } : { status: 'error', message: 'That is not a valid driver code.' },
  )

  useEffect(() => {
    if (!code || !isLoaded) return
    let cancelled = false
    // Ask Clerk directly: the shared token holder is filled asynchronously and
    // can still be empty on the first render.
    getToken()
      .then(token => api.drivers.profile(code, token))
      .then(profile => !cancelled && setState({ status: 'ok', profile }))
      .catch(e => {
        if (cancelled) return
        setState({
          status: 'error',
          message: e instanceof APIError && e.status === 404
            ? `No data for ${code.toUpperCase()} yet.`
            : e instanceof APIError && e.status === 401
              ? 'Please sign in again to view this driver.'
              : 'Could not load this driver. Try again shortly.',
        })
      })
    return () => { cancelled = true }
  }, [code, getToken, isLoaded])

  return (
    state.status === 'ok' ? (
      <DriverHero profile={state.profile} />
    ) : (
      <p className="dp-state" role="status" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
        {state.status === 'loading' ? 'Loading driver...' : state.message}
      </p>
    )
  )
}
