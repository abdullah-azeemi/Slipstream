import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'
import { formatDate, getAllPosts, getPost } from '@/lib/blog'

type Params = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return getAllPosts().map(p => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const post = getPost((await params).slug)
  if (!post) return { title: 'Post not found | Slipstream' }
  return {
    title: `${post.title} | Slipstream`,
    description: post.summary,
    openGraph: { title: post.title, description: post.summary, type: 'article', publishedTime: post.date },
  }
}

export default async function PostPage({ params }: Params) {
  const post = getPost((await params).slug)
  if (!post) notFound()

  return (
    <div className={`lp ${geist.className}`}>
      <LandingNav />
      <div id="main" className="wrap">
        <article className="article">
          <Link href="/blog" className="back body-5">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" /> All posts
          </Link>
          <h1 className="heading-3">{post.title}</h1>
          <div className="post-meta caption-4">
            <span className="tag">{post.tag}</span>
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span>{post.readingMinutes} min read</span>
          </div>
          <div className="prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ table: ({ children }) => <div className="table-wrap"><table>{children}</table></div> }}
            >
              {post.body}
            </ReactMarkdown>
          </div>
        </article>
      </div>
      <LandingFooter />
    </div>
  )
}
