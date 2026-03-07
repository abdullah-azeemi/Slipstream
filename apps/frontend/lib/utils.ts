
export function formatLapTime(ms: number | null | undefined): string {

  if (ms == null) return '—'

  const totalSeconds = ms / 1000

  const minutes = Math.floor(totalSeconds / 60)

  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, '0')

  return minutes > 0 ? `${minutes}:${seconds}` : `${seconds}s`

}

export function formatGap(ms: number | null | undefined): string {

  if (ms == null || ms === 0) return '—'

  return `+${(ms / 1000).toFixed(3)}s`

}

export function teamColour(colour: string | null | undefined): string {

  if (!colour) return '#666666'

  return colour.startsWith('#') ? colour : `#${colour}`

}

export const COMPOUND_COLOURS: Record<string, string> = {

  SOFT: '#FF3333', MEDIUM: '#FFD700', HARD: '#FFFFFF', INTER: '#39B54A', WET: '#0067FF',

}

export const COMPOUND_LABEL: Record<string, string> = {

  SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTER: 'I', WET: 'W',

}

// Using picsum.photos as reliable placeholder with circuit-themed seeds

// Replace with real circuit photos later

export const CIRCUIT_IMAGES: Record<string, string> = {

  'British Grand Prix':  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',

  'Monaco Grand Prix':   'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800&q=80',

  'Italian Grand Prix':  'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=800&q=80',

  'Spanish Grand Prix':  'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80',

  'Belgian Grand Prix':  'https://images.unsplash.com/photo-1518623489648-a173ef7824f3?w=800&q=80',

  default:               'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=80',

}

export function getCircuitImage(gpName: string): string {

  return CIRCUIT_IMAGES[gpName] ?? CIRCUIT_IMAGES.default

}

export function sessionTypeLabel(type: string): string {

  const map: Record<string, string> = {

    R: 'Race', Q: 'Qualifying',

    FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3',

    SS: 'Sprint', SQ: 'Sprint Qualifying',

  }

  return map[type] ?? type

}

