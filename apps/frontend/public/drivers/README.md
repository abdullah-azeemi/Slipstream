# Private driver images

Drop transparent PNG cutouts here, named by driver code in lowercase:

    sai.png  ver.png  ham.png ...

Everything in this folder except this README is gitignored, so the photos never
reach the public repository. The driver page falls back automatically when a
file is missing (headshot, then a team-coloured number).

## Adding or changing an image

1. Add `<code>.png` here (transparent background, ideally 1000px+ tall).
2. Run `python3 scripts/trim-driver-images.py` from `apps/frontend`. It trims
   transparent margins and backs the originals up to `_original/`.
3. Set its framing in `lib/driver-framing.ts`: `crop` if cut off at the thighs
   or torso, `full` if the shoes are visible, plus a height percentage.
