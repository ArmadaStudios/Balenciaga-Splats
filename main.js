import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

// ============================================================================
// Config
// ============================================================================

const SPLAT_URL = "./models/Model.sog";
const CAMERA_PATH_URL = "./camera_animation_supersplat.json";

// ============================================================================
// SUPERSPLAT TRANSFORM
// ============================================================================
//
// Values from SuperSplat:
//
// Position:  X = -5.55   Y = 0.16   Z = -0.6
// Rotation:  X = 0       Y = 80.84  Z = 0
// Scale:     0.8
//
// ============================================================================

// CALIBRATION - used for BOTH the splat mesh's base transform AND the
// camera path (via applyModelTransform below). Keep these matched to the
// camera path; do NOT use these to nudge the model around visually - see
// EXTRA_MODEL_* below for that. Moving/rotating/scaling model+path
// together by the same amount is a no-op for what's rendered (translating
// both by the same offset can't change their relative position; rotating
// both by the same amount is invariant too since camera.lookAt()
// reconstructs an equivalent view regardless, as world-up is unaffected
// by a Y rotation) - confirmed empirically for both.
const MODEL_POSITION = new THREE.Vector3(-5.55, 0.16, -0.6);
const MODEL_ROTATION_Y_DEG = 80.84;
const MODEL_SCALE = 0.8;

// Extra position offset and spin applied to the SPLAT MESH ONLY, on top of
// the calibration above - NOT applied to the camera path. This is how you
// actually SEE the model move/turn relative to the (fixed) camera path.
// This will, by design, throw the model out of position-alignment with
// the calibrated path - it's a deliberate visual/art-direction knob, not
// a re-calibration.
const EXTRA_MODEL_POSITION = new THREE.Vector3(1, -0.5, -5); // (5,...) - (-5.55,...) from your last edit
const EXTRA_MODEL_SPIN_DEG = -80.84;

// ============================================================================
// OpenCV -> OpenGL conversion
// ============================================================================
//
// Gaussian splats trained via COLMAP/3D-Gaussian-Splatting always store
// points in OpenCV camera convention: Y-down, camera forward = local +Z.
// Three.js/OpenGL is Y-up, camera forward = local -Z. This is NOT optional -
// it's a fact about how the raw .sog/.ply data (and the raw camera poses
// derived from the same COLMAP reconstruction) are encoded, so it must
// always be applied for the model to render right-side-up and for camera
// poses to face the correct direction. A 180 degree rotation around X
// flips both the Y (up/down) and Z (forward/backward) conventions at once.
//
const baseFlipQuat = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI
);

// The SuperSplat rotation is applied on top of the base flip, as a
// world-space offset (composed on the left).
const modelQuat = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(MODEL_ROTATION_Y_DEG))
  .multiply(baseFlipQuat);

// ============================================================================
// Scroll
// ============================================================================

const PX_PER_FRAME = 12;

// Time constant (seconds) for easing the camera toward the scroll position.
// Wheel scrolling moves in discrete ~100px notches; without easing each
// notch jumps the camera several path frames in one render. Higher = silkier
// but more "floaty" lag; 0 = the old direct 1:1 behavior.
const SCROLL_SMOOTHING = 0.18;

// ============================================================================
// Performance
// ============================================================================

// Quality over speed: full-res on hi-DPI screens (2x covers retina without
// going to 3x on phones) and all 3 spherical-harmonics bands, which carry
// the view-dependent sheen on the leather, metal hardware and softbox.
const MAX_PIXEL_RATIO = 2;
const SPLAT_MAX_SH = 3;
const SPLAT_LOD = false;

// ============================================================================
// Scene setup
// ============================================================================

const canvas = document.getElementById("canvas");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
  stencil: false,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

// ============================================================================
// Loading UI
// ============================================================================

const loadingEl = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const loadingFill = document.getElementById("loading-fill");

let splatLoaded = false;
let pathLoadError = null;

function maybeOpenDoors() {
  if (!splatLoaded || pathLoadError) return;

  loadingEl.classList.add("open");

  setTimeout(() => {
    loadingEl.style.display = "none";
  }, 1100);
}

// ============================================================================
// Splat mesh
// ============================================================================

const splatMesh = new SplatMesh({
  url: SPLAT_URL,
  editable: false,
  raycastable: false,

  onProgress: (event) => {
    if (pathLoadError) return;

    if (event.lengthComputable) {
      const pct = ((event.loaded / event.total) * 100).toFixed(1);
      loadingText.textContent = `${pct}%`;
      loadingFill.style.width = `${pct}%`;
    } else {
      loadingText.textContent = `${(event.loaded / 1e6).toFixed(0)} MB`;
    }
  },

  onLoad: (mesh) => {
    mesh.maxSh = SPLAT_MAX_SH;
    mesh.updateGenerator();

    splatLoaded = true;

    console.log("[splat] native bounding box:", mesh.getBoundingBox().min, mesh.getBoundingBox().max);

    logBoundsComparison();
    maybeOpenDoors();
  },

  lod: SPLAT_LOD,
  maxSh: SPLAT_MAX_SH,
});

// Splat mesh gets the calibration PLUS the extra visual-only spin/offset.
const splatOnlyQuat = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(EXTRA_MODEL_SPIN_DEG))
  .multiply(modelQuat);

splatMesh.quaternion.copy(splatOnlyQuat);
splatMesh.position.copy(MODEL_POSITION).add(EXTRA_MODEL_POSITION);
splatMesh.scale.setScalar(MODEL_SCALE);
scene.add(splatMesh);

// ============================================================================
// Model transform for the CAMERA PATH - uses the calibration only
// (modelQuat), deliberately NOT including EXTRA_MODEL_SPIN_DEG, so the
// path stays at its calibrated position regardless of the splat's extra
// spin above.
// ============================================================================

function applyModelTransform(point) {
  return point.clone().applyQuaternion(modelQuat).multiplyScalar(MODEL_SCALE).add(MODEL_POSITION);
}

// ============================================================================
// Camera path
// ============================================================================

let pathFrames = null; // [{ position: THREE.Vector3, lookAt: THREE.Vector3 }]

function pathBounds() {
  const box = new THREE.Box3();
  if (!pathFrames) return box;
  for (const frame of pathFrames) box.expandByPoint(frame.position);
  return box;
}

function logBoundsComparison() {
  if (!pathFrames) return;
  console.log("[camera path] bounding box:", pathBounds());
  console.log(
    "If the path box is much larger/smaller than the splat box above, " +
    "adjust MODEL_SCALE in main.js accordingly."
  );
}

// ============================================================================
// Parse SuperSplat camera pose
// ============================================================================
//
// { id, img_name, position: [x,y,z], rotation: [[..],[..],[..]] }
//
// rotation is a camera-to-world 3x3 matrix in OpenCV convention: column 2
// is the camera's local +Z axis, i.e. its forward direction. We only need
// that forward direction (to build a look-at point) - camera.lookAt()
// then derives the correct Three.js orientation (-Z forward) itself, so
// we never have to reinterpret the OpenCV rotation matrix as a Three.js
// quaternion directly (which is exactly where a forward-axis sign bug
// would hide).
//
function parseSuperSplatPose(entry) {
  const rawPosition = new THREE.Vector3(...entry.position);
  const forward = new THREE.Vector3(
    entry.rotation[0][2],
    entry.rotation[1][2],
    entry.rotation[2][2]
  );
  const rawLookAt = rawPosition.clone().add(forward);
  return { rawPosition, rawLookAt };
}

// ============================================================================
// Load camera path
// ============================================================================

async function loadCameraPath() {
  const res = await fetch(CAMERA_PATH_URL);
  if (!res.ok) {
    throw new Error(`Could not fetch ${CAMERA_PATH_URL} (${res.status})`);
  }

  const data = await res.json();
  const entries = (data.frames ?? data).slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  if (!entries.length) {
    throw new Error("Camera path contains no frames.");
  }

  const rawFrames = entries.map(parseSuperSplatPose);

  pathFrames = rawFrames.map(({ rawPosition, rawLookAt }) => ({
    position: applyModelTransform(rawPosition),
    lookAt: applyModelTransform(rawLookAt),
  }));

  console.log("[camera] loaded:", pathFrames.length, "frames");

  document.getElementById("scroll-spacer").style.height =
    `${pathFrames.length * PX_PER_FRAME + window.innerHeight}px`;

  logBoundsComparison();

  // ==========================================================================
  // Debug / tuning API - lets us re-derive frame 0 live from the console
  // without a full reload: window.__tune.apply(rotYDeg, {x,y,z}, scale)
  // ==========================================================================
  window.__tune = {
    rawFrames,
    splatMesh,
    camera,
    renderer,
    scene,
    baseFlipQuat,

    apply(rotYDeg = MODEL_ROTATION_Y_DEG, pos = MODEL_POSITION, scale = MODEL_SCALE) {
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(rotYDeg))
        .multiply(baseFlipQuat);

      splatMesh.quaternion.copy(q);
      splatMesh.position.set(pos.x, pos.y, pos.z);
      splatMesh.scale.setScalar(scale);

      const xform = (p) => p.clone().applyQuaternion(q).multiplyScalar(scale).add(pos);
      const f0 = rawFrames[0];
      const camPos = xform(f0.rawPosition);
      const lookAt = xform(f0.rawLookAt);

      camera.position.copy(camPos);
      camera.lookAt(lookAt);
      renderer.render(scene, camera);

      return { rotYDeg, camPos: camPos.toArray(), lookAt: lookAt.toArray() };
    },

    frame(index = 0) {
      if (!pathFrames || !pathFrames.length) return;
      const i = THREE.MathUtils.clamp(index, 0, pathFrames.length - 1);
      const f = pathFrames[i];
      camera.position.copy(f.position);
      camera.lookAt(f.lookAt);
      renderer.render(scene, camera);
      console.log(`[camera] frame ${i}`, f);
      return f;
    },
  };
}

// ============================================================================
// Camera animation from scroll
// ============================================================================
//
// Camera position/look-at is a deterministic function of scroll position,
// eased toward it with a frame-rate-independent exponential damp
// (SCROLL_SMOOTHING). No momentum beyond that: the camera settles on the
// exact scroll position within a fraction of a second of stopping.
//
let smoothedProgress = null;
let lastFrameTime = null;

function scrollProgress() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
  return THREE.MathUtils.clamp(progress, 0, 1);
}

function updateCameraFromScroll(snap = false) {
  if (!pathFrames || pathFrames.length < 2) return;

  const now = performance.now();
  const dt = lastFrameTime === null ? 0 : Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  const target = scrollProgress();

  if (snap || smoothedProgress === null || SCROLL_SMOOTHING <= 0) {
    smoothedProgress = target;
  } else {
    smoothedProgress += (target - smoothedProgress) * (1 - Math.exp(-dt / SCROLL_SMOOTHING));
    // Snap once within a hundredth of a path frame so it truly comes to rest.
    if (Math.abs(target - smoothedProgress) * (pathFrames.length - 1) < 0.01) {
      smoothedProgress = target;
    }
  }

  const floatIndex = smoothedProgress * (pathFrames.length - 1);
  const i0 = Math.floor(floatIndex);
  const i1 = Math.min(i0 + 1, pathFrames.length - 1);
  const t = floatIndex - i0;

  const a = pathFrames[i0];
  const b = pathFrames[i1];

  const position = a.position.clone().lerp(b.position, t);
  const lookAt = a.lookAt.clone().lerp(b.lookAt, t);

  camera.position.copy(position);
  camera.lookAt(lookAt);
}

// ============================================================================
// Render loop
// ============================================================================

renderer.setAnimationLoop(() => {
  updateCameraFromScroll();
  renderer.render(scene, camera);
});

// ============================================================================
// Resize
// ============================================================================

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
});

// ============================================================================
// Start
// ============================================================================

loadCameraPath()
  .then(() => {
    updateCameraFromScroll(true);
    maybeOpenDoors();
  })
  .catch((err) => {
    console.error("[camera] failed to load:", err);
    pathLoadError = err;
    loadingFill.style.width = "0%";
    loadingText.textContent = "Missing camera_animation_supersplat.json";
  });
