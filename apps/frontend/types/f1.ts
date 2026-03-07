// ── Core F1 types — mirror your Flask API response shapes exactly ──────────

export interface Session {
  session_key: number
  year: number
  gp_name: string
  country: string | null
  session_type: 'R' | 'Q' | 'FP1' | 'FP2' | 'FP3' | 'SS' | 'SQ'
  session_name: string
  date_start: string | null
  drivers?: Driver[]
}

export interface Driver {
  driver_number: number
  full_name: string
  abbreviation: string
  team_name: string | null
  team_colour: string | null
  best_lap_ms?: number | null
  total_laps?: number
}

export interface Lap {
  driver_number: number
  abbreviation: string
  team_name: string | null
  team_colour: string | null
  lap_number: number
  lap_time_ms: number | null
  s1_ms: number | null
  s2_ms: number | null
  s3_ms: number | null
  compound: 'SOFT' | 'MEDIUM' | 'HARD' | 'INTER' | 'WET' | null
  tyre_life_laps: number | null
  is_personal_best: boolean
  track_status: string | null
  deleted: boolean
}

export interface FastestLap {
  driver_number: number
  abbreviation: string
  team_name: string | null
  team_colour: string | null
  lap_number: number
  lap_time_ms: number
  compound: string | null
}

export interface DriverComparison {
  driver_number: number
  abbreviation: string
  team_name: string | null
  team_colour: string | null
  best_lap_ms: number | null
  best_s1_ms: number | null
  best_s2_ms: number | null
  best_s3_ms: number | null
  theoretical_best_ms: number | null
  lap_time_stddev: number | null
  total_laps: number
  gap_to_fastest_ms: number | null
}

export interface HealthStatus {
  status: 'ok' | 'degraded'
  database: 'ok' | 'unreachable'
  version: string
}
