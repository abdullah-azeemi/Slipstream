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
  compound: 'SOFT' | 'MEDIUM' | 'HARD' | 'INTER' | 'INTERMEDIATE' | 'WET' | null
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

export interface Stint {
  driver_number: number
  abbreviation:  string
  team_colour:   string | null
  compound:      string | null
  stint_num:     number
  lap_start:     number
  lap_end:       number
  lap_count:     number
}

export interface RacePosition {
  driver_number: number
  abbreviation:  string
  team_colour:   string | null
  team_name:     string | null
  position:      number | null
}

// Column names match the actual DB schema (renamed from generic speed/throttle)
export interface TelemetrySample {
  speed_kmh:    number | null   // km/h
  throttle_pct: number | null   // 0–100
  brake:        boolean | null
  gear:         number | null   // 1–8
  drs:          number | null   // 0/8/10/12/14 — >8 means DRS open
  distance_m:   number | null   // metres into lap — used for spatial alignment
  x_pos:        number | null   // track map X coordinate
  y_pos:        number | null   // track map Y coordinate
  distance_pct?: number         // computed by API: 0–100
}