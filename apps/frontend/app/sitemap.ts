import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/blog'
import { SITE_URL } from '@/lib/site'

/** Public pages only: everything else needs a login. */
export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts()
  return [
    { url: `${SITE_URL}/`, priority: 1 },
    { url: `${SITE_URL}/blog`, lastModified: posts[0]?.date, priority: 0.8 },
    { url: `${SITE_URL}/analyst/demo`, priority: 0.6 },
    ...posts.map(p => ({ url: `${SITE_URL}/blog/${p.slug}`, lastModified: p.date, priority: 0.7 })),
    { url: `${SITE_URL}/privacy`, priority: 0.1 },
    { url: `${SITE_URL}/terms`, priority: 0.1 },
  ]
}
