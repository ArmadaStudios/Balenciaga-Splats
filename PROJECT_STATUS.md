# Balenciaga Scroll — Project Status

Last updated: 2026-09-24

## What this is

A scrollytelling web experience: scrolling drives a camera through a
gaussian-splat 3D capture of a Balenciaga product photography studio, ending
on a close-up of a bag. The camera path was authored in Blender (cubes =
positions, spheres = look-at targets), exported, and is now replayed live in
the browser as the user scrolls — no video, no fixed frame sequence in the
current active version (see "Two parallel approaches" below).

**Repo**: `https://github.com/ArmadaStudios/Balenciaga-Scroll` (branch `main`,
currently up to date with origin; uncommitted local changes to
`index.html`/`main.js`/`server.js` and an untracked `models/` — see
"Known issues" re: repo size before committing/pushing the model).

**Run it**: `node server.js` from this folder, then open `http://localhost:5173`.
Zero npm dependencies — `server.js` is a from-scratch static file server.

## Two parallel approaches — know which one you're looking at

This project went through a major pivot partway through. Both versions still
exist on disk; **the live Spark/Three.js version (in this folder) is the
current active one.**

1. **Live gaussian-splat rendering (CURRENT / ACTIVE)** — this folder
   (`Balenciaga Scroll/Balenciaga Scroll/`). Three.js + Spark
   (`@sparkjsdev/spark`, loaded via CDN import map in `index.html`) render
   the compressed `.sog` splat model live in-browser; the camera moves
   through it directly as a function of scroll position.
2. **Pre-rendered frame-sequence (BACKUP / INACTIVE)** —
   `../frame-sequence-backup/` and, for reference, the `frames/` folder and
   `generate-frames-manifest.js` still sitting in *this* folder too (unused
   by the current `main.js`, safe to ignore or delete). This approach
   rendered the camera path out of Blender/SuperSplat as ~1565 PNG frames
   and scrubbed through them like a flipbook on scroll. It was dropped in
   favor of the live-render approach for flexibility, but the code still
   works if you ever want to revert (swap `index.html`/`main.js` for the
   backup copies).

## File map (active version)

| File | Purpose |
|---|---|
| `index.html` | Page shell: canvas, scrollbar-hiding CSS, loading screen with logo + "door opening" reveal transition, Three.js/Spark CDN import map |
| `main.js` | All the app logic — scene setup, splat loading, camera-path loading/parsing, scroll→camera binding, render loop |
| `server.js` | Zero-dependency static file server (`node server.js`, port 5173). No caching on `.html`/`.js`/`.json` so edits always show up on reload |
| `models/Model.sog` | Compressed gaussian splat (~81MB). **Not committed to git** — see Known Issues |
| `camera_animation.json` | Raw Blender export (location + look_at per frame, Blender Z-up coords) — **not used by current `main.js`**, kept for reference/regeneration |
| `camera_animation_supersplat.json` | **This is what `main.js` actually loads.** INRIA/SuperSplat camera-pose format (position + 3×3 rotation matrix per frame), in splat-native/OpenCV coordinate space. Generated from `camera_animation.json` by `../../web/convert-to-supersplat-poses.js` (in the old `web/` folder — see below) |
| `Balenciaga-logo.png` | Loading-screen logo (black-on-white; CSS `filter: invert(1)` makes it render white-on-black) |
| `frames/`, `frames-manifest.json`, `generate-frames-manifest.js` | Leftover from the frame-sequence approach; unused by current `main.js` |

### Related files elsewhere

- `C:\Users\ARMADA\Documents\PhotogPlan\export_camera_path.py` — Blender
  script, run inside Blender, exports the camera animation to
  `camera_animation.json` (writes to the **old** `web/public/...` path —
  if you re-run it, you'll need to copy the output into this folder, or
  update the script's output path)
- `C:\Users\ARMADA\Documents\PhotogPlan\camera_path_animator.py` — Blender
  script that builds the actual camera animation from cube/sphere keypoints
  (easing, hold behavior, etc. all configured here)
- `C:\Users\ARMADA\Documents\PhotogPlan\web\convert-to-supersplat-poses.js`
  — converts `camera_animation.json` → the INRIA/SuperSplat pose format.
  Re-run this (`node convert-to-supersplat-poses.js` from `web/`) any time
  the Blender camera path changes, then copy the output
  `camera_animation_supersplat.json` into this folder
- `C:\Users\ARMADA\Documents\PhotogPlan\web\public-spark-live-backup\` —
  earlier backup of the Spark live-render approach, from before the move
  into the standalone `Balenciaga Scroll` repo

## How the transform/alignment system works (IMPORTANT — read before tuning)

This is the part most likely to confuse a fresh session, because it's
counterintuitive and cost a lot of back-and-forth to figure out.

### The core fact: moving "everything" together is invisible

`main.js` has two logically separate sets of transform constants:

```js
// CALIBRATION — used for the splat's base transform AND the camera path
const MODEL_POSITION = new THREE.Vector3(-5.55, 0.16, -0.6);
const MODEL_ROTATION_Y_DEG = 80.84;
const MODEL_SCALE = 0.8;

// EXTRA — applied to the splat mesh ONLY, not the camera path
const EXTRA_MODEL_POSITION = new THREE.Vector3(0, 0, 1);
const EXTRA_MODEL_SPIN_DEG = -80;
```

**If you translate/rotate/scale the model and the camera path by the exact
same amount, the rendered image does not change at all.** This was
confirmed empirically (not just in theory) multiple times this session:
changing `MODEL_POSITION` or `MODEL_ROTATION_Y_DEG` alone produced zero
visible difference, because both the splat mesh *and* every camera-path
point go through `applyModelTransform()`, which applies the identical
transform to both. Moving the observer and the observed by the same rigid
transform can't change what the observer sees.

**Rule going forward: never tune `MODEL_POSITION` / `MODEL_ROTATION_Y_DEG` /
`MODEL_SCALE` expecting a visible change — they're calibration, and are
deliberately shared with the camera path.** To actually move/rotate the
model relative to the (fixed) camera path, use `EXTRA_MODEL_POSITION` /
`EXTRA_MODEL_SPIN_DEG`, which are applied to the splat mesh only. Using
these will, by design, throw the model out of alignment with the
calibrated path — that's expected if you're using them, not a bug.

### The `window.__tune` debug harness

`main.js` exposes `window.__tune` in the browser console after the camera
path loads, for fast iteration without reloading:

- `__tune.apply(rotYDeg, {x,y,z}, scale)` — recompute frame 0's camera pose
  and the splat's transform live, using a **fresh** rotation/position/scale
  triple (not the "extra on top of calibration" pattern above — this
  applies the given values as the *entire* transform, useful for from-
  scratch alignment sweeps)
- `__tune.frame(index)` — jump the camera to any path index and render it,
  for inspecting a specific point in the path
- `__tune.rawFrames` — the untransformed camera poses, if you need to
  recompute anything from scratch

### Axis/coordinate conventions (the other big source of bugs)

- **Blender**: Z-up, right-handed.
- **Three.js/OpenGL**: Y-up, right-handed, camera looks down local **−Z**.
- **COLMAP/OpenCV** (how the raw `.sog`/`.ply` splat data, and the rotation
  matrices in `camera_animation_supersplat.json`, are actually encoded):
  Y-down, camera looks down local **+Z**.

`camera_animation_supersplat.json` is in the **splat-native/OpenCV**
convention, not Blender's — it was generated specifically to be in the same
space as the raw model, so the *same* transform chain applies to both (see
`baseFlipQuat`, the mandatory 180°-around-X correction, in `main.js`).

**Known past bug, fixed**: naively converting the JSON's 3×3 rotation
matrix into a Three.js quaternion via `setFromRotationMatrix()` produces a
camera facing *backward* (OpenCV forward=+Z reinterpreted as if it were
Three.js's forward=−Z). The current code sidesteps this entirely: it only
uses the rotation matrix's third column (forward direction) to compute a
look-at *point*, then calls `camera.lookAt()`, which derives the correct
orientation by construction. **Do not "simplify" this back to a direct
quaternion conversion** — that's exactly the bug that was fixed.

## Current alignment state

The camera path is calibrated against the splat using the "SuperSplat
transform" values (`MODEL_POSITION`/`MODEL_ROTATION_Y_DEG`/`MODEL_SCALE`
above) and has been verified correct at the start, a mid-path point, and
the end of the scroll (matches the ground-truth rendered frames in
`frames/output_042.png` etc.). `EXTRA_MODEL_POSITION`/`EXTRA_MODEL_SPIN_DEG`
are currently non-zero (mid-tuning, last requested was "rotate the model
-45°/-80° and offset it") — **these are art-direction experiments, not a
broken state**. Reset both to `(0,0,0)` / `0` to get back to the verified-
correct calibrated alignment if needed.

One still-unresolved thread: the user showed a reference screenshot (camera
looking through a doorway into the studio) that was never successfully
reproduced at scroll position 0 despite an extensive rotation sweep (0–330°
in 30° steps via `__tune.apply()`). Best guess raised but not confirmed:
that reference may be from an earlier, now-superseded version of the
Blender camera path (the path/export was regenerated many times this
session). Closest match found was ~200° rotation (recognizable room,
matching green EXIT sign, but not an exact match). If picking this back up,
compare against the *current* `frames/output_042.png` (actual Blender/
SuperSplat render, most authoritative ground truth) rather than trusting
memory of what things looked like earlier in the session.

## Performance settings (Spark)

In `main.js`:
- `antialias: false`, `powerPreference: "high-performance"`, pixel ratio
  capped at `MAX_PIXEL_RATIO = 1.5`
- `SPLAT_MAX_SH = 1` (spherical-harmonics bands reduced from default 3 —
  cuts per-splat shader cost, some loss of view-dependent specular detail)
- `SPLAT_LOD = false` — **deliberately**. Enabling Spark's LOD was tried
  and reverted: it added a ~17.6s blocking "Tiny LoD" build on load and
  *increased* the splat count (6.0M → 7.8M) in testing. LOD is meant for
  large open scenes with distant geometry; this is a single bounded room
  the camera stays inside, so it's pure overhead here.

## Known issues / things to watch

1. **Repo size**: earlier version of this project (before the SuperSplat
   pivot) hit ~7.8GB between PNG frame history and no Git LFS, which made
   pushing to GitHub fail. Current `models/Model.sog` (81MB) is
   **untracked** in git — if you `git add` it, consider Git LFS, and know
   that **GitHub Pages cannot serve LFS-tracked files** (they resolve to
   tiny pointer files), so LFS + GitHub Pages is not a working combo for
   hosting this. Unresolved: where to actually host the final site was
   never decided (options discussed: compress frames further, host the
   model on a CDN/object storage separate from the repo, or switch to a
   compressed video + `<video>` scrubbing approach).
2. **`frames/` folder here is stale relative to `frames-manifest.json`**
   possibly — if you revert to the frame-sequence approach, regenerate the
   manifest first (`node generate-frames-manifest.js`).
3. **Browser console message buffering**: when debugging via the Claude
   Code browser tool, `read_console_messages` can return *stale* messages
   from a previous page load, not the current state. Always cross-check
   with a direct `fetch()`/state query (e.g. `window.__tune.camera.position`)
   before trusting console output as "current."
4. `export_camera_path.py` writes to an old path under `web/public/...` —
   if re-run, copy its output into this folder manually (or update the
   script).

## Suggested next steps

- Decide on final hosting approach (see Known Issues #1) before doing
  more polish work — it affects whether further size optimization matters.
- If continuing the doorway-shot alignment search: pull up
  `frames/output_042.png` (or scan a range of `frames/output_0NN.png`) side
  by side with live `__tune.apply()` sweeps rather than relying on memory.
- Reset `EXTRA_MODEL_POSITION`/`EXTRA_MODEL_SPIN_DEG` to zero if you want
  to return to the last verified-correct alignment before experimenting
  further.
- Consider deleting the unused `frames/`, `frames-manifest.json`,
  `generate-frames-manifest.js`, `camera_animation.json` from this folder
  if the frame-sequence approach is confirmed permanently abandoned (they're
  safely preserved in `../frame-sequence-backup/` and the Blender export
  script regardless).
