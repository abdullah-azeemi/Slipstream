/**
 * Client-side Clerk JWT holder.
 *
 * Clerk tokens live on the browser only; Server Components must obtain their
 * own token via `auth()` from `@clerk/nextjs/server`. This module is imported
 * by both runtimes, but only the client ever populates it — server code falls
 * back to an explicit `token` argument passed into the api helpers.
 */
let authToken: string | null = null

export function setAuthToken(token: string | null): void {
  authToken = token
}

export function getAuthToken(): string | null {
  return authToken
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}