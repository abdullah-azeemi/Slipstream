import re

with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'r') as f:
    content = f.read()

# I will find the block that renders the speed chart and replace it.
# Wait, actually, the user said "Replace the entire layout of the session page with the landing page layout... Oh wait, the user specifically chose Option 1.
# But Option 1 says: "Replace the current canvas chart with the SVG chart style from the landing page, and install ECharts for the violin plot."

