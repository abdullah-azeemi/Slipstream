import re

filepath = "apps/frontend/app/sessions/[key]/overview/page.tsx"
with open(filepath, "r") as f:
    content = f.read()

# 1. Remove unused lucide-react imports
content = content.replace("  CalendarDays,\n", "")
content = content.replace("  Droplets,\n", "")
content = content.replace("  Thermometer,\n", "")
content = content.replace("  Wind,\n", "")

# 2. Remove CountdownTimer import
content = re.sub(r"import CountdownTimer from '@/components/schedule/CountdownTimer'\n", "", content)

# 3. Remove getSessionOverviewRoute from lib/session-routing
content = content.replace("getSessionOverviewRoute, ", "")

# 4. Remove NextRacePayload
content = re.sub(r"type NextRacePayload = \{[\s\S]*?\} \| null\n", "", content)

# 5. Remove HERO_BG
content = re.sub(r"const HERO_BG = [^\n]*\n", "", content)

# 6. Remove getWeatherSource
content = re.sub(r"function getWeatherSource\([\s\S]*?\}\n\n", "", content)

# 7. Remove formatSessionSource
content = re.sub(r"function formatSessionSource\([\s\S]*?\}\n\n", "", content)

# 8. Remove buildCoverageTypes
content = re.sub(r"function buildCoverageTypes\([\s\S]*?\}\n\n", "", content)

# 9. Remove buildActionEntries
content = re.sub(r"function buildActionEntries\([\s\S]*?\}\n\n", "", content)

# 10. Remove SourceBadge
content = re.sub(r"function SourceBadge\([\s\S]*?\}\n\n", "", content)

# 11. Remove SectionShell
content = re.sub(r"function SectionShell\([\s\S]*?\}\n\n", "", content)

# 12. Remove ConditionCard
content = re.sub(r"function ConditionCard\([\s\S]*?\}\n\n", "", content)

# 13. Remove EmptyState
content = re.sub(r"function EmptyState\([\s\S]*?\}\n\n", "", content)

# 14. Fix qualiFastest in SessionOverviewPage
# Replace `const [raceResults, stintPace, undercut, positionChanges, qualiFastest, trackMap]`
# with `const [raceResults, stintPace, undercut, positionChanges, , trackMap]`
content = content.replace(
    "const [raceResults, stintPace, undercut, positionChanges, qualiFastest, trackMap]",
    "const [raceResults, stintPace, undercut, positionChanges, , trackMap]"
)

with open(filepath, "w") as f:
    f.write(content)

print("Cleanup complete.")
