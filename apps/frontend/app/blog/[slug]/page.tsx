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
import BlogChart from '@/components/blog/AlonsoCharts'
import { formatDate, getAllPosts, getHeadings, getPost, slugify } from '@/lib/blog'

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
  const headings = getHeadings(post.body)

  return (
    <div className={`lp ${geist.className}`}>
      <LandingNav />
      <div id="main" className="wrap">
        <article className="article">
          <Link href="/blog" className="back body-5">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" /> All posts
          </Link>
          {post.kicker && <p className="kicker caption-4">{post.kicker}</p>}
          <h1 className="heading-3">
            {post.emphasis && post.title.endsWith(post.emphasis) ? (
              <>
                {post.title.slice(0, -post.emphasis.length)}
                <em>{post.emphasis}</em>
              </>
            ) : (
              post.title
            )}
          </h1>
          {post.summary && <p className="deck body-5">{post.summary}</p>}
          <div className="post-meta caption-4">
            <span className="tag">{post.tag}</span>
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span>{post.readingMinutes} min read</span>
          </div>
          {headings.length > 3 && (
            <nav className="toc" aria-label="In this article">
              <p className="toc-title caption-4">In this article</p>
              <ol>
                {headings.map(h => (
                  <li key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>
                ))}
              </ol>
            </nav>
          )}
          <div className="prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
                h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
                // A ```chart fence holds a chart id, e.g. team-pace. See components/blog/AlonsoCharts.
                pre: ({ children }) => {
                  const child = Array.isArray(children) ? children[0] : children
                  const cls = (child as { props?: { className?: string } } | undefined)?.props?.className
                  return cls?.includes('language-chart') ? <>{children}</> : <pre>{children}</pre>
                },
                code: ({ className, children }) =>
                  className?.includes('language-chart')
                    ? <BlogChart id={textOf(children).trim()} />
                    : <code className={className}>{children}</code>,
              }}
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

/** Plain text of a heading's children, so its id matches the contents box. */
function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: React.ReactNode } }).props.children)
  return ''
}
