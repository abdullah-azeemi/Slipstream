with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'r') as f:
    content = f.read()

content = content.replace('</CollapsibleSection>)}\n            </div>\n\n            <div style={{ marginTop: 24 }}>\n              <LapTimeDistribution sessionKey={sessionKey} />\n            </div>\n\n          </div>', '</CollapsibleSection>\n            )}</div>\n\n            <div style={{ marginTop: 24 }}>\n              <LapTimeDistribution sessionKey={sessionKey} />\n            </div>\n\n          </div>')

with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'w') as f:
    f.write(content)
