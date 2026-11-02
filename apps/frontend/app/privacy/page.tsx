import type { Metadata } from 'next'
import LegalPage from '@/components/landing/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy | Slipstream',
  description: 'What Slipstream stores, who processes it, and how to ask for it to be removed.',
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="3 November 2026">
      <p>
        Slipstream is an open source Formula 1 analytics project. This page describes, in plain language,
        what the service stores and which providers process data on its behalf.
      </p>

      <h2>Your account</h2>
      <p>
        Sign in and sign up are handled by Clerk. Clerk stores your sign in details, such as your email
        address, and issues the session token the app uses to recognise you. Slipstream does not see your password.
      </p>

      <h2>What Slipstream stores</h2>
      <ul>
        <li>Your Pitwall agent conversations, including the questions you ask and the answers returned.</li>
        <li>Records of each agent run and the tools it called, used for the chat history and usage limits.</li>
        <li>Usage counts and any feedback ratings you give on answers.</li>
      </ul>
      <p>
        The agent does not keep a personal profile or a memory of your chats beyond this stored history.
        Race data shown in the app comes from public motorsport sources and is not personal data.
      </p>

      <h2>Who else processes data</h2>
      <ul>
        <li><strong>Clerk</strong> for authentication.</li>
        <li><strong>The language model provider</strong> configured for the agent (OpenRouter by default). Questions you send to the agent are passed to it to produce an answer.</li>
        <li><strong>Vercel Analytics and Speed Insights</strong> for aggregate page views and performance measurements.</li>
      </ul>

      <h2>Cookies</h2>
      <p>
        Clerk sets the cookies needed to keep you signed in. Slipstream does not use advertising cookies.
      </p>

      <h2>Deleting your data</h2>
      <p>
        To have your account and stored conversations removed, contact {'{{contact email}}'}. You can also delete
        your account through your Clerk profile.
      </p>
    </LegalPage>
  )
}
