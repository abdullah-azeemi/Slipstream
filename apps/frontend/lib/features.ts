/**
 * Feature switches. The drivers pages are not ready for production yet, so they
 * are off there and on everywhere else (local dev, tests).
 * Turn them on in production by setting NEXT_PUBLIC_SHOW_DRIVERS=true and redeploying.
 */
export function driversPageEnabled(
  env: { NODE_ENV?: string; NEXT_PUBLIC_SHOW_DRIVERS?: string } = process.env,
): boolean {
  return env.NODE_ENV !== 'production' || env.NEXT_PUBLIC_SHOW_DRIVERS === 'true'
}

export const DRIVERS_PAGE_ENABLED = driversPageEnabled()
