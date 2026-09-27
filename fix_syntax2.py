with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'r') as f:
    lines = f.readlines()

lines[2179] = "            </CollapsibleSection>)}\n"
lines[2180] = "\n"
lines[2181] = "            <div style={{ marginTop: 24 }}>\n"
lines[2182] = "              <LapTimeDistribution sessionKey={sessionKey} />\n"
lines[2183] = "            </div>\n          </div>\n        )}\n"

with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'w') as f:
    f.writelines(lines)
