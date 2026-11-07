/**
 * Client-side Clerk JWT holder.
 *
 * Clerk session tokens are short lived (one minute by default). Caching one in
 * this module for several minutes meant later API calls sent an expired JWT and
 * the API answered 401 "Invalid token: Signature has expired" — usually seen
 * when a session page is opened after the tab has been idle. Anything that calls
 * a protected API now goes through `fetchWithAuth`, which checks the token's
 * `exp` claim, asks Clerk for a new token when needed, and retries once if the
 * API still rejects it.
 *
 * Clerk tokens live on the browser only; Server Components must obtain their
 * own token via `auth()` from `@clerk/nextjs/server`. This module is imported
 * by both runtimes, but only the client ever populates it — server code falls
 * back to an explicit `token` argument passed into the api helpers.
 */

type TokenRefresher = (options?: { skipCache?: boolean }) => Promise<string | null>

let authToken: string | null = null
let refresher: TokenRefresher | null = null
let waiters: Array<(t: string) => void> = []

/** Refresh this long before the JWT expires, to cover clock drift and latency. */
const EXPIRY_SKEW_MS = 30_000

export function setAuthToken(token: string | null): void {
  authToken = token
  if (token) {
    waiters.forEach((w) => w(token))
    waiters = []
  }
}

/** Registers the Clerk `getToken` bridge. Called once by AuthTokenSync. */
export function setAuthTokenRefresher(fn: TokenRefresher | null): void {
  refresher = fn
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload || typeof atob !== 'function') return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(normalized)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Unix timestamp (ms) at which the token expires, or null if it cannot be read. */
export function authTokenExpiresAt(token: string | null = authToken): number | null {
  if (!token) return null
  const exp = decodePayload(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : null
}

export function isTokenExpired(token: string, skewMs = EXPIRY_SKEW_MS): boolean {
  const expiresAt = authTokenExpiresAt(token)
  if (expiresAt == null) return false
  return Date.now() >= expiresAt - skewMs
}

/** Resolves once a token exists (or null after the timeout), so early requests do not 401. */
export function whenAuthToken(timeoutMs = 4000): Promise<string | null> {
  if (authToken) return Promise.resolve(authToken)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    waiters.push((t) => {
      clearTimeout(timer)
      resolve(t)
    })
  })
}

/** Forces Clerk to issue a token (bypassing its cache when `force` is set). */
export async function refreshAuthToken(force = false): Promise<string | null> {
  if (!refresher) return authToken
  try {
    const token = await refresher(force ? { skipCache: true } : undefined)
    if (token) setAuthToken(token)
    return token ?? authToken
  } catch {
    return authToken
  }
}

/** A token that is safe to send right now, refreshing it first when it is stale. */
export async function getFreshAuthToken(): Promise<string | null> {
  if (authToken && !isTokenExpired(authToken)) return authToken
  if (refresher) return refreshAuthToken(true)
  return whenAuthToken()
}

export function getAuthToken(): string | null {
  return authToken
}

/** Bearer header for a token already known to be fresh. Prefer `fetchWithAuth`. */
export function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * `fetch` with a fresh Clerk token attached. If the API still answers 401 the
 * token is refreshed once (skipping Clerk's cache) and the request is retried.
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
  }

  const token = await getFreshAuthToken()
  const response = await send(token)
  if (response.status !== 401) return response

  const fresh = await refreshAuthToken(true)
  if (!fresh || fresh === token) return response
  return send(fresh)
}
