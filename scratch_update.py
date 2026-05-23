import os

filepath = "apps/frontend/app/sessions/[key]/overview/page.tsx"
with open(filepath, "r") as f:
    lines = f.readlines()

# Find where 'function TrackMapPanel' starts
split_idx = -1
for i, line in enumerate(lines):
    if line.startswith("function TrackMapPanel"):
        split_idx = i
        break

if split_idx == -1:
    print("Could not find TrackMapPanel")
    exit(1)

# Keep the imports and helpers
new_lines = lines[:split_idx]

# We don't need the previous empty TrackMapPanel, SectionShell, etc.
# We will define the new main component SessionOverviewPage.
# First let's remove some unused helper components if they are right before TrackMapPanel
# Actually it's fine to keep them, but let's just append the new component.

new_content = """
export default async function SessionOverviewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const sessionKey = Number.parseInt(key, 10)

  if (!Number.isFinite(sessionKey)) {
    notFound()
  }

  const sessions = await api.sessions.list(true).catch(() => [])
  const weekend = findWeekendBySessionKey(sessions, sessionKey)
  if (!weekend) {
    notFound()
  }

  const currentSessions = sortByWeekendOrder(weekend.sessions)
  const previousYearSessions = sortByWeekendOrder(
    sessions.filter((session) => session.year === weekend.year - 1 && session.gp_name === weekend.gp_name),
  )
  const primarySession = pickPrimaryWeekendSession(currentSessions) ?? pickPrimaryWeekendSession(previousYearSessions)
  if (!primarySession) {
    notFound()
  }

  const round = getWeekendRoundForSeason(weekend, sessions)
  const circuitName = getCircuitName(weekend.gp_name)
  const raceReference = resolveSessionReference(currentSessions, previousYearSessions, RACE_LIKE_TYPES)
  const qualiReference = resolveSessionReference(currentSessions, previousYearSessions, QUALI_LIKE_TYPES)

  const [raceResults, stintPace, undercut, positionChanges, qualiFastest, trackMap] = await Promise.all([
    raceReference.effective ? fetchJson<RaceResult[]>(`/api/v1/sessions/${raceReference.effective.session_key}/race-results`) : Promise.resolve(null),
    raceReference.effective ? fetchJson<StintPreview[]>(`/api/v1/sessions/${raceReference.effective.session_key}/analysis/stint-pace`) : Promise.resolve(null),
    raceReference.effective ? fetchJson<UndercutRow[]>(`/api/v1/sessions/${raceReference.effective.session_key}/analysis/undercut`) : Promise.resolve(null),
    raceReference.effective ? fetchJson<PositionChanges>(`/api/v1/sessions/${raceReference.effective.session_key}/analysis/position-changes`) : Promise.resolve(null),
    qualiReference.effective ? fetchJson<{ laps: FastestLap[] }>(`/api/v1/sessions/${qualiReference.effective.session_key}/fastest`) : Promise.resolve(null),
    fetchTrackMapData(currentSessions, previousYearSessions)
  ])

  const classification = (raceResults ?? []).slice(0, 3)
  const topRaceDrivers = classification.map((row) => row.driver_number)
  const groupedStints = groupStintsByDriver(stintPace ?? [], topRaceDrivers)
  const maxRaceLap = positionChanges?.total_laps ?? Math.max(0, ...(raceResults ?? []).map((row) => row.total_laps))
  const topPositionDrivers = classification
    .map((row) => ({
      row,
      trace: positionChanges?.drivers[String(row.driver_number)] ?? null,
    }))
    .filter((entry) => entry.trace)

  const biggestGain = [...(undercut ?? [])]
    .filter((entry) => (entry.pos_gain ?? 0) > 0)
    .sort((a, b) => (b.pos_gain ?? 0) - (a.pos_gain ?? 0))[0] ?? null
  const biggestDrop = [...(undercut ?? [])]
    .filter((entry) => (entry.pos_gain ?? 0) < 0)
    .sort((a, b) => (a.pos_gain ?? 0) - (b.pos_gain ?? 0))[0] ?? null

  const activeSessionsSummary = currentSessions.map((session) => session.session_type).join(' • ')

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', gap: 48, background: '#FAFAFA' }}>
      
      {/* HEADER ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 32, alignItems: 'stretch' }}>
        
        {/* Left Info */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div>
            <div style={{ width: 32, height: 2, background: '#E8002D', marginBottom: 8 }} />
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#E8002D', fontWeight: 800, letterSpacing: '0.1em' }}>
              ROUND {round < 10 ? `0${round}` : round}
            </div>
          </div>
          <h1 style={{
            margin: '16px 0',
            color: '#0F172A',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 900,
            fontSize: 'clamp(2.5rem, 5vw, 3.5rem)',
            letterSpacing: '-0.04em',
            lineHeight: 1,
            textTransform: 'uppercase',
          }}>
            {weekend.gp_name.replace(' Grand Prix', '')}
          </h1>
          <p style={{
            margin: 0,
            color: '#64748B',
            fontFamily: 'Inter, sans-serif',
            fontSize: 15,
            lineHeight: 1.6,
            maxWidth: 480,
          }}>
            {circuitName ?? weekend.country ?? 'Grand Prix weekend'} • {formatWeekendDate(weekend.startDate, weekend.endDate)}.
            {' '}Current coverage is {activeSessionsSummary || 'still building'}.
          </p>

          <div style={{ display: 'flex', gap: 24, marginTop: 32 }}>
            <div style={{ paddingLeft: 12, borderLeft: '3px solid #E8002D' }}>
              <div style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Track Length</div>
              <div style={{ marginTop: 4, color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14 }}>5.412 KM</div>
            </div>
            <div style={{ width: 1, background: '#E2E8F0' }} />
            <div style={{ paddingLeft: 12 }}>
              <div style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Laps</div>
              <div style={{ marginTop: 4, color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14 }}>{maxRaceLap > 0 ? maxRaceLap : '---'}</div>
            </div>
          </div>
        </div>

        {/* Right Track Map */}
        <div style={{
          background: '#F1F5F9',
          borderRadius: 8,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 320,
        }}>
          {trackMap.points.length > 0 ? (
            <svg viewBox="0 0 360 320" style={{ width: '80%', height: '80%' }}>
              <path
                d={`M ${trackMap.points.map(p => `${p.x} ${p.y}`).join(' L ')}`}
                fill="none"
                stroke="#E8002D"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <div style={{ color: '#94A3B8', fontFamily: 'Inter, sans-serif', fontSize: 13 }}>No telemetry trace</div>
          )}
          <div style={{
            position: 'absolute',
            bottom: 16,
            right: 20,
            textAlign: 'right'
          }}>
            <div style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Circuit Model</div>
            <div style={{ marginTop: 2, color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 12 }}>
              {weekend.gp_name.substring(0, 3).toUpperCase()}-AUTO-{weekend.year}.v3
            </div>
          </div>
        </div>
      </div>

      {/* MIDDLE SECTION */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 32, alignItems: 'start' }}>
        
        {/* Left Column: Classification & Movers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
              <h2 style={{ margin: 0, color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 20, textTransform: 'uppercase' }}>Classification</h2>
              <div style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Final Results</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {classification.map((result, index) => {
                const accent = teamColour(result.team_colour, result.team_name)
                return (
                  <div key={result.driver_number} style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#FFFFFF',
                    border: '1px solid #F1F5F9',
                    borderRadius: 4,
                    padding: '16px',
                  }}>
                    <div style={{ width: 32, fontFamily: 'JetBrains Mono, monospace', fontSize: 16, color: '#E8002D', fontWeight: 800 }}>
                      {index < 9 ? `0${index + 1}` : index + 1}
                    </div>
                    <div style={{ width: 3, height: 32, background: accent, margin: '0 16px 0 8px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 16 }}>{result.abbreviation}</div>
                      <div style={{ marginTop: 2, color: '#64748B', fontFamily: 'Inter, sans-serif', fontSize: 10, textTransform: 'uppercase' }}>{result.team_name}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14 }}>
                        {index === 0 ? '25 PTS' : index === 1 ? '18 PTS' : '15 PTS'}
                      </div>
                      <div style={{ marginTop: 4, color: '#E8002D', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        <Clock3 size={10} />
                        {index === 0 && result.best_lap_ms ? formatLapTime(result.best_lap_ms) : formatRaceGap(result, index)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <div style={{ background: '#F8FAFC', borderRadius: 4, padding: '12px 16px' }}>
                <div style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginBottom: 8 }}>Biggest Gainer</div>
                {biggestGain ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14 }}>{biggestGain.abbreviation}</div>
                    <div style={{ color: '#10B981', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14 }}>+{biggestGain.pos_gain} POS</div>
                  </div>
                ) : (
                   <div style={{ color: '#64748B', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>N/A</div>
                )}
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: 4, padding: '12px 16px' }}>
                <div style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginBottom: 8 }}>Biggest Drop</div>
                {biggestDrop ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14 }}>{biggestDrop.abbreviation}</div>
                    <div style={{ color: '#E8002D', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14 }}>{biggestDrop.pos_gain} POS</div>
                  </div>
                ) : (
                   <div style={{ color: '#64748B', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>N/A</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Graphs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Position Evolution Container */}
          <div style={{ background: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: 4, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h2 style={{ margin: 0, color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 16, textTransform: 'uppercase' }}>Position Evolution</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                   <span style={{ fontSize: 9, background: '#0F172A', color: '#FFF', padding: '2px 6px', borderRadius: 2, fontFamily: 'JetBrains Mono, monospace' }}>SC L26</span>
                   <span style={{ fontSize: 9, border: '1px solid #E2E8F0', color: '#64748B', padding: '2px 6px', borderRadius: 2, fontFamily: 'JetBrains Mono, monospace' }}>VSC L41</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                 {topPositionDrivers.map(({ row }) => (
                    <div key={row.driver_number} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: teamColour(row.team_colour, row.team_name) }} />
                      <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}>{row.abbreviation}</div>
                    </div>
                 ))}
              </div>
            </div>
            
            <div style={{ height: 200, position: 'relative' }}>
              {positionChanges && topPositionDrivers.length > 0 && maxRaceLap > 1 ? (
                <svg viewBox="0 0 600 160" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                   <line x1="300" y1="0" x2="300" y2="160" stroke="#E2E8F0" strokeDasharray="4 4" />
                   <text x="300" y="80" fill="#CBD5E1" fontSize="10" textAnchor="middle" fontFamily="Inter, sans-serif">PIT WINDOW</text>
                   {topPositionDrivers.map(({ row, trace }) => (
                      <path
                        key={row.driver_number}
                        d={buildPositionPath(trace!.positions, maxRaceLap, 600, 160, Math.max(classification.length, 3))}
                        fill="none"
                        stroke={teamColour(row.team_colour, row.team_name)}
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                   ))}
                </svg>
              ) : (
                <div style={{ color: '#94A3B8', fontFamily: 'Inter, sans-serif', fontSize: 13, textAlign: 'center', paddingTop: 80 }}>No position trace available.</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, borderTop: '1px solid #F1F5F9', paddingTop: 16 }}>
               <span style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace' }}>L0</span>
               <span style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace' }}>L15</span>
               <span style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace' }}>L30</span>
               <span style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace' }}>L45</span>
               <span style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace' }}>L{maxRaceLap}</span>
            </div>
          </div>

          {/* Tyre Strategy Container */}
          <div style={{ background: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: 4, padding: 24 }}>
             <h2 style={{ margin: 0, marginBottom: 24, color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 16, textTransform: 'uppercase' }}>Tyre Strategy</h2>
             <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {classification.map(row => {
                   const driverStints = groupedStints.get(row.driver_number) ?? []
                   return (
                      <div key={row.driver_number} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                         <div style={{ width: 32, fontSize: 10, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}>
                            {row.abbreviation}
                         </div>
                         <div style={{ flex: 1, display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: '#F1F5F9' }}>
                            {driverStints.map(stint => {
                               const laps = Math.max(1, stint.end_lap - stint.start_lap + 1)
                               return (
                                  <div 
                                     key={`${stint.driver_number}-${stint.stint}`}
                                     style={{ 
                                        width: `${(laps / Math.max(maxRaceLap, 1)) * 100}%`,
                                        background: COMPOUND_COLOURS[stint.compound] ?? '#CBD5E1',
                                     }}
                                  />
                               )
                            })}
                         </div>
                      </div>
                   )
                })}
             </div>
             <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPOUND_COLOURS['SOFT'] ?? '#E8002D' }} />
                   <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Soft</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPOUND_COLOURS['MEDIUM'] ?? '#F59E0B' }} />
                   <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Medium</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                   <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPOUND_COLOURS['HARD'] ?? '#0F172A' }} />
                   <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>Hard</div>
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* BOTTOM ACTIONS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
         <Link href={getSessionTelemetryRoute(raceReference.effective?.session_key ?? 0)} style={{ textDecoration: 'none' }}>
           <div style={{ background: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: 4, padding: 24, height: '100%' }}>
              <Radio size={16} color="#E8002D" style={{ marginBottom: 16 }} />
              <div style={{ color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14, textTransform: 'uppercase', marginBottom: 8 }}>Race Analysis</div>
              <div style={{ color: '#64748B', fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.5 }}>Deep dive into stint-by-stint pace and sector performance mapping.</div>
           </div>
         </Link>
         <Link href={getSessionTelemetryRoute(qualiReference.effective?.session_key ?? 0)} style={{ textDecoration: 'none' }}>
           <div style={{ background: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: 4, padding: 24, height: '100%' }}>
              <Clock3 size={16} color="#E8002D" style={{ marginBottom: 16 }} />
              <div style={{ color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14, textTransform: 'uppercase', marginBottom: 8 }}>Quali Report</div>
              <div style={{ color: '#64748B', fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.5 }}>Micro-sector breakdowns and telemetry comparisons from Q3.</div>
           </div>
         </Link>
         <Link href="/sessions" style={{ textDecoration: 'none' }}>
           <div style={{ background: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: 4, padding: 24, height: '100%' }}>
              <Flag size={16} color="#E8002D" style={{ marginBottom: 16 }} />
              <div style={{ color: '#0F172A', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 14, textTransform: 'uppercase', marginBottom: 8 }}>Practice Data</div>
              <div style={{ color: '#64748B', fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.5 }}>Long-run simulations and engine mapping data from FP1-FP3.</div>
           </div>
         </Link>
      </div>

    </div>
  )
}
"""

with open(filepath, "w") as f:
    f.writelines(new_lines)
    f.write(new_content)

print("Successfully replaced content.")
