import fs from 'node:fs'
import path from 'node:path'

export interface PostMeta {
  slug: string
  title: string
  summary: string
  date: string // ISO yyyy-mm-dd
  tag: string
  readingMinutes: number
}

export interface Post extends PostMeta {
  body: string
}

const DIR = path.join(process.cwd(), 'content', 'blog')

export function parsePost(slug: string, raw: string): (Post & { draft: boolean }) | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return null
  const data: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i === -1) continue
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  if (!data.title || !data.date) return null
  const body = m[2].trim()
  return {
    slug,
    title: data.title,
    summary: data.summary ?? '',
    date: data.date,
    tag: data.tag ?? 'Notes',
    draft: data.draft === 'true',
    readingMinutes: Math.max(1, Math.round(body.split(/\s+/).length / 220)),
    body,
  }
}

/** Posts are Markdown files in content/blog. Set `draft: true` to hide one. */
export function getAllPosts(): Post[] {
  if (!fs.existsSync(DIR)) return []
  return fs
    .readdirSync(DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => parsePost(f.replace(/\.md$/, ''), fs.readFileSync(path.join(DIR, f), 'utf8')))
    .filter((p): p is Post & { draft: boolean } => p !== null && !p.draft)
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function getPost(slug: string): Post | null {
  return getAllPosts().find(p => p.slug === slug) ?? null
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
