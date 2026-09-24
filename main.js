import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

// ============================================================================
// Config
// ============================================================================

const SPLAT_URL = new URLSearchParams(location.search).get("model") ?? "./models/Model_1m.sog";
const CAMERA_PATH_URL = "./camera_animation_supersplat.json";

// ============================================================================
// SUPERSPLAT MODEL TRANSFORM
// ============================================================================

const MODEL_POSITION = new THREE.Vector3(6, -0.2, -0.2);
const MODEL_ROTATION_Y_DEG = 80.84;
const MODEL_SCALE = 0.8;

const modelQuat = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  THREE.MathUtils.degToRad(MODEL_ROTATION_Y_DEG)
);

// 180° rotation around camera's local Y axis
const flip180Y = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI
);

// ============================================================================
// Scroll
// ============================================================================

const PX_PER_FRAME = 12;
const SCROLL_SMOOTHING = 0.18;

// ============================================================================
// Performance
// ============================================================================

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
// Splat Mesh
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
    maybeOpenDoors();
  },

  lod: SPLAT_LOD,
  maxSh: SPLAT_MAX_SH,
});

splatMesh.quaternion.copy(modelQuat);
splatMesh.position.copy(MODEL_POSITION);
splatMesh.scale.setScalar(MODEL_SCALE);
scene.add(splatMesh);

// ============================================================================
// Parse SuperSplat camera pose
// ============================================================================

function parseSuperSplatPose(entry) {
  const position = new THREE.Vector3(...entry.position);

  const rotMatrix = new THREE.Matrix4().set(
    entry.rotation[0][0], entry.rotation[0][1], entry.rotation[0][2], 0,
    entry.rotation[1][0], entry.rotation[1][1], entry.rotation[1][2], 0,
    entry.rotation[2][0], entry.rotation[2][1], entry.rotation[2][2], 0,
    0,                    0,                    0,                    1
  );

  // Apply 180° local Y rotation directly on the extracted quaternion
  const quaternion = new THREE.Quaternion()
    .setFromRotationMatrix(rotMatrix)
    .multiply(flip180Y);

  return { position, quaternion };
}

// ============================================================================
// Load camera path
// ============================================================================

let pathFrames = null;

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

  pathFrames = entries.map(parseSuperSplatPose);

  document.getElementById("scroll-spacer").style.height =
    `${pathFrames.length * PX_PER_FRAME + window.innerHeight}px`;
}

// ============================================================================
// Camera animation from scroll
// ============================================================================

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
    if (Math.abs(target - smoothedProgress) * (pathFrames.length - 1) < 0.01) {
      smoothedProgress = target;
    }
  }

  const floatIndex = smoothedProgress * (pathFrames.length - 1);
  updateCaptions(floatIndex + 1); // path index 0 = Blender frame 1

  const i0 = Math.floor(floatIndex);
  const i1 = Math.min(i0 + 1, pathFrames.length - 1);
  const t = floatIndex - i0;

  const a = pathFrames[i0];
  const b = pathFrames[i1];

  camera.position.lerpVectors(a.position, b.position, t);
  camera.quaternion.slerpQuaternions(a.quaternion, b.quaternion, t);
}

// ============================================================================
// Captions
// ============================================================================
//
// Each .caption in index.html shows from data-start for data-duration
// frames (Blender frame numbers, same timeline as the camera path). The
// reveal itself is a time-based CSS transition triggered by .visible, so it
// always plays out elegantly regardless of scroll speed; --p (0 -> 1 across
// the window) drives the scroll-linked 3D drift.
//
const captions = [...document.querySelectorAll(".caption")].map((el) => {
  const text = el.querySelector(".caption-text");
  const label = text.textContent.trim();
  text.setAttribute("aria-label", label);
  text.textContent = "";
  [...label].forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = ch === " " ? "char space" : "char";
    span.textContent = ch === " " ? " " : ch;
    span.style.setProperty("--i", i);
    span.setAttribute("aria-hidden", "true");
    text.appendChild(span);
  });
  el.classList.add("ready");

  return {
    el,
    start: Number(el.dataset.start),
    duration: Number(el.dataset.duration),
    visible: false,
  };
});

function updateCaptions(frame) {
  for (const c of captions) {
    const p = (frame - c.start) / c.duration;
    const visible = p >= 0 && p <= 1;

    if (visible !== c.visible) {
      c.visible = visible;
      c.el.classList.toggle("visible", visible);
    }

    c.el.style.setProperty("--p", THREE.MathUtils.clamp(p, 0, 1).toFixed(4));
  }
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