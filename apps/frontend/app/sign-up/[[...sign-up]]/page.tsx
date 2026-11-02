import type { Metadata } from 'next'
import { SignUp } from '@clerk/nextjs'
import AuthShell, { clerkAppearance } from '@/components/landing/AuthShell'

export const metadata: Metadata = { title: 'Create your account | Slipstream' }

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your Slipstream account"
      lede="Keep your race analysis and agent conversations in one place."
    >
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" appearance={clerkAppearance} />
    </AuthShell>
  )
}
