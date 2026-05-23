# Slipstream Frontend

Next.js app for Slipstream's race, qualifying, and practice analysis experience.

## What lives here

- `app/page.tsx` - home dashboard and standings
- `app/sessions/[key]` - session detail views
- `app/sessions/[key]/telemetry` - qualifying telemetry, sector cards, performance matrix, braking analysis, and insight summary
- `app/predictions` - ML prediction surface
- `components/analysis` - race, practice, and braking analysis panels
- `components/telemetry` - telemetry-specific UI pieces

## Local development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) after the dev server starts.

## Useful checks

```bash
pnpm lint
pnpm build
```

## Telemetry UI notes

- Qualifying telemetry is segment-aware and supports `Q1`, `Q2`, and `Q3`
- Up to four drivers can be compared at once
- The telemetry page includes:
  - speed, throttle, brake, gear, RPM, and DRS traces
  - an interactive track map with braking markers
  - sector cards and lap comparison panels
  - a compact performance matrix
  - braking analysis for entry and exit comparison
  - a short insight card for quick takeaways

## Related docs

- [Root README](/Users/abdullahmusharaf/Desktop/F1/Pitwall/README.md)
- [Qualifying telemetry concept](/Users/abdullahmusharaf/Desktop/F1/Pitwall/docs/concepts/qualifying-telemetry.md)
