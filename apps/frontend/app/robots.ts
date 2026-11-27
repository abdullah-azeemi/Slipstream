import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    // Signed-in pages return 404 to crawlers anyway; this keeps them from trying.
    rules: { userAgent: '*', allow: ['/', '/blog', '/analyst/demo', '/privacy', '/terms'], disallow: ['/sign-in', '/sign-up'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
