import { redirect } from 'next/navigation'

// The archive used hardcoded sample results. Real weekends live on the sessions page.
export default function ArchivePage() {
  redirect('/sessions')
}
