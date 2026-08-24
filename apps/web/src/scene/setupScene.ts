import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { sunPosition } from "./sun";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { fitProjectedExtent } from "./fitProjectedExtent";
import type { AoiManifest } from "@siahra/shared-types";

export type MapTool = "select" | "pan";

/** CSS-pixel insets covered by floating UI, so framing centres the free area. */
export interface SafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export interface SceneHandles {
  scene: THREE.Scene;
  /**
   * All georeferenced layers live under this group so vertical exaggeration
   * can be applied uniformly (terrain, buildings, rings and boundary all
   * scale together and stay mutually consistent).
   */
  world: THREE.Group;
  /**
   * Screen-sized markers (sprites) that must NOT be stretched by the
   * exaggeration — they reposition themselves via applyExaggeration.
   */
  markers: THREE.Group;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Frames the camera on a loaded AOI's real extent. */
  frameTerrain: (manifest: AoiManifest, groundZ: number, safeArea?: SafeArea) => void;
  /** Vertical exaggeration factor; 1 = true 1:1 scale. */
  setExaggeration: (factor: number) => void;
  getExaggeration: () => number;
  setTool: (tool: MapTool) => void;
  /** Rotates the view back to north-up, keeping distance and tilt. */
  resetNorth: () => void;
  /** Smoothly moves the orbit target/camera (scene metres). */
  flyTo: (target: THREE.Vector3, distance?: number, durationMs?: number) => void;
  /** Camera pose for permalinks. */
  getPose: () => CameraPose;
  setPose: (pose: CameraPose) => void;
  /** Renders one frame and returns it as a PNG blob (with the label baked in). */
  captureImage: (footer: string) => Promise<Blob | null>;
  /**
   * Lights the scene for a real moment (sun/sky from date + lat/lon), or
   * `null` to return to the fixed studio light. Night keeps a readable floor.
   */
  setSunTime: (date: Date | null, latDeg: number, lonDeg: number) => void;
  /** Rendering quality knobs (see scene/quality.ts). */
  setPixelRatio: (ratio: number) => void;
  setShadows: (enabled: boolean) => void;
  /** Smoothed frame time in ms. */
  frameTimeMs: () => number;
  /**
   * True while the camera is moving (drag, zoom, damping, flyTo). Frames run
   * at the full rate then and at a lower idle rate otherwise, so per-frame work
   * that only matters when the view changes can be throttled on the same signal.
   */
  isCameraActive: () => boolean;
  /** Called every frame with elapsed seconds. Returns an unsubscribe. */
  addTicker: (fn: (timeS: number) => void) => () => void;
  /** Called with drawing-buffer size on resize (and once immediately). */
  onResize: (fn: (width: number, height: number) => void) => () => void;
  /** Called whenever the camera moves; heading is degrees clockwise from north. */
  onCameraChange: (fn: (headingDeg: number) => void) => () => void;
  viewportHeightPx: () => number;
  /** ตัวนับสำหรับดีบัก (DEV เท่านั้น) — ดู SceneDebug */
  debug: SceneDebug;
  dispose: () => void;
}

/**
 * ที่รวมตัวนับสำหรับดีบักใน DEV — เปิดผ่าน `__siahraHandles.debug.snapshot()`
 *
 * มีไว้เพื่อให้ "นับได้" แทนที่จะ "กะเอาจากภาพ": จำนวนครั้งที่ LOD สลับ
 * split/merge, จำนวน mesh ที่สร้าง/คืน และตัวเลขจาก `renderer.info` ซึ่งเป็น
 * หลักฐานว่าฮิสเทอรีซิสไม่ได้เปลี่ยนอาการกระพริบให้กลายเป็นการรั่วของ GPU
 *
 * `renderer` ถูกสร้างใหม่ทุกครั้งที่สลับจังหวัด (effect ใน Map3DCanvas ผูกกับ
 * `aoiId`) ตัวเลขใน `renderer.info` จึงรีเซ็ตตามไปด้วย — การเทียบข้ามจังหวัด
 * ต้องดูที่ค่า "คงตัว" ของแต่ละรอบคู่กับตัวนับ created/disposed ของ provider
 */
export interface SceneDebug {
  /** ผู้ผลิตตัวเลขลงทะเบียนไว้ที่นี่ คืนฟังก์ชันถอนการลงทะเบียน */
  register: (name: string, read: () => unknown) => () => void;
  /** อ่านทุกตัวนับในครั้งเดียว */
  snapshot: () => Record<string, unknown>;
}

const BG = 0x070b14;
/** Aerial-perspective haze colour, matched to the sky dome's horizon. */
const HAZE = 0x7f97b3;

/**
 * Plain imperative Three.js setup (no @react-three/fiber) — see
 * Workstream A of the implementation plan: keeping this as raw scene-graph
 * code makes early rendering bugs (wrong scale, flipped axis, black screen)
 * easy to isolate.
 */
export function setupScene(container: HTMLDivElement): SceneHandles {
  const scene = new THREE.Scene();
  scene.background = null; // sky gradient comes from the container's CSS
  scene.fog = new THREE.Fog(HAZE, 3000, 9000);

  const world = new THREE.Group();
  world.name = "world";
  scene.add(world);
  // Dev-only handle for poking at the scene from the console / headless tests.
  if (import.meta.env.DEV) (window as unknown as { __siahraScene?: THREE.Scene }).__siahraScene = scene;
  const markers = new THREE.Group();
  markers.name = "markers";
  scene.add(markers);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    10,
    20000,
  );
  camera.position.set(0, 2600, 3400);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(BG, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The shadow map is re-rendered only when the fit actually changes (see
  // fitShadowCamera) — otherwise a still camera would redraw the whole
  // province into a 2048² depth buffer on every single frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.inset = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  labelRenderer.domElement.style.overflow = "hidden";
  // CSS2DRenderer assigns z-index to every label; isolate them in their own
  // stacking context so they never paint over the floating UI panels.
  labelRenderer.domElement.style.zIndex = "0";
  labelRenderer.domElement.style.isolation = "isolate";
  container.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 300;
  controls.maxDistance = 8000;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.7;
  controls.panSpeed = 0.9;
  controls.screenSpacePanning = false;
  controls.target.set(0, 0, 0);
  controls.update();

  // Satellite imagery is already lit by the sun, so lighting is mostly a
  // soft sky/ground ambient with one warm key light for relief and shadows.
  // Intensities are in three's physically-based units, where daylight needs
  // several units to read as daylight.
  const hemi = new THREE.HemisphereLight(0xdde9ff, 0x4a3f2c, 2.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  sun.position.set(-2200, 3200, 1800);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 2;
  scene.add(sun);
  scene.add(sun.target);

  // Physically based sky dome (Preetham/Hosek-style) so tilted views get a
  // hazy horizon and the province dissolves into atmosphere, not into black.
  const sky = new Sky();
  sky.name = "sky";
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = 4.5;
  skyU.rayleigh.value = 1.0;
  skyU.mieCoefficient.value = 0.004;
  skyU.mieDirectionalG.value = 0.8;
  // Only the hemisphere above the horizon is drawn — below it the dome fades
  // out so the map keeps floating on the dark UI ground instead of a grey
  // "underground". Also tamed: the stock dome is HDR-bright at our exposure.
  sky.material.transparent = true;
  sky.material.depthWrite = false;
  sky.material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor = vec4( texColor, 1.0 );",
      "gl_FragColor = vec4( texColor * 0.55, smoothstep( -0.02, 0.06, direction.y ) * 0.9 );",
    );
  };
  sky.renderOrder = -10;
  scene.add(sky);

  // Shadow-map refit state (see fitShadowCamera). Declared here because
  // syncSky, which runs during setup, invalidates the baked map.
  const shadowCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  const shadowTarget = new THREE.Vector3(Infinity, Infinity, Infinity);
  let shadowFitAt = 0;
  /** Set when something other than the camera invalidates the shadow map. */
  let shadowDirty = true;
  const SHADOW_HEARTBEAT_MS = 500;

  const syncSky = () => {
    const dir = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
    skyU.sunPosition.value.copy(dir);
    sky.scale.setScalar(camera.far * 0.85);
    // Every caller has just moved the sun, so the baked shadow map is stale.
    shadowDirty = true;
  };
  syncSky();

  let exaggeration = 1;
  let frameRadius = 30000;
  let frameTarget = new THREE.Vector3();
  const studioSunDir = new THREE.Vector3(-1.1, 1.5, 0.4).normalize();
  const tickers = new Set<(t: number) => void>();
  const resizeFns = new Set<(w: number, h: number) => void>();
  const cameraFns = new Set<(heading: number) => void>();

  const headingDeg = () => {
    const dx = camera.position.x - controls.target.x;
    const dz = camera.position.z - controls.target.z;
    // Camera south of the target (+z) looking north => heading 0.
    return ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
  };
  // Anything that moves the camera (drag, zoom, damping, flyTo) marks the view
  // "active" so the frame budget switches from the idle rate to the full rate.
  let lastInteractionAt = performance.now();
  controls.addEventListener("change", () => {
    lastInteractionAt = performance.now();
    const h = headingDeg();
    cameraFns.forEach((fn) => fn(h));
  });

  const frameTerrain = (manifest: AoiManifest, groundZ: number, safeArea?: SafeArea) => {
    const spanX = manifest.terrain.width * manifest.terrain.cellSizeM;
    const spanZ = manifest.terrain.height * manifest.terrain.cellSizeM;
    // Province polygons rarely fill their bbox; frame a little tighter than
    // the raster so the province, not the clip rectangle, fills the view.
    const radius = (Math.max(spanX, spanZ) / 2) * 0.86;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const sa = safeArea ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const freeW = Math.max(200, width - sa.left - sa.right);
    const freeH = Math.max(200, height - sa.top - sa.bottom);

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const tanHalfV = Math.tan(vFov / 2);
    // Fit both the free height and the free width (as fractions of the view).
    const distV = radius / (tanHalfV * (freeH / height));
    const distH = radius / (tanHalfV * camera.aspect * (freeW / width));
    let distance = Math.max(distV, distH) * 1.02;

    // Look down from the south-south-east: high enough to read the whole
    // province (a shallow angle makes flat provinces like Bangkok a
    // featureless edge) but tilted enough that relief reads.
    const elevation = THREE.MathUtils.degToRad(50);
    const azimuth = THREE.MathUtils.degToRad(12);
    const dir = new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
    );

    const groundY = groundZ * exaggeration;
    /** วางกล้องที่ระยะ d แล้วเลื่อนให้ภูมิประเทศอยู่กลางพื้นที่ว่าง — คืน target ที่เลื่อนแล้ว */
    const place = (d: number): THREE.Vector3 => {
      const target = new THREE.Vector3(0, groundY, 0);
      camera.position.copy(target).addScaledVector(dir, d);
      camera.lookAt(target);
      camera.near = Math.max(1, d * 0.004);
      camera.far = d * 10;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      // Shift so the terrain is centred in the free area, not the full canvas.
      const offsetXpx = (sa.left - sa.right) / 2;
      const offsetYpx = (sa.top - sa.bottom) / 2;
      const worldPerPx = (2 * d * tanHalfV) / height;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const shift = new THREE.Vector3()
        .addScaledVector(right, -offsetXpx * worldPerPx)
        .addScaledVector(up, offsetYpx * worldPerPx);
      target.add(shift);
      camera.position.add(shift);
      camera.updateMatrixWorld();
      return target;
    };
    let target = place(distance);

    // การแก้ความเอียง (tilt asymmetry): ทรงกลมล้อม + 0.86 ข้างบนคือการเดาแรกที่คง
    // ไว้ (จังหวัดที่พอดีอยู่แล้วไม่ขยับ) แต่กล้องเอียง 50° ทำให้ขอบใกล้ (ทิศใต้)
    // ของจังหวัดที่สูงตามแกนเหนือ-ใต้ถูกฉายเลยวงกลมที่ฟิตไว้ลงไปใต้ dock — QA วัดได้
    // 13–62 px ที่ 1024–1440 (น่าน 19 px, เชียงใหม่ 38–62 px) จึงฉายมุมทั้งสี่ของ
    // bbox ภูมิประเทศที่ระดับพื้น เทียบกับกรอบพื้นที่ว่าง แล้วถอยกล้องตามอัตราส่วน
    // ที่เกินออกมา (`fitProjectedExtent`) — perspective ไม่เป็นเชิงเส้นกับระยะ แต่
    // สองรอบก็ลู่เข้าแล้ว
    const corners = [
      [-spanX / 2, -spanZ / 2],
      [spanX / 2, -spanZ / 2],
      [-spanX / 2, spanZ / 2],
      [spanX / 2, spanZ / 2],
    ];
    const free = { left: sa.left, top: sa.top, right: width - sa.right, bottom: height - sa.bottom };
    for (let pass = 0; pass < 2; pass++) {
      const projected = corners.map(([x, z]) => {
        const v = new THREE.Vector3(x, groundY, z).project(camera);
        return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
      });
      const scale = fitProjectedExtent(projected, free);
      if (scale <= 1) break;
      distance *= scale * 1.02;
      target = place(distance);
    }

    controls.target.copy(target);
    controls.minDistance = radius * 0.04;
    controls.maxDistance = distance * 2.2;
    controls.update();

    // Keep fog beyond the framed extent so the province is not washed out;
    // it fades far terrain into the sky's haze rather than into black.
    scene.fog = new THREE.Fog(HAZE, distance * 1.6, distance * 5.5);

    frameRadius = radius;
    frameTarget = target.clone();
    sun.position.copy(target).addScaledVector(studioSunDir, radius * 2);
    sun.target.position.copy(target);
    sun.target.updateMatrixWorld();
    syncSky();

    cameraFns.forEach((fn) => fn(headingDeg()));
  };

  const setExaggeration = (factor: number) => {
    // Keep the orbit target on the (rescaled) ground so zoom/rotate stay natural.
    const groundY = world.scale.y > 0 ? controls.target.y / world.scale.y : controls.target.y;
    exaggeration = factor;
    world.scale.y = factor;
    shadowDirty = true; // geometry moved vertically, camera may not have
    const dy = groundY * factor - controls.target.y;
    controls.target.y += dy;
    camera.position.y += dy;
    controls.update();
  };

  const setTool = (tool: MapTool) => {
    controls.mouseButtons.LEFT = tool === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = tool === "pan" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.touches.ONE = tool === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  };

  let fly: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromCam: THREE.Vector3;
    toCam: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;
  const flyTo = (target: THREE.Vector3, distance?: number, durationMs = 900) => {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    if (distance !== undefined) {
      offset.setLength(THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance));
    }
    fly = {
      from: controls.target.clone(),
      to: target.clone(),
      fromCam: camera.position.clone(),
      toCam: target.clone().add(offset),
      start: performance.now(),
      duration: durationMs,
    };
  };
  const getPose = (): CameraPose => ({
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
  });
  const setPose = (pose: CameraPose) => {
    fly = null;
    camera.position.set(...pose.position);
    controls.target.set(...pose.target);
    controls.update();
  };
  const captureImage = async (footer: string): Promise<Blob | null> => {
    // The drawing buffer is not preserved, so render and read back in one task.
    renderer.render(scene, camera);
    const src = renderer.domElement;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    const scale = renderer.getPixelRatio();
    const pad = 12 * scale;
    ctx.font = `${12 * scale}px Sarabun, sans-serif`;
    const w = ctx.measureText(footer).width + pad * 2;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, out.height - 28 * scale, w, 28 * scale);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(footer, pad, out.height - 10 * scale);
    return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
  };

  const resetNorth = () => {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const horizontal = Math.hypot(offset.x, offset.z);
    offset.x = 0;
    offset.z = horizontal;
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };

  // --- Sun by time --------------------------------------------------------
  const setSunTime = (date: Date | null, latDeg: number, lonDeg: number) => {
    if (!date) {
      sun.color.set(0xfff3e0);
      sun.intensity = 2.6;
      hemi.intensity = 2.6;
      hemi.color.set(0xdde9ff);
      renderer.toneMappingExposure = 1.22;
      sun.position.copy(frameTarget).addScaledVector(studioSunDir, frameRadius * 2);
      sun.target.position.copy(frameTarget);
      sun.target.updateMatrixWorld();
      syncSky();
      return;
    }
    const sp = sunPosition(date, latDeg, lonDeg);
    // Never let the sun drop below ~-2°: below the horizon a hazard map should
    // stay legible (dim, blue ambient), not go black.
    const el = THREE.MathUtils.degToRad(Math.max(-2, sp.elevationDeg));
    const az = THREE.MathUtils.degToRad(sp.azimuthDeg);
    // az clockwise from north; scene: north = -z, east = +x.
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const day = THREE.MathUtils.smoothstep(sp.elevationDeg, -6, 12); // 0 night → 1 day
    const low = 1 - THREE.MathUtils.smoothstep(sp.elevationDeg, 5, 30); // warmth near horizon
    sun.color.setRGB(1.0, THREE.MathUtils.lerp(0.95, 0.72, low), THREE.MathUtils.lerp(0.88, 0.45, low));
    sun.intensity = THREE.MathUtils.lerp(0.15, 2.6, day);
    hemi.intensity = THREE.MathUtils.lerp(0.9, 2.6, day);
    hemi.color.setRGB(THREE.MathUtils.lerp(0.55, 0.87, day), THREE.MathUtils.lerp(0.62, 0.91, day), 1.0);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.9, 1.22, day);
    sun.position.copy(frameTarget).addScaledVector(dir, frameRadius * 2);
    sun.target.position.copy(frameTarget);
    sun.target.updateMatrixWorld();
    syncSky();
  };

  // --- Quality knobs --------------------------------------------------------
  const setPixelRatio = (ratio: number) => {
    renderer.setPixelRatio(ratio);
    applySize();
  };
  const setShadows = (enabled: boolean) => {
    if (renderer.shadowMap.enabled === enabled) return;
    renderer.shadowMap.enabled = enabled;
    sun.castShadow = enabled;
    shadowDirty = true;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => {
        mm.needsUpdate = true;
      });
    });
  };
  let frameEma = 16;
  let lastFrameAt = performance.now();
  let wasActive = false;

  /**
   * Shadow "cascade-lite": the single shadow camera is refitted around the
   * orbit target with an extent tied to the viewing distance, so shadows are
   * sharp when zoomed in and still cover the province from afar.
   *
   * The refit (and the shadow-map redraw it implies) happens only when the
   * camera actually moved, plus a slow heartbeat so tiles that stream in later
   * still get baked. A still camera therefore costs no second draw pass.
   */
  const fitShadowCamera = (now: number) => {
    if (!renderer.shadowMap.enabled) return;
    const dist = camera.position.distanceTo(controls.target);
    const eps = Math.max(0.5, dist * 5e-4);
    const moved =
      shadowCamPos.distanceToSquared(camera.position) > eps * eps ||
      shadowTarget.distanceToSquared(controls.target) > eps * eps;
    if (!moved && !shadowDirty && now - shadowFitAt < SHADOW_HEARTBEAT_MS) return;
    shadowCamPos.copy(camera.position);
    shadowTarget.copy(controls.target);
    shadowFitAt = now;
    shadowDirty = false;
    renderer.shadowMap.needsUpdate = true;
    const extent = THREE.MathUtils.clamp(dist * 1.6, 1500, frameRadius * 1.3);
    const dir = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
    sun.target.position.copy(controls.target);
    sun.position.copy(controls.target).addScaledVector(dir, extent * 3);
    sun.target.updateMatrixWorld();
    const sc = sun.shadow.camera;
    sc.left = -extent;
    sc.right = extent;
    sc.top = extent;
    sc.bottom = -extent;
    sc.near = 10;
    sc.far = extent * 8;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0002 - extent * 1e-8;
    sun.shadow.normalBias = Math.max(1, extent / 1500);
  };

  const startMs = performance.now();
  let frameId = 0;
  /**
   * Frame budget. rAF fires at the display refresh — 120 Hz on a ProMotion
   * MacBook — which doubles GPU work for no visible gain on a map. Frames are
   * throttled to ACTIVE_FPS while the camera moves and IDLE_FPS once it
   * settles; the rAF callback still runs (it is cheap) but the draw is skipped.
   */
  const ACTIVE_FPS = 60;
  const IDLE_FPS = 30;
  /** How long after the last camera change the view still counts as active. */
  const ACTIVE_TAIL_MS = 400;
  /** Slack so a 120 Hz cadence lands on every 2nd/4th frame, not every 3rd/5th. */
  const BUDGET_SLACK_MS = 2;
  let lastDrawAt = 0;

  const animate = () => {
    frameId = requestAnimationFrame(animate);
    const now = performance.now();
    const active = fly !== null || now - lastInteractionAt < ACTIVE_TAIL_MS;
    const budget = 1000 / (active ? ACTIVE_FPS : IDLE_FPS) - BUDGET_SLACK_MS;
    if (now - lastDrawAt < budget) return;
    lastDrawAt = now;
    // Only interactive frames feed the quality heuristic: an idle frame is
    // slow by design (we asked for 30 Hz) and must not trigger a downgrade.
    if (active && wasActive) frameEma = frameEma * 0.9 + Math.min(now - lastFrameAt, 100) * 0.1;
    wasActive = active;
    lastFrameAt = now;
    fitShadowCamera(now);
    const t = (now - startMs) / 1000;
    if (fly) {
      const k = Math.min(1, (performance.now() - fly.start) / fly.duration);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
      controls.target.lerpVectors(fly.from, fly.to, e);
      camera.position.lerpVectors(fly.fromCam, fly.toCam, e);
      if (k >= 1) fly = null;
    }
    tickers.forEach((fn) => fn(t));
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  animate();

  function applySize() {
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
    labelRenderer.setSize(clientWidth, clientHeight);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    resizeFns.forEach((fn) => fn(size.x, size.y));
  }
  const resizeObserver = new ResizeObserver(applySize);
  resizeObserver.observe(container);

  const debugReaders = new Map<string, () => unknown>();
  const debug: SceneDebug = {
    register: (name, read) => {
      debugReaders.set(name, read);
      return () => debugReaders.delete(name);
    },
    snapshot: () => {
      const out: Record<string, unknown> = {
        renderer: {
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? 0,
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        },
      };
      for (const [name, read] of debugReaders) {
        try {
          out[name] = read();
        } catch (err) {
          out[name] = { error: String(err) };
        }
      }
      return out;
    },
  };

  const dispose = () => {
    debugReaders.clear();
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    controls.dispose();
    renderer.dispose();
    tickers.clear();
    resizeFns.clear();
    cameraFns.clear();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    if (labelRenderer.domElement.parentElement === container)
      container.removeChild(labelRenderer.domElement);
  };

  const handles: SceneHandles = {
    scene,
    world,
    markers,
    camera,
    renderer,
    controls,
    frameTerrain,
    setExaggeration,
    getExaggeration: () => exaggeration,
    setTool,
    resetNorth,
    flyTo,
    getPose,
    setPose,
    captureImage,
    setSunTime,
    setPixelRatio,
    setShadows,
    frameTimeMs: () => frameEma,
    isCameraActive: () => fly !== null || performance.now() - lastInteractionAt < ACTIVE_TAIL_MS,
    addTicker: (fn) => {
      tickers.add(fn);
      return () => tickers.delete(fn);
    },
    onResize: (fn) => {
      resizeFns.add(fn);
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      fn(size.x, size.y);
      return () => resizeFns.delete(fn);
    },
    onCameraChange: (fn) => {
      cameraFns.add(fn);
      fn(headingDeg());
      return () => cameraFns.delete(fn);
    },
    viewportHeightPx: () => container.clientHeight,
    debug,
    dispose,
  };
  if (import.meta.env.DEV) {
    (window as unknown as { __siahraHandles?: SceneHandles }).__siahraHandles = handles;
  }
  return handles;
}
