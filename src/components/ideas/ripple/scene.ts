import * as THREE from 'three';
import type { Palette } from './palettes';

// A field of tiles over a 2D wave equation. Each tile is a column whose top
// follows the water height under it. Raindrops and the pointer disturb the
// surface; a calm zone under the text holds the tiles perfectly flat.

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Opts = {
  canvas: HTMLCanvasElement;
  seed: number;
  palette: Palette;
  calm: () => DOMRect[]; // screen rectangles to keep flat
  reduce: boolean;
  onFirstFrame: (flat: string | null) => void;
};

const MAX_CELLS = 18500;

export function start(o: Opts) {
  const r = mulberry32((o.seed * 2654435761) ^ 0x2c1b3c6d);
  const range = (a: number, b: number) => a + (b - a) * r();
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const pal = o.palette;

  // ---------------------------------------------------------------- edition
  const elev = THREE.MathUtils.degToRad(range(56, 70));
  const azim = THREE.MathUtils.degToRad(pick([0, 0, 45, range(-14, 14)]));
  const cellPx = pick([10, 11, 12, 13]);
  const gapPx = range(0.85, 1.15); // seams about a pixel wide, never thinner
  let tile = 0.92;
  const c2 = range(0.07, 0.11); // gravity-wave speed squared, in cells per step
  const beta = range(0.008, 0.014); // surface tension
  const damping = range(0.9955, 0.9972);
  const rainEvery = range(2.6, 5.5); // mean seconds between raindrops
  const dropSize = range(1.15, 1.45);
  const lightAz = azim + range(-2.2, -0.6) * (r() < 0.5 ? 1 : -1);
  const lightEl = THREE.MathUtils.degToRad(range(30, 44));
  const swellA = range(0.025, 0.05);
  const swellDir = range(0, Math.PI * 2);
  const swellK = (Math.PI * 2) / range(36, 70);
  const swellW = (Math.PI * 2) / range(9, 15);
  const HS = 0.8; // world height per unit of wave

  // ---------------------------------------------------------------- three
  const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(new THREE.Color(pal.gap), 1);

  const scene = new THREE.Scene();
  // a tight depth range: some GPUs give multisampled buffers only 16 bits of depth
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 100, 200);
  const camDir = new THREE.Vector3(Math.sin(azim) * Math.cos(elev), Math.sin(elev), Math.cos(azim) * Math.cos(elev));
  scene.add(new THREE.HemisphereLight(pal.sky, pal.ground, pal.hemiI));
  const key = new THREE.DirectionalLight(pal.key, pal.keyI);
  const lightDir = new THREE.Vector3(Math.sin(lightAz) * Math.cos(lightEl), Math.sin(lightEl), Math.cos(lightAz) * Math.cos(lightEl));
  key.castShadow = true;
  key.shadow.bias = -0.0025;
  key.shadow.normalBias = 0.06;
  key.shadow.radius = 2.5;
  scene.add(key, key.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.tile).multiplyScalar(pal.dark ? 0.6 : 0.78) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.9;
  floor.receiveShadow = true;
  scene.add(floor);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, -0.5, 0); // the top face sits at y = 0
  {
    // Tuck the side faces a hair below the top, so where neighbours sit level
    // their sides can't flicker through as hairlines.
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) if (nor.getY(i) === 0 && pos.getY(i) > -0.001) pos.setY(i, -0.015);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, dithering: true });
  let mesh: THREE.InstancedMesh | null = null;

  // ---------------------------------------------------------------- grid + sim
  let NX = 0, NZ = 0, X0 = 0, Z0 = 0, count = 0;
  let u = new Float32Array(0), v = new Float32Array(0);
  let q = new Float32Array(0), damp = new Float32Array(0), edge = new Float32Array(0);
  let sx = new Float32Array(0), sy = new Float32Array(0);
  const tileCol = new THREE.Color(pal.tile);
  const accCol = new THREE.Color(pal.accent);
  const crestUp = pal.at === 'crest';

  let W = 1, H = 1, ppc = cellPx;
  const right = new THREE.Vector3(), up = new THREE.Vector3();

  function groundAt(px: number, py: number, out: THREE.Vector3) {
    // ray from the orthographic image plane down to y = 0
    const x = (px - W / 2) / ppc, y = (H / 2 - py) / ppc;
    out.copy(camera.position).addScaledVector(right, x).addScaledVector(up, y);
    return out.addScaledVector(camDir, -out.y / camDir.y);
  }

  function layout() {
    W = Math.max(1, o.canvas.clientWidth);
    H = Math.max(1, o.canvas.clientHeight);
    renderer.setSize(W, H, false);
    ppc = W < 700 ? Math.max(9, cellPx * 0.85) : cellPx;
    camera.position.copy(camDir).multiplyScalar(150);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    // footprint of the screen on the ground
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const g = new THREE.Vector3();
    for (;;) {
      minX = minZ = Infinity;
      maxX = maxZ = -Infinity;
      for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        groundAt(px, py, g);
        minX = Math.min(minX, g.x); maxX = Math.max(maxX, g.x);
        minZ = Math.min(minZ, g.z); maxZ = Math.max(maxZ, g.z);
      }
      const cells = (maxX - minX + 8) * (maxZ - minZ + 10);
      if (cells <= MAX_CELLS) break;
      ppc *= 1.06;
    }
    // seams seen on the diagonal read heavier, so draw them finer
    tile = 1 - (gapPx * (1 - 0.35 * Math.abs(Math.sin(2 * azim)))) / ppc;
    camera.left = -W / 2 / ppc;
    camera.right = W / 2 / ppc;
    camera.top = H / 2 / ppc;
    camera.bottom = -H / 2 / ppc;
    camera.updateProjectionMatrix();
    const nx = Math.ceil(maxX - minX) + 8, nz = Math.ceil(maxZ - minZ) + 10;
    const x0 = Math.floor(minX) - 4, z0 = Math.floor(minZ) - 6;
    if (nx !== NX || nz !== NZ || x0 !== X0 || z0 !== Z0) rebuild(nx, nz, x0, z0);
    // each tile's place on screen, for the calm zone
    const p = new THREE.Vector3();
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) {
        const i = x + z * NX;
        p.set(X0 + x, 0, Z0 + z).project(camera);
        sx[i] = (p.x * 0.5 + 0.5) * W;
        sy[i] = (0.5 - p.y * 0.5) * H;
      }
    // light and its shadow frustum cover the whole field
    const cx = X0 + NX / 2, cz = Z0 + NZ / 2, R = Math.hypot(NX, NZ) / 2 + 2;
    key.target.position.set(cx, 0, cz);
    key.position.set(cx, 0, cz).addScaledVector(lightDir, 60);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -R;
    sc.right = sc.top = R;
    sc.near = 1;
    sc.far = 140;
    sc.updateProjectionMatrix();
    const ms = W * H * dpr * dpr > 2.5e6 ? 4096 : 2048;
    if (key.shadow.mapSize.x !== ms) {
      key.shadow.mapSize.set(ms, ms);
      key.shadow.map?.dispose();
      key.shadow.map = null as any;
    }
    floor.position.x = cx;
    floor.position.z = cz;
    floor.scale.set(NX + 40, NZ + 40, 1);
    updateCalm();
  }

  function rebuild(nx: number, nz: number, x0: number, z0: number) {
    const oldU = u, oldV = v, oNX = NX, oNZ = NZ, oX0 = X0, oZ0 = Z0;
    NX = nx; NZ = nz; X0 = x0; Z0 = z0;
    count = NX * NZ;
    u = new Float32Array(count); v = new Float32Array(count);
    q = new Float32Array(count); damp = new Float32Array(count); edge = new Float32Array(count);
    sx = new Float32Array(count); sy = new Float32Array(count);
    // keep whatever ripples overlap the new grid
    for (let z = 0; z < oNZ; z++)
      for (let x = 0; x < oNX; x++) {
        const X = x + oX0 - X0, Z = z + oZ0 - Z0;
        if (X < 0 || Z < 0 || X >= NX || Z >= NZ) continue;
        u[X + Z * NX] = oldU[x + z * oNX];
        v[X + Z * NX] = oldV[x + z * oNX];
      }
    // a sponge around the border so nothing reflects off the edge of the world
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) {
        const d = Math.min(x, z, NX - 1 - x, NZ - 1 - z);
        edge[x + z * NX] = d >= 6 ? 1 : 0.6 + 0.4 * (d / 6);
      }
    if (mesh) {
      scene.remove(mesh);
      mesh.dispose();
    }
    mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const M = mesh.instanceMatrix.array as Float32Array;
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) {
        const m = (x + z * NX) * 16;
        M[m] = tile; M[m + 5] = 1.4; M[m + 10] = tile; M[m + 15] = 1;
        M[m + 12] = X0 + x; M[m + 14] = Z0 + z;
      }
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- calm zone
  function updateCalm() {
    const rects = o.calm();
    const narrow = W < 700;
    const pad = narrow ? 16 : 40, feather = narrow ? 90 : 190;
    for (let i = 0; i < count; i++) {
      let best = 0;
      const px = sx[i], py = sy[i];
      for (const rc of rects) {
        const dx = Math.max(rc.left - pad - px, 0, px - rc.right - pad);
        const dy = Math.max(rc.top - pad - py, 0, py - rc.bottom - pad);
        const d = Math.hypot(dx, dy);
        const w = d >= feather ? 0 : 1 - d / feather;
        const s = w * w * (3 - 2 * w);
        if (s > best) best = s;
      }
      q[i] = best;
      damp[i] = damping * edge[i] * (1 - 0.3 * best);
    }
  }

  // ---------------------------------------------------------------- physics
  // Water ripples are dispersive: short capillary waves outrun the long ones,
  // which is what spreads a single drop into a train of fine rings. A small
  // bi-Laplacian term (surface tension) gives the grid the same behaviour.
  let L = new Float32Array(0);
  function step() {
    const n = NX;
    if (L.length !== count) L = new Float32Array(count);
    for (let z = 1; z < NZ - 1; z++) {
      let i = z * n + 1;
      for (let x = 1; x < n - 1; x++, i++) {
        // nine-point Laplacian: rings stay round on a square grid
        L[i] = (4 * (u[i - 1] + u[i + 1] + u[i - n] + u[i + n]) + u[i - n - 1] + u[i - n + 1] + u[i + n - 1] + u[i + n + 1] - 20 * u[i]) / 6;
      }
    }
    for (let z = 2; z < NZ - 2; z++) {
      let i = z * n + 2;
      for (let x = 2; x < n - 2; x++, i++) {
        const l2 = (4 * (L[i - 1] + L[i + 1] + L[i - n] + L[i + n]) + L[i - n - 1] + L[i - n + 1] + L[i + n - 1] + L[i + n + 1] - 20 * L[i]) / 6;
        v[i] = (v[i] + c2 * L[i] - beta * l2) * damp[i];
      }
    }
    for (let i = 0; i < count; i++) u[i] = (u[i] + v[i]) * (1 - 0.2 * q[i]);
  }

  // a raindrop: a small crater, then the jet falling back a moment later
  const pending: { t: number; x: number; z: number; a: number; s: number }[] = [];
  function drop(gx: number, gz: number, a: number, s: number) {
    const x0 = gx - X0, z0 = gz - Z0;
    const R = Math.ceil(s * 3);
    for (let z = Math.max(1, Math.floor(z0 - R)); z <= Math.min(NZ - 2, Math.ceil(z0 + R)); z++)
      for (let x = Math.max(1, Math.floor(x0 - R)); x <= Math.min(NX - 2, Math.ceil(x0 + R)); x++) {
        const d2 = (x - x0) ** 2 + (z - z0) ** 2;
        const i = x + z * NX;
        u[i] -= a * Math.exp(-d2 / (2 * s * s)) * (1 - q[i]);
      }
  }
  function rain(now: number) {
    // somewhere visible and away from the text
    for (let tries = 0; tries < 30; tries++) {
      const i = Math.floor(r() * count);
      if (q[i] > 0.02 || sx[i] < 0 || sx[i] > W || sy[i] < 0 || sy[i] > H || edge[i] < 1) continue;
      const gx = X0 + (i % NX) + range(-0.5, 0.5), gz = Z0 + Math.floor(i / NX) + range(-0.5, 0.5);
      const a = range(1.4, 2.4), s = dropSize * range(0.85, 1.2);
      drop(gx, gz, a, s);
      pending.push({ t: now + range(220, 340), x: gx, z: gz, a: -a * 0.32, s: s * 0.7 });
      return;
    }
  }

  // ---------------------------------------------------------------- pointer
  const gp = new THREE.Vector3();
  let lastPX = -1, lastPY = -1, trail = 0;
  addEventListener('pointermove', (e) => {
    if (o.reduce || e.pointerType === 'touch') return;
    if (lastPX >= 0) trail += Math.hypot(e.clientX - lastPX, e.clientY - lastPY);
    lastPX = e.clientX;
    lastPY = e.clientY;
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    if (o.reduce) return;
    groundAt(e.clientX, e.clientY, gp);
    const i = Math.round(gp.x - X0) + Math.round(gp.z - Z0) * NX;
    if (i < 0 || i >= count || q[i] > 0.5) return;
    drop(gp.x, gp.z, 2.4, dropSize * 1.1);
    pending.push({ t: performance.now() + 280, x: gp.x, z: gp.z, a: -0.5, s: dropSize * 0.8 });
  }, { passive: true });

  // ---------------------------------------------------------------- draw
  const tmp = new THREE.Color();
  const lx = lightDir.x, lz = lightDir.z;
  // dark tiles need more help from the baked light than pale ones
  const slopeK = pal.dark ? 2.4 : 1.3, shadeMax = pal.dark ? 1.9 : 1.1;
  function draw(time: number) {
    if (!mesh) return;
    const M = mesh.instanceMatrix.array as Float32Array;
    const C = mesh.instanceColor!.array as Float32Array;
    const sdx = Math.cos(swellDir) * swellK, sdz = Math.sin(swellDir) * swellK;
    const n = NX;
    const tr = tileCol.r, tg = tileCol.g, tb = tileCol.b;
    for (let z = 0; z < NZ; z++) {
      for (let x = 0; x < n; x++) {
        const i = x + z * n;
        const calm = 1 - q[i];
        const wx = X0 + x, wz = Z0 + z;
        const sw = swellA * (Math.sin(wx * sdx + wz * sdz - time * swellW) + 0.5 * Math.sin(wx * sdz * 0.7 - wz * sdx * 0.7 - time * swellW * 0.8));
        const h = (u[i] * HS + sw) * calm;
        const m = i * 16;
        M[m + 13] = h;
        const ts = tile + (1.02 - tile) * q[i]; // overlap a touch, so no hairline cracks
        M[m] = ts;
        M[m + 10] = ts;
        // shading baked from the water: slope towards the light, and curvature
        let shade = 1, acc = 0;
        if (x > 0 && z > 0 && x < n - 1 && z < NZ - 1) {
          const gx = u[i + 1] - u[i - 1], gz = u[i + n] - u[i - n];
          const lap = u[i - 1] + u[i + 1] + u[i - n] + u[i + n] - 4 * u[i];
          shade = 1 + (-(gx * lx + gz * lz) * slopeK - lap * 0.5 + u[i] * 0.14) * calm;
          if (shade < 0.55) shade = 0.55;
          else if (shade > shadeMax) shade = shadeMax;
          const hv = crestUp ? u[i] : -u[i];
          // the accent lives on the rings, not in the splash at the centre
          const t = (hv - 0.2) / 0.45, f = (Math.abs(u[i]) - 0.9) / 0.7;
          acc = t <= 0 ? 0 : t >= 1 ? 0.75 : 0.75 * t * t * (3 - 2 * t);
          if (f > 0) acc *= f >= 1 ? 0 : 1 - f * f * (3 - 2 * f);
          acc *= calm;
        }
        const c = i * 3;
        tmp.setRGB(tr + (accCol.r - tr) * acc, tg + (accCol.g - tg) * acc, tb + (accCol.b - tb) * acc);
        C[c] = tmp.r * shade;
        C[c + 1] = tmp.g * shade;
        C[c + 2] = tmp.b * shade;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    renderer.render(scene, camera);
  }

  // the colour a flat, calm tile actually renders at, so the page can match it
  function sampleFlat(): string | null {
    const rects = o.calm();
    if (!rects.length) return null;
    const rc = rects[0];
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const x = Math.round((rc.left + 6) * dpr), y = Math.round((H - rc.top - 6) * dpr);
    if (x < 0 || y < 0) return null;
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return `rgb(${px[0]} ${px[1]} ${px[2]})`;
  }

  // ---------------------------------------------------------------- loop
  layout();
  let resizeQueued = false;
  new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      layout();
      if (!running) draw(still);
    });
  }).observe(o.canvas);
  let scrollQueued = false;
  addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      updateCalm();
      if (!running) draw(still);
    });
  }, { passive: true });

  const t0 = performance.now();
  let nextRain = t0 + range(900, 1800);
  let acc = 0, last = t0, running = false, raf = 0, first = true;
  const still = range(0, 100);
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (now >= nextRain) {
      rain(now);
      // light rain is bursty: sometimes another drop follows close behind
      nextRain = now + (r() < 0.25 ? range(150, 700) : -Math.log(1 - r()) * rainEvery * 1000 + 600);
    }
    for (let k = pending.length - 1; k >= 0; k--)
      if (now >= pending[k].t) {
        const p = pending[k];
        drop(p.x, p.z, p.a, p.s);
        pending.splice(k, 1);
      }
    if (trail > 0 && lastPX >= 0) {
      groundAt(lastPX, lastPY, gp);
      drop(gp.x, gp.z, Math.min(0.5, trail * 0.004), 1.2);
      trail = 0;
    }
    acc += dt * 60;
    let k = 0;
    while (acc >= 1 && k < 3) {
      step();
      acc -= 1;
      k++;
    }
    if (acc > 3) acc = 0;
    draw((now - t0) / 1000);
    if (first) {
      first = false;
      o.onFirstFrame(sampleFlat());
    }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }

  if (o.reduce) {
    // A still: a few drops at different moments, frozen mid-spread.
    const ages = [130, 80, 46, 22].slice(0, 3 + Math.floor(r() * 2));
    for (let s = 0, a = 0; s <= ages[0]; s++) {
      while (a < ages.length && ages[0] - s === ages[a]) {
        rain(0);
        a++;
      }
      step();
    }
    draw(still);
    o.onFirstFrame(sampleFlat());
  } else {
    document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
    play();
  }
}
