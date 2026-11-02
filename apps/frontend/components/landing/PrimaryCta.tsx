'use client'

import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'
import { ArrowRight } from '@phosphor-icons/react'

/** The main call to action. Signed in visitors go to the dashboard instead of sign up. */
export default function PrimaryCta({ size = 'button-lg' }: { size?: 'button-lg' | 'button-md' }) {
  const { isLoaded, isSignedIn } = useAuth()
  const signedIn = isLoaded && isSignedIn
  return (
    <Link href={signedIn ? '/dashboard' : '/sign-up'} className={`btn btn-primary ${size}`}>
      {signedIn ? 'Open dashboard' : 'Create free account'}{' '}
      <ArrowRight size={size === 'button-lg' ? 20 : 16} weight="bold" aria-hidden="true" />
    </Link>
  )
}
