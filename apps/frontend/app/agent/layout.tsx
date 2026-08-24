import { auth } from '@clerk/nextjs/server'

export default async function AgentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await auth.protect()
  return <>{children}</>
}
