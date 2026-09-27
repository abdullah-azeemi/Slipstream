import re

with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'r') as f:
    content = f.read()

# I want to remove the old RaceAnalysis block completely.
old_race_block = """        {/* Race mode */}
        {isRaceSession(sessionType) && (
          <>
            <RaceAnalysis sessionKey={sessionKey} sessionName={sessionName} drivers={driverList} />
            <div style={{ marginTop: 24 }}>
              <LapTimeDistribution sessionKey={sessionKey} />
            </div>
          </>
        )}"""
        
# And I want to change `isQualifying` to `(isQualifying || isRaceSession(sessionType))`
content = content.replace("const isQualifying = !isRaceSession(sessionType) && !isPracticeSession(sessionType)", "const isQualifying = !isRaceSession(sessionType) && !isPracticeSession(sessionType)\n  const showTelemetry = isQualifying || isRaceSession(sessionType)")

# Replace occurrences of `{isQualifying && (` with `{showTelemetry && (`
content = content.replace("{isQualifying && (", "{showTelemetry && (")
content = content.replace("isQualifying && qualiSegments?.segments", "showTelemetry && qualiSegments?.segments")
content = content.replace("isQualifying && chartWidth", "showTelemetry && chartWidth")

# Also for the driver selection, if it's a race, don't filter by `segmentDriverNumbers`
# currently: const unavail = isQualifying && qualiSegments?.segments ? !segmentDriverNumbers.has(d.driver_number) : false
# so it's already safe because qualiSegments?.segments won't exist for Race!
# But let's check `if (isQualifying && qualiSegments?.segments && !segmentDriverNumbers.has(dn)) return` -> safe.

# In the API fetch useEffect:
content = content.replace("if (!selected.length || !sessionType || !isQualifying) {", "if (!selected.length || !sessionType || !showTelemetry) {")
content = content.replace("}, [sessionKey, selected, selectedKey, sessionType, selectedSegment, qualiSegments, isQualifying])", "}, [sessionKey, selected, selectedKey, sessionType, selectedSegment, qualiSegments, showTelemetry])")
content = content.replace("if (!sessionType || !isQualifying) {", "if (!sessionType || !showTelemetry) {")
content = content.replace("}, [sessionKey, sessionType, isQualifying])", "}, [sessionKey, sessionType, showTelemetry])")

# The Lens Mode (Q1/Q2/Q3 segments) shouldn't be shown if it's a Race.
# We will just patch the TelemetryDecisionHero so that the Segment Lens is hidden if it's a Race.
# TelemetryDecisionHero has:
#         <div style={{ display: 'flex', gap: 16 }}>
#           {(['Q1', 'Q2', 'Q3'] as const).map(segment => (
content = content.replace("<div style={{ display: 'flex', gap: 16 }}>\n          {(['Q1', 'Q2', 'Q3'] as const).map(segment => (", "{!isRaceSession(sessionType) && (<div style={{ display: 'flex', gap: 16 }}>\n          {(['Q1', 'Q2', 'Q3'] as const).map(segment => (")
content = content.replace("</button>\n          ))}\n        </div>", "</button>\n          ))}\n        </div>)}")

# And the title `sessionName · selectedSegment` -> `sessionName + (isRace ? "" : " · " + selectedSegment)`
content = content.replace("{sessionName} · {selectedSegment}", "{sessionName}{isRaceSession(sessionType) ? '' : ` · ${selectedSegment}`}")

# Same for the Segment Lens in the controls:
content = content.replace("{qualiSegments?.segments && (", "{qualiSegments?.segments && !isRaceSession(sessionType) && (")

# And hide the Qualifying Tables section for Race:
content = content.replace('<CollapsibleSection\n              title="Qualifying Tables"', '{!isRaceSession(sessionType) && (<CollapsibleSection\n              title="Qualifying Tables"')
content = content.replace('</CollapsibleSection>\n            </div>\n          </div>', '</CollapsibleSection>)}\n            </div>\n          </div>')

# Wait, we need to add LapTimeDistribution.
# We will inject LapTimeDistribution at the bottom of the layout, after the Speed Trace layout.
# Or just inside the showTelemetry block.
lap_time_dist = """
            <div style={{ marginTop: 24 }}>
              <LapTimeDistribution sessionKey={sessionKey} />
            </div>
"""
# Find the end of `</CollapsibleSection>` that closes the Qualifying Tables, or the parent `</div></div>`
# I'll just append it before `</div>\n        )}` which closes the showTelemetry block.

content = content.replace('</CollapsibleSection>)}\n            </div>\n          </div>', '</CollapsibleSection>)}\n            </div>\n' + lap_time_dist + '\n          </div>')

content = content.replace(old_race_block, "")

with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'w') as f:
    f.write(content)
