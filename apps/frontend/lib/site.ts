/**
 * Absolute site URL for canonical links, the sitemap and share images.
 * NEXT_PUBLIC_SITE_URL wins; on Vercel the production domain is the fallback, so share
 * images never point at localhost when the variable is missing.
 */
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? (vercelHost ? `https://${vercelHost}` : 'http://localhost:3000')
).replace(/\/+$/, '')

export const SITE_NAME = 'Slipstream'
