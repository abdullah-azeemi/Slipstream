import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpRight,
  CalendarBlank,
  Check,
  Code,
  Flag,
  GithubLogo,
  Robot,
  Speedometer,
  ChartLineUp,
} from '@phosphor-icons/react/dist/ssr'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'
import RevealController from '@/components/landing/RevealController'
import HeroMedia from '@/components/landing/HeroMedia'
import LiveStats from '@/components/landing/LiveStats'
import TaglineReveal from '@/components/landing/TaglineReveal'
import PostCard from '@/components/landing/PostCard'
import PrimaryCta from '@/components/landing/PrimaryCta'
import { getAllPosts } from '@/lib/blog'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Slipstream: F1 telemetry, tyre strategy and race predictions',
  description:
    'Open source Formula 1 analytics. Compare drivers corner by corner, study tyre strategy, read race predictions and ask the Pitwall agent. Built for fans and analysts.',
  openGraph: {
    title: 'Slipstream: see why races are won, lap by lap',
    description:
      'Open source Formula 1 analytics for fans, developers and analysts.',
    type: 'website',
    images: [{ url: '/LandingPage3-poster.jpg', width: 1280, height: 720 }],
  },
  twitter: { card: 'summary_large_image' },
}

const FEATURES = [
  {
    icon: Speedometer,
    title: 'Corner by corner comparison',
    body: 'Overlay two drivers on the same lap and see the exact corners where time is gained or lost.',
    href: '/telemetry',
    cta: 'Open telemetry',
  },
  {
    icon: ChartLineUp,
    title: 'Tyre strategy and wear',
    body: 'Follow every stint and see how each compound degraded across the race.',
    href: '/sessions',
    cta: 'Browse sessions',
  },
  {
    icon: Flag,
    title: 'Race predictions',
    body: 'Model driven predictions for upcoming sessions, kept next to the results they are judged against.',
    href: '/predictions',
    cta: 'See predictions',
  },
  {
    icon: Robot,
    title: 'The Pitwall agent',
    body: 'Ask a question in plain English. The agent calls read only analysis tools and shows the evidence behind each answer.',
    href: '/agent',
    cta: 'Ask Pitwall',
  },
  {
    icon: CalendarBlank,
    title: 'Sessions and calendar',
    body: 'Browse practice, qualifying and races, with pole sitters, winners and the full season calendar.',
    href: '/schedule',
    cta: 'View schedule',
  },
  {
    icon: Code,
    title: 'Open source from the start',
    body: 'Read the code, run it on your own machine and extend the analysis with your own tools.',
    href: 'https://github.com/abdullah-azeemi/Slipstream',
    cta: 'View on GitHub',
  },
]

const STEPS = [
  { title: 'Create your account', body: 'Sign up so your conversations and analysis stay in one place.' },
  { title: 'Pick a session', body: 'Choose any race weekend session from the archive, or the next one on the calendar.' },
  { title: 'Compare, study or ask', body: 'Overlay drivers, read stint by stint tyre wear, or put a question to the Pitwall agent.' },
]

const SOURCES = [
  { name: 'FastF1', body: 'Timing and telemetry for laps, sectors and car data, ingested into the Slipstream database.' },
  { name: 'OpenF1', body: 'Open session data that fills in details around each weekend.' },
  { name: 'Jolpica', body: 'Results, standings and calendar information for every round.' },
]

const FAQ = [
  {
    q: 'What is Slipstream?',
    a: 'Slipstream is an open source Formula 1 analytics platform. It combines lap and telemetry comparisons, tyre strategy, race predictions and an optional AI assistant called Pitwall, all built on public motorsport data.',
  },
  {
    q: 'Where does the data come from?',
    a: 'Sessions are ingested with FastF1, and the project also uses OpenF1 and Jolpica for session details, results and the calendar. Everything you see is computed from that stored data.',
  },
  {
    q: 'Do I need an account?',
    a: 'You can read this page and the blog without one. The telemetry, sessions, predictions and agent views need a free account so your work and conversations are saved to you.',
  },
  {
    q: 'How does the Pitwall agent work?',
    a: 'The agent classifies your question, plans which analysis tools to run, then executes them. Tools are read only and numbers in an answer must come from tool output. If the data is missing, the agent says so instead of guessing.',
  },
  {
    q: 'How current is the data?',
    a: 'A session appears once it has finished and its data is available from the public sources. The live counters above show what is in the archive right now.',
  },
  {
    q: 'Can I run Slipstream myself?',
    a: 'Yes. Clone the repository, run make install, make up and make migrate, then start the backend and frontend. The README lists the requirements: Python 3.11, uv, Node.js 20, pnpm and Docker Compose.',
  },
  {
    q: 'Is there an API?',
    a: 'The Flask backend exposes the sessions, laps, telemetry, strategy and predictions endpoints the app uses. Product endpoints require a signed in user token, so for your own experiments the easiest route is to run the stack locally.',
  },
  {
    q: 'Is Slipstream affiliated with Formula 1?',
    a: 'No. It is an independent project built on public data and is not endorsed by Formula 1, any team or any driver.',
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function LandingPage() {
  const posts = getAllPosts().slice(0, 3)

  return (
    <div className={`lp ${geist.className}`}>
      <LandingNav />
      <RevealController />

      <div id="main">
        {/* Hero */}
        <section className="hero">
          <div className="wrap hero-inner">
            <span className="badge caption-1">
              <GithubLogo size={16} aria-hidden="true" /> Open source F1 analytics
            </span>
            <h1 className="heading-1">See why races are won, lap by lap</h1>
            <p className="lede body-3">
              Slipstream turns public timing and telemetry into corner level comparisons, tyre
              strategy and race predictions. Built for fans who want the story and analysts who
              want the data.
            </p>
            <div className="hero-cta">
              <PrimaryCta />
              <span className="caption-4 muted">
                Open source. Built on public data from FastF1, OpenF1 and Jolpica.
              </span>
            </div>
            <HeroMedia />
          </div>
        </section>

        <LiveStats />

        {/* Tagline reveal */}
        <section className="tagline" aria-label="What Slipstream is for">
          <div className="wrap">
            <TaglineReveal text="Every corner hides a few hundredths of a second. Slipstream shows you where they went, which tyre took them, and what the next stint is likely to cost." />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="section alt">
          <div className="wrap">
            <div className="section-head reveal">
              <p className="caption-1 muted">Features</p>
              <h2 className="heading-2">Everything you need to read a race</h2>
              <p className="body-3">
                One place for the lap data, the strategy and the predictions, with every number
                traceable to a session.
              </p>
            </div>
            <div className="grid-3">
              {FEATURES.map((f, i) => {
                const Icon = f.icon
                const external = f.href.startsWith('http')
                return (
                  <Link
                    key={f.title}
                    href={f.href}
                    className="card reveal"
                    style={{ ['--d' as string]: (i % 3) * 80 }}
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <span className="card-icon"><Icon size={20} aria-hidden="true" /></span>
                    <h3 className="heading-6">{f.title}</h3>
                    <p className="body-6">{f.body}</p>
                    <span className="card-link button-sm">
                      {f.cta}
                      {external
                        ? <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
                        : <ArrowRight size={16} weight="bold" aria-hidden="true" />}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>

        {/* Audiences */}
        <section className="section" aria-labelledby="audience-title">
          <div className="wrap">
            <div className="section-head reveal">
              <p className="caption-1 muted">Who it is for</p>
              <h2 id="audience-title" className="heading-2">Two ways to use Slipstream</h2>
            </div>
            <div className="grid-2">
              <article className="audience reveal">
                <p className="caption-1">For fans</p>
                <h3 className="heading-4">Understand what you just watched</h3>
                <ul className="body-3">
                  <li><Check size={20} weight="bold" aria-hidden="true" /> See who gained time in which corner, without reading a spreadsheet.</li>
                  <li><Check size={20} weight="bold" aria-hidden="true" /> Follow tyre strategy stint by stint and spot why a stop worked.</li>
                  <li><Check size={20} weight="bold" aria-hidden="true" /> Ask Pitwall a plain English question and get an answer with its evidence.</li>
                </ul>
              </article>
              <article className="audience reveal" style={{ ['--d' as string]: 80 }}>
                <p className="caption-1">For developers and analysts</p>
                <h3 className="heading-4">Start from the data, not the screenshots</h3>
                <ul className="body-3">
                  <li><Check size={20} weight="bold" aria-hidden="true" /> Read the ingestion code and the SQL behind every chart.</li>
                  <li><Check size={20} weight="bold" aria-hidden="true" /> Run the full stack locally with Postgres, Flask and Next.js.</li>
                  <li><Check size={20} weight="bold" aria-hidden="true" /> Add your own tools to the agent. Tools are typed, read only and testable.</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="section alt">
          <div className="wrap">
            <div className="section-head reveal">
              <p className="caption-1 muted">How it works</p>
              <h2 className="heading-2">From sign up to insight in three steps</h2>
            </div>
            <ol className="grid-3" style={{ listStyle: 'none', padding: 0 }}>
              {STEPS.map((s, i) => (
                <li key={s.title} className="card reveal" style={{ ['--d' as string]: i * 80 }}>
                  <span className="step-num title-3" aria-hidden="true">{i + 1}</span>
                  <h3 className="heading-6">{s.title}</h3>
                  <p className="body-6">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Sources */}
        <section className="section" aria-labelledby="sources-title">
          <div className="wrap">
            <div className="section-head reveal">
              <p className="caption-1 muted">Data</p>
              <h2 id="sources-title" className="heading-2">Built on open motorsport data</h2>
              <p className="body-3">
                Everything starts from public sources and is stored in the Slipstream database,
                so every analysis can be repeated.
              </p>
            </div>
            <div className="grid-3">
              {SOURCES.map((s, i) => (
                <div key={s.name} className="card reveal" style={{ ['--d' as string]: i * 80 }}>
                  <h3 className="heading-6">{s.name}</h3>
                  <p className="body-6">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Blog */}
        <section id="blog" className="section alt" aria-labelledby="blog-title">
          <div className="wrap">
            <div className="section-head reveal">
              <p className="caption-1 muted">Blog</p>
              <h2 id="blog-title" className="heading-2">Notes from the pit wall</h2>
              <p className="body-3">
                Build notes, race breakdowns and guides to the Pitwall agent.
              </p>
            </div>
            {posts.length > 0 ? (
              <>
                <div className="grid-3">
                  {posts.map((p, i) => (
                    <div key={p.slug} className="reveal" style={{ ['--d' as string]: i * 80, display: 'flex' }}>
                      <div style={{ display: 'flex', width: '100%' }}>
                        <PostCard post={p} />
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ marginTop: 'var(--sp-400)' }}>
                  <Link href="/blog" className="btn btn-outline button-md">
                    All posts <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </Link>
                </p>
              </>
            ) : (
              <div className="empty reveal">
                <h3 className="heading-6">The first posts are on the way</h3>
                <p className="body-6">Follow the project on GitHub to hear when they land.</p>
              </div>
            )}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="section" aria-labelledby="faq-title">
          <div className="wrap">
            <div className="section-head reveal" style={{ margin: '0 auto var(--sp-600)', textAlign: 'center' }}>
              <p className="caption-1 muted">FAQ</p>
              <h2 id="faq-title" className="heading-2">Questions, answered</h2>
            </div>
            <div className="faq reveal">
              {FAQ.map(f => (
                <details key={f.q}>
                  <summary className="title-2">
                    {f.q}
                    <PlusIcon />
                  </summary>
                  <p className="answer body-3">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
          />
        </section>

        {/* Final CTA */}
        <section aria-labelledby="final-title">
          <div className="wrap">
            <div className="final reveal">
              <h2 id="final-title" className="heading-2 gradient-text">See why races are won, lap by lap</h2>
              <p className="lede body-3">
                Create a free account and open your first session today.
              </p>
              <div className="hero-cta">
                <PrimaryCta />
                <span className="caption-4 muted">Open source. Built on public data.</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <LandingFooter />
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z" />
    </svg>
  )
}
