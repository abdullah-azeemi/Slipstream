// Self-hosted Geist (the `geist` package ships the font files), so builds never
// depend on fetching Google Fonts, which broke the Vercel build.
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'

export const geist = GeistSans
// exposes the --font-geist-mono variable that globals.css already uses
export const geistMono = GeistMono
