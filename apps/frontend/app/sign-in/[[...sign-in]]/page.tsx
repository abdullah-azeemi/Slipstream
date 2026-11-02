import type { Metadata } from 'next'
import { SignIn } from '@clerk/nextjs'
import AuthShell, { clerkAppearance } from '@/components/landing/AuthShell'

export const metadata: Metadata = { title: 'Sign in | Slipstream' }

export default function SignInPage() {
  return (
    <AuthShell
      title="Welcome back to the pit wall"
      lede="Sign in to pick up your telemetry comparisons, strategy views and Pitwall conversations."
    >
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" appearance={clerkAppearance} />
    </AuthShell>
  )
}
