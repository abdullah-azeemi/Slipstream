import { clerkMiddleware } from '@clerk/nextjs/server'

// Provides auth context to server components (layouts, pages, routes).
// Protection lives in app/agent/layout.tsx via auth.protect() — the
// resource-based pattern Clerk recommends over path matching here.
export default clerkMiddleware()

export const config = {
  matcher: ['/((?!_next|[^?]*\\.[^?]*$).*)'],
}
