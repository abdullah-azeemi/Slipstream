'use client'

import { useAuth } from '@clerk/nextjs'
import { useEffect } from 'react'
import { setAuthToken } from '@/lib/auth-token'

/**
 * Syncs the signed-in user's Clerk JWT into the shared client token holder so
 * api.ts and raw fetches can attach `Authorization` to protected product APIs.
 * Mounted once inside ClerkProvider in the root layout.
 */
export default function AuthTokenSync() {
  const { getToken, isLoaded } = useAuth()

  useEffect(() => {
    if (!isLoaded) return
    let active = true
    getToken()
      .then(token => {
        if (active) setAuthToken(token)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [getToken, isLoaded])

  return null
}