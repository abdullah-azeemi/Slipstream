import type { Metadata } from 'next'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'
import PostCard from '@/components/landing/PostCard'
import { getAllPosts } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'Blog | Slipstream',
  description: 'Build notes, race breakdowns and guides to the Pitwall agent from the Slipstream project.',
}

export default function BlogIndex() {
  const posts = getAllPosts()
  return (
    <div className={`lp ${geist.className}`}>
      <LandingNav />
      <div id="main" className="section" style={{ paddingTop: 'calc(var(--sp-900) + var(--sp-600))' }}>
        <div className="wrap">
          <div className="section-head">
            <p className="caption-1 muted">Blog</p>
            <h1 className="heading-2">Notes from the pit wall</h1>
            <p className="body-3">Build notes, race breakdowns and guides to the Pitwall agent.</p>
          </div>
          {posts.length > 0 ? (
            <div className="grid-3">
              {posts.map(p => <PostCard key={p.slug} post={p} />)}
            </div>
          ) : (
            <div className="empty">
              <h2 className="heading-6">The first posts are on the way</h2>
              <p className="body-6">Follow the project on GitHub to hear when they land.</p>
            </div>
          )}
        </div>
      </div>
      <LandingFooter />
    </div>
  )
}
