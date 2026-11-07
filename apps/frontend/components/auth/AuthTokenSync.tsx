'use client'

import { useAuth } from '@clerk/nextjs'
import { useCallback, useEffect } from 'react'
import {
  authTokenExpiresAt,
  setAuthToken,
  setAuthTokenRefresher,
} from '@/lib/auth-token'

/**
 * Syncs the signed-in user's Clerk JWT into the shared client token holder so
 * api.ts and raw fetches can attach `Authorization` to protected product APIs.
 * Mounted once inside ClerkProvider in the root layout.
 *
 * Clerk session JWTs are short lived (one minute by default), so the token is
 * refreshed shortly before its `exp` claim and whenever the tab regains
 * focus/visibility. Without this a long-idle tab keeps sending an expired JWT
 * and the API answers "Invalid token: Signature has expired".
 */
const FALLBACK_REFRESH_MS = 45_000
/** Refresh this long before expiry, to cover clock drift and request time. */
const EXPIRY_SKEW_MS = 30_000

export default function AuthTokenSync() {
  const { getToken, isLoaded } = useAuth()

  const requestToken = useCallback(
    (skipCache = false) => getToken(skipCache ? { skipCache: true } : undefined),
    [getToken],
  )

  useEffect(() => {
    if (!isLoaded) return
    let active = true
    let timer: number | undefined

    // Register the bridge used by `fetchWithAuth`, which may need a token at any
    // time (including right before a retry after a 401).
    setAuthTokenRefresher(async (options) => {
      const token = await requestToken(Boolean(options?.skipCache))
      if (active && token) setAuthToken(token)
      return token
    })

    const sync = async (skipCache = false) => {
      try {
        const token = await requestToken(skipCache)
        if (active && token) setAuthToken(token)
      } catch {
        // Keep the previous token; the next scheduled refresh will try again.
      }
    }

    const schedule = () => {
      window.clearTimeout(timer)
      const expiresAt = authTokenExpiresAt()
      const delay = expiresAt
        ? Math.max(expiresAt - Date.now() - EXPIRY_SKEW_MS, 10_000)
        : FALLBACK_REFRESH_MS
      timer = window.setTimeout(() => {
        // Force a network refresh: Clerk may still consider the cached token
        // valid even when it is only seconds from expiring.
        void sync(true).then(schedule)
      }, delay)
    }

    void sync().then(schedule)

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void sync(true).then(schedule)
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)

    return () => {
      active = false
      setAuthTokenRefresher(null)
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [isLoaded, requestToken])

  return null
}
