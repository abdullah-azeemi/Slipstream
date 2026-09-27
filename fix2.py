with open('apps/frontend/app/sessions/[key]/telemetry/page.tsx', 'r') as f:
    lines = f.readlines()

for i in range(2178, 2191):
    print(i+1, lines[i].rstrip())

