import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { formatDate, type PostMeta } from '@/lib/blog'

export default function PostCard({ post }: { post: PostMeta }) {
  return (
    <Link href={`/blog/${post.slug}`} className="card">
      <div className="post-meta caption-4">
        <span className="tag">{post.tag}</span>
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        <span>{post.readingMinutes} min read</span>
      </div>
      <h3 className="heading-6">{post.title}</h3>
      <p className="body-6">{post.summary}</p>
      <span className="card-link button-sm">
        Read post <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </span>
    </Link>
  )
}
