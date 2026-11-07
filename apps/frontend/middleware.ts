import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher(['/', '/blog(.*)', '/privacy', '/terms', '/sign-in(.*)', '/sign-up(.*)', '/analyst/demo'])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) await auth.protect()
})

export const config = {
  matcher: ['/((?!_next|[^?]*\\.[^?]*$).*)'],
}
