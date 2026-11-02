import { describe, expect, it } from 'vitest'

import { formatDate, parsePost } from '@/lib/blog'

const doc = (front: string, body = 'Hello world.') => `---\n${front}\n---\n${body}`

describe('parsePost', () => {
  it('reads frontmatter and body', () => {
    const p = parsePost('a-post', doc('title: A post\ndate: 2026-11-03\nsummary: Short\ntag: Notes'))
    expect(p).toMatchObject({ slug: 'a-post', title: 'A post', date: '2026-11-03', summary: 'Short', tag: 'Notes', draft: false })
    expect(p?.body).toBe('Hello world.')
  })

  it('strips quotes from values', () => {
    expect(parsePost('x', doc('title: "Quoted"\ndate: 2026-01-01'))?.title).toBe('Quoted')
  })

  it('marks drafts', () => {
    expect(parsePost('x', doc('title: T\ndate: 2026-01-01\ndraft: true'))?.draft).toBe(true)
  })

  it('returns null without frontmatter, title or date', () => {
    expect(parsePost('x', 'no frontmatter')).toBeNull()
    expect(parsePost('x', doc('date: 2026-01-01'))).toBeNull()
    expect(parsePost('x', doc('title: T'))).toBeNull()
  })

  it('estimates reading time from word count', () => {
    const words = Array.from({ length: 660 }, () => 'word').join(' ')
    expect(parsePost('x', doc('title: T\ndate: 2026-01-01', words))?.readingMinutes).toBe(3)
  })

  it('keeps colons inside values', () => {
    expect(parsePost('x', doc('title: Race: lap by lap\ndate: 2026-01-01'))?.title).toBe('Race: lap by lap')
  })
})

describe('formatDate', () => {
  it('formats an ISO date', () => {
    expect(formatDate('2026-11-03')).toBe('3 November 2026')
  })

  it('returns the input when it is not a date', () => {
    expect(formatDate('soon')).toBe('soon')
  })
})
