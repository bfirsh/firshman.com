import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mulberry32, type Palette, type Form } from './palettes';
import { Growth, type GrowthParams } from './growth';

type Opts = {
  canvas: HTMLCanvasElement;
  seed: number;
  palette: Palette;
  reduce: boolean;
};

export function startBloom({ canvas, seed, palette, reduce }: Opts) {
  const rng = mulberry32(seed * 7919 + 101);
  const R = (a: number, b: number) => a + (b - a) * rng();
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    canvas.classList.add('off');
    return;
  }

  const small = Math.min(screen.width, screen.height) < 600 || matchMedia('(pointer: coarse)').matches;

  // --- the edition
  const form: Form = pick(palette.forms);
  const rooted = form === 'fan';
  const maxR = Math.round(R(40, 50));
  const params: GrowthParams =
    // fans range from loose coral lace (one contact sticks) to fern frost (a few)
    form === 'fan' ? { form, stick: R(0.55, 1), hits: rng() < 0.6 ? 1 : Math.round(R(2, 3.4)), drift: R(0.03, 0.08), slab: 0, maxR }
    : { form, stick: 1, hits: Math.round(R(2, 5.4)), drift: 0, slab: 0, maxR };
  // older parts thicken, as a sea fan's stem does and as an ice plate's spine does
  const thick = R(2, 3.2);
  const cap = small ? 9000 : 16000;
  const growMinutes = R(5, 8);
  const ageSpan = R(140, 260);
  // the plane turns slowly to and fro, like a fan in a current, always showing its face
  const sway = R(0.38, 0.6) * (rng() < 0.5 ? -1 : 1);
  const swayW = (Math.PI * 2) / R(200, 300);
  const rot0 = R(-0.25, 0.25);
  const tilt = form === 'frost' ? R(0.25, 0.5) : 0;
  const camEl = rooted ? R(0.08, 0.24) : R(0.15, 0.32);
  const fov = R(24, 30);
  // light from the left, so shadows fall away from the text
  const keyAz = -R(0.5, 1.2);
  const keyEl = R(0.65, 1.05);
  const gap = R(0.9, 0.97);
  const preFrac = reduce ? 1 : R(0.72, 0.84);

  const growth = new Growth(cap, params, mulberry32(seed * 31 + 7));

  // --- renderer, scene, light
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = palette.dark ? 1.05 : 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = palette.dark ? 0.25 : 0.4;

  const C = (h: string) => new THREE.Color(h);
  scene.add(new THREE.HemisphereLight(C(palette.sky), C(palette.ground), palette.dark ? 0.9 : 1.1));
  const key = new THREE.DirectionalLight(C(palette.key), palette.dark ? 2.6 : 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  key.shadow.radius = small ? 5 : 7;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.ShadowMaterial({ color: C(palette.shadow), opacity: palette.dark ? 0.5 : 0.2 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);

  const group = new THREE.Group();
  group.rotation.y = rot0;
  scene.add(group);

  // --- voxels: one box, per-instance birth time and baked AO; age and growth in the shader
  const uniforms = {
    uTime: { value: 0 },
    uDis: { value: 0 },
    uCount: { value: 1 },
    uAgeSpan: { value: ageSpan },
    uThick: { value: thick },
    uTip: { value: C(palette.tip) },
    uMid: { value: C(palette.mid) },
    uCore: { value: C(palette.core) },
  };
  const scaleGLSL = /* glsl */ `
    float vAgeT = uTime - aBirth;
    float gIn = clamp(vAgeT / 1.6, 0.0, 1.0);
    gIn = 1.0 - pow(1.0 - gIn, 3.0);
    float sc = gIn;
    if (uDis > 0.0) {
      float rank = float(gl_InstanceID) / max(uCount, 1.0);
      float k = clamp((uTime - uDis - (1.0 - rank) * 6.0) / 2.2, 0.0, 1.0);
      sc *= 1.0 - k * k * (3.0 - 2.0 * k);
    }
    vec3 transformed = position * sc;
    transformed.z *= 1.0 + (uThick - 1.0) * smoothstep(0.0, uAgeSpan * 1.3, vAgeT);
  `;
  const head = /* glsl */ `
    attribute float aBirth;
    uniform float uTime, uDis, uCount, uAgeSpan, uThick;
    uniform vec3 uTip, uMid, uCore;
  `;
  const material = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, dithering: true });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = head + sh.vertexShader
      .replace('#include <begin_vertex>', scaleGLSL)
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        {
          float a = clamp((uTime - aBirth) / uAgeSpan, 0.0, 1.0);
          vec3 ac = a < 0.22 ? mix(uTip, uMid, smoothstep(0.0, 0.22, a)) : mix(uMid, uCore, smoothstep(0.22, 1.0, a));
          float fresh = exp(-max(uTime - aBirth, 0.0) * 0.8);
          vColor.xyz *= ac * (1.0 + 0.18 * fresh);
        }`,
      );
  };
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = head + sh.vertexShader.replace('#include <begin_vertex>', scaleGLSL);
  };

  const geo = new THREE.BoxGeometry(gap, gap, gap);
  const birth = new Float32Array(cap);
  const birthAttr = new THREE.InstancedBufferAttribute(birth, 1);
  birthAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aBirth', birthAttr);
  const mesh = new THREE.InstancedMesh(geo, material, cap);
  mesh.customDepthMaterial = depthMat;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const aoArr = new Float32Array(cap * 3).fill(1);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(aoArr, 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  group.add(mesh);

  let lift = 0;
  const m4 = new THREE.Matrix4();
  function place(k: number, t: number) {
    m4.makeTranslation(growth.xs[k] - growth.cx, growth.ys[k] - growth.cy, growth.zs[k] - growth.cz);
    mesh.setMatrixAt(k, m4);
    birth[k] = t;
  }
  function flush(from: number) {
    const to = growth.n;
    if (to <= from) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(from * 16, (to - from) * 16);
    mesh.instanceMatrix.needsUpdate = true;
    birthAttr.clearUpdateRanges();
    birthAttr.addUpdateRange(from, to - from);
    birthAttr.needsUpdate = true;
    mesh.count = to;
    uniforms.uCount.value = to;
  }
  function bakeAO() {
    growth.ao(aoArr);
    mesh.instanceColor!.clearUpdateRanges();
    mesh.instanceColor!.needsUpdate = true;
  }

  // --- framing: sized for the grown piece, so a new seed starts small in the same frame
  const camera = new THREE.PerspectiveCamera(fov, 1, 1, 2000);
  const target = new THREE.Vector3();
  let frameR = 30;
  let camAz = 0;
  let W = 1, H = 1;
  function setFrame() {
    const rFinal = params.maxR;
    if (!rooted) {
      lift = rFinal + 7; // floats above the ground
      target.set(0, lift, 0);
      frameR = rFinal * 1.15;
    } else {
      lift = 0;
      target.set(0, rFinal * 0.44, 0);
      frameR = rFinal * 1.02; // a fan can spread as wide as it is tall
    }
    mesh.position.y = lift;
    mesh.rotation.x = -tilt;
    key.shadow.camera.left = key.shadow.camera.bottom = -frameR * 2.2;
    key.shadow.camera.right = key.shadow.camera.top = frameR * 2.2;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 900;
    key.shadow.camera.updateProjectionMatrix();
  }

  function layout() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const stacked = getComputedStyle(canvas).position !== 'fixed';
    const fpx = H / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    // room the piece gets, in px (radius)
    const avail = stacked ? Math.min(H * 0.46, W * 0.46) : Math.min(H * 0.42, W * 0.27);
    const dist = (frameR * fpx) / avail;
    camPos(dist);
    const cxFrac = stacked ? 0.5 : 0.69;
    const cyFrac = stacked ? 0.52 : 0.5;
    camera.setViewOffset(W, H, (0.5 - cxFrac) * W, (0.5 - cyFrac) * H, W, H);
    camera.updateProjectionMatrix();
    distNow = dist;
  }
  let distNow = 100;
  function camPos(dist: number) {
    camera.position.set(
      target.x + Math.sin(camAz) * Math.cos(camEl) * dist,
      target.y + Math.sin(camEl) * dist,
      target.z + Math.cos(camAz) * Math.cos(camEl) * dist,
    );
    camera.lookAt(target);
    // key light, fixed relative to the view
    const a = camAz + keyAz;
    key.position.set(target.x + Math.sin(a) * Math.cos(keyEl) * 300, target.y + Math.sin(keyEl) * 300, target.z + Math.cos(a) * Math.cos(keyEl) * 300);
    key.target.position.copy(target);
  }

  // --- time
  let t = 0;
  let owed = 0;
  let phase: 'grow' | 'hold' | 'dissolve' = 'grow';
  let phaseAt = 0;
  let lastAO = 0;
  let baseRate = 4;
  // gentle at the start, so a new seed visibly begins as a few cubes
  const rateNow = () => baseRate * (0.35 + Math.min(1, growth.n / 120) * 0.65);

  // pre-grow in time slices, so the first frame we show is already a piece
  const preR = params.maxR * preFrac;
  const preT0 = performance.now();
  function pregrow(done: () => void) {
    const sliceEnd = performance.now() + 14;
    while (growth.rMax < preR && !growth.full && performance.now() < sliceEnd) growth.run(40000);
    if (growth.rMax < preR && !growth.full && performance.now() - preT0 < 8000) {
      requestAnimationFrame(() => pregrow(done));
      return;
    }
    done();
  }

  let running = false;
  const ro = new ResizeObserver(() => { layout(); if (!running) draw(); });

  // the piece turns so slowly that the shadow only needs refreshing a few times a second
  let shadowTick = 0;
  let drawnN = 0;
  function draw(forceShadow = true) {
    if (forceShadow || ++shadowTick % 3 === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  }

  // declared before pregrow(): it can call back synchronously when the growth is already done
  let last = 0;
  let aim = 0, aimNow = 0;

  pregrow(() => {
    const n = growth.n;
    setFrame();
    // pace the rest so the whole piece takes a few minutes, as if it had always grown so
    const nFinal = n * Math.pow(params.maxR / Math.max(growth.rMax, 4), 1.7);
    baseRate = Math.max(1.2, nFinal / (growMinutes * 60));
    for (let k = 0; k < n; k++) place(k, -(n - k) / baseRate);
    flush(0);
    bakeAO();
    layout();
    ro.observe(canvas);
    draw();
    canvas.classList.add('on');
    if (reduce) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  });

  // cursor: the view turns a few degrees toward it
  if (!reduce && matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => { aim = (e.clientX / window.innerWidth - 0.5) * 0.22; }, { passive: true });
  }

  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const sdt = dt;
    t += sdt;
    uniforms.uTime.value = t;
    group.rotation.y = rot0 + sway * Math.sin(t * swayW);
    aimNow += (aim - aimNow) * Math.min(1, dt * 0.8);
    camAz = aimNow;
    camPos(distNow);

    if (phase === 'grow') {
      const from = growth.n;
      owed += rateNow() * sdt;
      let budget = small ? 120000 : 260000;
      while (owed >= 1 && budget > 0 && !growth.full) {
        const chunk = Math.min(budget, 20000);
        budget -= chunk;
        if (growth.run(chunk)) { place(growth.n - 1, t - Math.random() * sdt); owed -= 1; }
      }
      flush(from);
      if (t - lastAO > 2) { lastAO = t; bakeAO(); }
      if (growth.full) { phase = 'hold'; phaseAt = t; bakeAO(); }
    } else if (phase === 'hold') {
      if (t - phaseAt > 30) { phase = 'dissolve'; phaseAt = t; uniforms.uDis.value = t; }
    } else if (t - phaseAt > 9.5) {
      // a new seed
      growth.reset();
      uniforms.uDis.value = 0;
      for (let k = 0; k < growth.n; k++) place(k, t);
      mesh.count = 0;
      flush(0);
      bakeAO();
      owed = 0;
      phase = 'grow';
    }
    draw(growth.n !== drawnN);
    drawnN = growth.n;
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (reduce) return;
    if (document.hidden) running = false;
    else if (!running && canvas.classList.contains('on')) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  });
}
