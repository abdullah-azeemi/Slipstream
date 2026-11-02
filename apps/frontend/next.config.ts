import type { NextConfig } from 'next'

if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  // Without it every browser calls http://localhost:8000, so live stats and all API views fail.
  console.warn('[slipstream] NEXT_PUBLIC_API_URL is not set. Set it to the backend URL for production builds.')
}

const nextConfig: NextConfig = {
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
