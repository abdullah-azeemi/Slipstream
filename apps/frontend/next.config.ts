import type { NextConfig } from 'next'

if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  // Without it every browser calls http://localhost:8000, so live stats and all API views fail.
  console.warn('[slipstream] NEXT_PUBLIC_API_URL is not set. Set it to the backend URL for production builds.')
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

const nextConfig: NextConfig = {
  // Two `next dev` servers must not share one build folder; set NEXT_DIST_DIR for the second.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The original /agent page was replaced by the analyst canvas; keep old links working.
  async redirects() {
    return [{ source: '/agent', destination: '/analyst', permanent: false }]
  },
  // The private driver cutouts are not in the repo, so the deployed site gets them from the
  // API (stored in R2). A file in public/drivers still wins locally; this only runs when
  // there is none. It must be afterFiles: the dynamic /drivers/[code] page would match first.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        { source: '/drivers/:code([a-z]{2,4}).png', destination: `${API_URL}/api/v1/drivers/:code/image` },
      ],
      fallback: [],
    }
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
}

export default nextConfig
