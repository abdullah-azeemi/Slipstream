import { getAllPosts } from '@/lib/blog'
import { SITE_URL } from '@/lib/site'

export const dynamic = 'force-static'

/** llms.txt (llmstxt.org): a plain summary of the site for AI assistants and answer engines. */
export function GET() {
  const posts = getAllPosts()
    .map(p => `- [${p.title}](${SITE_URL}/blog/${p.slug}): ${p.summary}`)
    .join('\n')
  const body = `# Slipstream

> Open source Formula 1 analytics: corner-by-corner telemetry, tyre strategy and degradation,
> race predictions, and an analyst agent that answers race questions from timing data with code.

## Pages

- [Home](${SITE_URL}/): what Slipstream does
- [Analyst demo](${SITE_URL}/analyst/demo): a recorded run of the analyst agent, step by step
- [Blog](${SITE_URL}/blog): race breakdowns and build notes

## Blog posts

${posts}
`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
