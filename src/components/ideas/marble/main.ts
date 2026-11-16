import * as THREE from 'three';
import { generate, C, R, M, WALL_H, mulberry32 } from './level';
import { PALETTES } from './palettes';
import { meshVoxels, buildProps, BoxBuilder } from './mesh';
import { Marble, sdf } from './physics';
import type { Impact } from './physics';
import { Sound } from './audio';

const G = 21; // gravity, units/s^2
const TILT_VIS = THREE.MathUtils.degToRad(7.5);
const TILT_PHYS = THREE.MathUtils.degToRad(27);

export function start() {
  const root = document.documentElement;
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let seed = parseInt(params.get('seed') || '', 10);
  if (!(seed > 0)) seed = 1 + Math.floor(Math.random() * 9999);
  const ed = document.getElementById('edition');
  if (ed) { ed.textContent = 'No. ' + String(seed).padStart(4, '0'); (ed as HTMLAnchorElement).href = '?seed=' + seed; }

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no gl');
  } catch (e) {
    root.classList.add('nogl');
    return;
  }
  root.classList.add('gl');
  const maxDpr = coarse ? 1.6 : 1.75;
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.transmissionResolutionScale = 0.6;

  const portrait = innerHeight > innerWidth * 1.05;
  const L = generate(seed, portrait);
  const rnd = mulberry32(seed * 31 + 7);
  const pal = PALETTES[(seed * 2654435761 >>> 0) % PALETTES.length];
  root.style.setProperty('--ink', pal.ink);
  root.style.setProperty('--paper', pal.paper);
  root.style.setProperty('--accent', pal.plate);
  root.style.setProperty('--sky0', pal.sky[0]);
  root.style.setProperty('--sky1', pal.sky[1]);
  root.style.setProperty('--sky2', pal.sky[2]);
  if (pal.night) root.classList.add('night');

  const colors: THREE.Color[] = [];
  for (let i = 0; i < 32; i++) colors[i] = new THREE.Color(pal.m[i] || '#ff00ff');
  const bucketOf = new Uint8Array(32);
  bucketOf[M.glow] = 1;
  if (pal.night) bucketOf[M.window] = 1;
  bucketOf[M.water] = 2;
  const haze = new THREE.Color(pal.haze);

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);

  // screen-space sky gradient with a soft sun bloom (also seen through the marble)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(pal.sky[0]) }, mid: { value: new THREE.Color(pal.sky[1]) }, bot: { value: new THREE.Color(pal.sky[2]) },
      res: { value: new THREE.Vector2(1, 1) }, sun: { value: new THREE.Vector2(0.22, 0.86) }, sunCol: { value: new THREE.Color(pal.sun) },
    },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: `
      uniform vec3 top, mid, bot, sunCol; uniform vec2 res, sun;
      void main(){
        vec2 uv = gl_FragCoord.xy / res;
        float y = uv.y;
        vec3 c = y > 0.55 ? mix(mid, top, smoothstep(0.55, 1.05, y)) : mix(bot, mid, smoothstep(-0.1, 0.55, y));
        vec2 d = (uv - sun) * vec2(res.x / res.y, 1.0);
        float s = exp(-dot(d, d) * 7.0);
        c += sunCol * s * 0.22;
        c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 160.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);

  // environment for reflections: a 3D version of the sky with a couple of soft boxes
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  {
    const g = new THREE.SphereGeometry(50, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(pal.sky[0]) }, mid: { value: new THREE.Color(pal.sky[1]) }, bot: { value: new THREE.Color(pal.ink).multiplyScalar(0.55) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float y = normalize(vP).y; vec3 c = y > 0.0 ? mix(mid, top, pow(y, 0.7)) : mix(mid * 0.8, bot, smoothstep(0.0, 0.35, -y)); gl_FragColor = vec4(c, 1.0); }',
    });
    envScene.add(new THREE.Mesh(g, m));
    const panel = (w: number, h: number, pos: THREE.Vector3, col: THREE.Color, intensity: number) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(intensity), side: THREE.DoubleSide }));
      p.position.copy(pos); p.lookAt(0, 0, 0); envScene.add(p);
    };
    panel(16, 9, new THREE.Vector3(-14, 30, 12), new THREE.Color(pal.sun), 5);
    panel(10, 24, new THREE.Vector3(26, 10, -14), new THREE.Color('#ffffff'), 1.6);
    panel(30, 4, new THREE.Vector3(0, 8, 34), new THREE.Color(pal.sky[1]), 1.4);
  }
  const envTex = pmrem.fromScene(envScene, 0.02).texture;

  // lights
  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiI * 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(pal.sun, pal.sunI * 1.2);
  const lightDir = new THREE.Vector3(-0.55, 1.0, 0.62).normalize();
  sun.position.copy(lightDir).multiplyScalar(40);
  sun.castShadow = true;
  const ext = Math.max(L.nx, L.nz) * C * 0.62 + 2;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 80 });
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // board: world (bob + tilt about the pivot) > board (level coordinates)
  const hs = L.rooms.map((r) => r.h);
  const pivotY = (Math.min(...hs) + Math.max(...hs)) / 2;
  const world = new THREE.Group();
  world.position.set(0, pivotY, 0);
  scene.add(world);
  const board = new THREE.Group();
  board.position.set(0, -pivotY, 0);
  world.add(board);

  const mainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, dithering: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const waterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.1, envMap: envTex, envMapIntensity: 1.2, emissive: new THREE.Color(pal.m[M.water]), emissiveIntensity: 0.0 });
  const mats = [mainMat, glowMat, waterMat];
  const voxGeos = meshVoxels(L, colors, haze, bucketOf, 3);
  const propGeos = buildProps(L.props, colors, bucketOf, 3).map((b) => b.geometry());
  for (let b = 0; b < 3; b++) for (const g of [voxGeos[b], propGeos[b]]) {
    if (!g.getAttribute('position').count) continue;
    const mesh = new THREE.Mesh(g, mats[b]);
    mesh.castShadow = b === 0; mesh.receiveShadow = b !== 1;
    board.add(mesh);
  }

  // gates
  const gateMeshes = L.gates.map((g) => {
    const bb = new BoxBuilder();
    const r = L.rooms[g.room];
    const i = g.side === 'x0' ? r.x0 : g.side === 'x1' ? r.x1 - 1 : 0;
    const j = g.side === 'z0' ? r.z0 : g.side === 'z1' ? r.z1 - 1 : 0;
    const alongZ = g.side === 'x0' || g.side === 'x1';
    const th = 0.36, inset = 0.02;
    let a: number[], b: number[];
    if (alongZ) { const x = L.ox + (i + 0.5) * C; a = [x - th / 2, 0, L.oz + g.d * C + inset]; b = [x + th / 2, WALL_H, L.oz + (g.d + 2) * C - inset]; }
    else { const z = L.oz + (j + 0.5) * C; a = [L.ox + g.d * C + inset, 0, z - th / 2]; b = [L.ox + (g.d + 2) * C - inset, WALL_H, z + th / 2]; }
    const acc = colors[M.accent], capc = colors[M.cap], glc = new THREE.Color(pal.plate);
    bb.box(a, [b[0], WALL_H - 0.1, b[2]], acc, 0.7, undefined, false);
    bb.box([a[0] - 0.015, WALL_H - 0.1, a[2] - 0.015], [b[0] + 0.015, WALL_H, b[2] + 0.015], capc, 0.9);
    // little studs on both faces
    const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2;
    for (const s of [-1, 1]) for (const o of [-0.22, 0, 0.22]) {
      if (alongZ) bb.box([cx + s * th / 2 - 0.03, 0.3, cz + o - 0.05], [cx + s * th / 2 + 0.03, 0.4, cz + o + 0.05], o === 0 ? glc : capc, 1);
      else bb.box([cx + o - 0.05, 0.3, cz + s * th / 2 - 0.03], [cx + o + 0.05, 0.4, cz + s * th / 2 + 0.03], o === 0 ? glc : capc, 1);
    }
    const mesh = new THREE.Mesh(bb.geometry(), mainMat);
    mesh.position.y = g.h;
    mesh.castShadow = true; mesh.receiveShadow = true;
    board.add(mesh);
    return mesh;
  });

  // plates
  const plateCol = new THREE.Color(pal.plate);
  const plates = L.rooms.map((r) => {
    const grp = new THREE.Group();
    const [px, pz] = r.plate;
    grp.position.set(L.ox + (px + 1) * C, r.h, L.oz + (pz + 1) * C);
    const discMat = new THREE.MeshStandardMaterial({ color: plateCol, roughness: 0.45, emissive: plateCol, emissiveIntensity: 0 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.08, 40), discMat);
    disc.position.y = 0.0; disc.receiveShadow = true;
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.paper), transparent: true, opacity: 0.35 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.028, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.012;
    const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.paper) });
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 24), dotMat);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.9, 48), new THREE.MeshBasicMaterial({ color: plateCol, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.02;
    grp.add(disc, ring, dot, halo);
    board.add(grp);
    return { grp, disc, discMat, ring, ringMat, dot, dotMat, halo, down: 0, glow: 0 };
  });

  // marble
  const marbleGrp = new THREE.Group();
  board.add(marbleGrp);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, thickness: R * 1.1, ior: 1.45, depthWrite: false,
    envMap: envTex, envMapIntensity: 1.9, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.07,
    attenuationColor: new THREE.Color(pal.vane[0]).lerp(new THREE.Color('#ffffff'), 0.4), attenuationDistance: 1.1,
  });
  const marble = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), glass);
  marble.castShadow = true;
  marbleGrp.add(marble);
  const core = new THREE.Group();
  {
    // a cat's-eye: twisted vanes inside the glass
    const vaneGeo = new THREE.PlaneGeometry(R * 0.85, R * 1.5, 1, 16);
    const pos = vaneGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const t = (y / (R * 1.5)) * 2.4;
      const w = x * Math.cos((y / R) * Math.PI * 0.5);
      pos.setXYZ(i, w * Math.cos(t), y, w * Math.sin(t));
    }
    vaneGeo.computeVertexNormals();
    const cols = [pal.vane[1], '#ffffff', pal.vane[1]];
    for (let k = 0; k < 3; k++) {
      const vm = new THREE.MeshStandardMaterial({ color: cols[k], roughness: 0.35, side: THREE.DoubleSide, emissive: cols[k], emissiveIntensity: 0.3, transparent: true, opacity: 0.92 });
      const vane = new THREE.Mesh(vaneGeo, vm);
      vane.rotation.y = (k * Math.PI * 2) / 3;
      core.add(vane);
    }
  }
  marbleGrp.add(core);
  // caustic: the bright focus a glass sphere throws into its own shadow
  const causticTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,250,235,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const caustic = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: causticTex, color: new THREE.Color(pal.sun).multiplyScalar(0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 }));
  caustic.rotation.x = -Math.PI / 2;
  board.add(caustic);

  // ---------------------------------------------------------------- particles
  class Particles {
    n: number; pos: Float32Array; vel: Float32Array; col: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array; kind: Uint8Array;
    alpha: Float32Array; geo: THREE.BufferGeometry; pts: THREE.Points; next = 0;
    constructor(n: number, additive: boolean) {
      this.n = n;
      this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
      this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1); this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.kind = new Uint8Array(n);
      this.geo = new THREE.BufferGeometry();
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
      this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
      this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 400 } },
        vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
          void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * scale / -mv.z; }`,
        fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; float a = ${additive ? 'exp(-r * 3.0)' : 'smoothstep(1.0, 0.7, r)'} * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.pts = new THREE.Points(this.geo, mat);
      this.pts.frustumCulled = false;
    }
    emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, size: number, life: number, kind = 0) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = life; this.max[i] = life; this.size[i] = size; this.kind[i] = kind;
    }
    update(dt: number, t: number) {
      for (let i = 0; i < this.n; i++) {
        if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
        this.life[i] -= dt;
        const k = this.kind[i], o = i * 3;
        const vel = this.vel;
        if (k === 0) { vel[o + 1] -= 3.2 * dt; const f = Math.exp(-2.2 * dt); vel[o] *= f; vel[o + 2] *= f; vel[o + 1] *= Math.exp(-1.2 * dt); vel[o] += Math.sin(t * 5 + i) * 0.6 * dt; } // petal
        else if (k === 1) { vel[o + 1] -= 7 * dt; } // droplet
        else if (k === 2) { vel[o] += Math.sin(t * 1.3 + i * 1.7) * 0.25 * dt; vel[o + 2] += Math.cos(t * 1.1 + i * 2.3) * 0.25 * dt; vel[o + 1] += 0.05 * dt; } // firefly
        else if (k === 3) { const f = Math.exp(-3 * dt); vel[o] *= f; vel[o + 2] *= f; vel[o + 1] = vel[o + 1] * f + 0.15 * dt; } // dust
        this.pos[o] += vel[o] * dt; this.pos[o + 1] += vel[o + 1] * dt; this.pos[o + 2] += vel[o + 2] * dt;
        const u = this.life[i] / this.max[i];
        this.alpha[i] = k === 2 ? Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(t * 6 + i)) : Math.min(1, u * 3) * (k === 3 ? 0.5 : 1);
      }
      for (const n of ['position', 'aAlpha']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
  const petals = new Particles(reduced ? 200 : 500, false);
  const glows = new Particles(reduced ? 120 : 360, true);
  board.add(petals.pts, glows.pts);
  const flowerCols = [colors[M.fl1], colors[M.fl2], colors[M.fl3], colors[M.leaf3], new THREE.Color(pal.plate)];
  const glowCol = new THREE.Color(pal.glow);
  const waterCol = colors[M.water].clone().lerp(new THREE.Color('#ffffff'), 0.45);
  const dustCol = colors[M.rim];

  // clouds drifting beneath the board
  const cloudTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const x = cv.getContext('2d')!;
    const r2 = mulberry32(seed + 99);
    for (let i = 0; i < 16; i++) {
      const cx = 40 + r2() * 176, cy = 70 + (r2() - 0.5) * 30, rr = 22 + r2() * 34;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 128);
    }
    return new THREE.CanvasTexture(cv);
  })();
  const clouds: { s: THREE.Sprite; v: number }[] = [];
  const span = Math.max(L.nx, L.nz) * C;
  for (let i = 0; i < 11; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, color: new THREE.Color(pal.sky[1]).lerp(new THREE.Color('#ffffff'), 0.4), transparent: true, opacity: 0.55 + rnd() * 0.3, depthWrite: false, fog: false });
    const s = new THREE.Sprite(m);
    const w = 8 + rnd() * 10;
    s.scale.set(w, w * 0.45, 1);
    s.position.set((rnd() - 0.5) * span * 1.6, L.minY - 0.5 - rnd() * 5, (rnd() - 0.5) * span * 1.6);
    scene.add(s);
    clouds.push({ s, v: 0.15 + rnd() * 0.25 });
  }

  // pennants on the towers
  const flags: { mesh: THREE.Mesh; base: Float32Array; ph: number }[] = [];
  {
    const fm = new THREE.MeshStandardMaterial({ color: pal.m[M.accent2], side: THREE.DoubleSide, roughness: 0.8 });
    for (const r of L.rooms) for (const f of r.flags) {
      const g = new THREE.PlaneGeometry(0.42, 0.2, 8, 1);
      g.translate(0.21, -0.1, 0);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setY(i, pos.getY(i) * (1 - x * 1.1)); }
      const mesh = new THREE.Mesh(g, fm);
      mesh.position.set(f[0], f[1], f[2]);
      mesh.rotation.y = -0.5 + rnd() * 0.3;
      mesh.castShadow = true;
      board.add(mesh);
      flags.push({ mesh, base: Float32Array.from(pos.array as Float32Array), ph: rnd() * 6 });
    }
  }
  // a few birds wheeling about the towers
  const birds: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; rad: number; h: number; sp: number; ph: number }[] = [];
  {
    const bm = new THREE.MeshBasicMaterial({ color: pal.paper, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.05, 0, 0, 0.07, 0.22, 0, 0.0], 3));
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const l = new THREE.Mesh(wing, bm), r = new THREE.Mesh(wing, bm);
      r.scale.x = -1;
      g.add(l, r);
      scene.add(g);
      birds.push({ g, l, r, rad: span * (0.32 + rnd() * 0.3), h: Math.max(...L.rooms.map((q) => q.h)) + 2.5 + rnd() * 2.5, sp: (0.12 + rnd() * 0.1) * (rnd() < 0.3 ? -1 : 1), ph: rnd() * 6.28 });
    }
  }

  // ---------------------------------------------------------------- state
  const ball = new Marble();
  const r0 = L.rooms[0];
  const startPos = new THREE.Vector3(L.ox + r0.start[0] * C, r0.h + R + 2.6, L.oz + r0.start[1] * C);
  ball.p.copy(startPos);
  ball.safe.set(startPos.x, r0.h + R + 0.5, startPos.z);
  const nRooms = L.rooms.length;
  const revealed = new Array(nRooms).fill(false);
  let progress = 0;
  const gateAnim = L.gates.map(() => ({ t: -1 }));
  let celebrateT = -1;
  const sound = new Sound();
  const impacts: Impact[] = [];
  let lastRoom = 0;
  let shownCard = -1;
  let interacted = false;

  // ---------------------------------------------------------------- UI
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.card'));
  const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('#journal button'));
  const hint = document.getElementById('hint')!;
  const fin = document.getElementById('fin')!;
  const joy = document.getElementById('joy')!;
  const joyDot = joy.querySelector('i') as HTMLElement;
  const ghost = document.getElementById('ghost')!;
  const camLocal = new THREE.Vector3(), rayDir = new THREE.Vector3(), gp = new THREE.Vector3();
  function occluded() {
    camLocal.copy(camera.position); board.worldToLocal(camLocal);
    rayDir.copy(camLocal).sub(ball.p).normalize();
    let t = R + 0.06;
    for (let i = 0; i < 40 && t < 9; i++) {
      gp.copy(ball.p).addScaledVector(rayDir, t);
      const d = sdf(L, gp.x, gp.y, gp.z);
      if (d < 0.01) return true;
      t += Math.max(0.04, d);
    }
    return false;
  }
  hint.textContent = coarse ? 'drag to tilt' : 'move to tilt';
  setTimeout(() => { if (!interacted) hint.classList.add('show'); }, 1400);
  function firstTouch() {
    if (interacted) return;
    interacted = true;
    hint.classList.remove('show');
  }
  function showCard(k: number) {
    if (shownCard === k) return;
    cards.forEach((c, i) => {
      const on = i === k;
      c.classList.toggle('show', on);
      c.setAttribute('aria-hidden', String(!on));
      c.toggleAttribute('inert', !on);
    });
    chips.forEach((c, i) => c.classList.toggle('cur', i === k));
    shownCard = k;
  }
  cards.forEach((c, k) => c.querySelector('.close')?.addEventListener('click', () => showCard(-1)));
  chips.forEach((c, k) => c.addEventListener('click', () => { if (revealed[k]) showCard(shownCard === k ? -1 : k); }));
  fin.querySelector('.close')?.addEventListener('click', () => fin.classList.remove('show'));

  function reveal(k: number) {
    firstTouch();
    revealed[k] = true;
    progress = k + 1;
    chips[k].disabled = false;
    chips[k].classList.add('found');
    chips[k].setAttribute('aria-label', cards[k].dataset.title || '');
    root.style.setProperty('--found', String(progress));
    if (k === 0) root.classList.add('named');
    showCard(k);
    sound.chime(k * 2, 1); sound.chime(k * 2 + 4, 0.5, 0.12);
    const pl = plates[k].grp.position;
    for (let i = 0; i < (reduced ? 30 : 70); i++) {
      const a = rnd() * Math.PI * 2, s = 0.6 + rnd() * 1.4;
      petals.emit(pl.x, pl.y + 0.1, pl.z, Math.cos(a) * s, 1.8 + rnd() * 2.2, Math.sin(a) * s, flowerCols[i % flowerCols.length], 0.07 + rnd() * 0.06, 2 + rnd() * 1.5, 0);
    }
    if (k < L.gates.length) gateAnim[k].t = 0;
    if (k === nRooms - 1) celebrateT = 0;
  }

  // read panel
  const panel = document.getElementById('read')!;
  const readBtn = document.getElementById('readBtn')!;
  const openRead = (e?: Event) => { e?.preventDefault(); panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); (panel.querySelector('.inner') as HTMLElement)?.focus(); };
  const closeRead = () => { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); };
  readBtn.addEventListener('click', openRead);
  document.querySelectorAll('[data-open-read]').forEach((b) => b.addEventListener('click', openRead));
  panel.addEventListener('click', (e) => { if (e.target === panel) closeRead(); });
  panel.querySelector('.close')?.addEventListener('click', closeRead);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (panel.classList.contains('open')) closeRead(); else showCard(-1); } });

  // sound + tilt toggles
  const soundBtn = document.getElementById('sound')!;
  soundBtn.hidden = false;
  soundBtn.addEventListener('click', () => {
    if (sound.on) sound.disable(); else sound.enable();
    soundBtn.setAttribute('aria-pressed', String(sound.on));
    soundBtn.textContent = sound.on ? 'sound on' : 'sound';
  });
  const tiltBtn = document.getElementById('tilt')!;
  const orient = { on: false, seen: false, b0: null as number | null, g0: 0, x: 0, y: 0 };
  if (coarse && 'DeviceOrientationEvent' in window) {
    tiltBtn.hidden = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (!orient.on || e.beta == null || e.gamma == null) return;
      orient.seen = true;
      if (orient.b0 == null) { orient.b0 = e.beta; orient.g0 = e.gamma; }
      let dx = (e.gamma - orient.g0) / 18, dy = (e.beta - orient.b0) / 18;
      const ang = ((screen.orientation && screen.orientation.angle) || 0) * Math.PI / 180;
      const c = Math.cos(ang), s = Math.sin(ang);
      [dx, dy] = [dx * c + dy * s, -dx * s + dy * c];
      orient.x = dx; orient.y = dy;
    };
    tiltBtn.addEventListener('click', async () => {
      if (orient.on) { orient.on = false; tiltBtn.setAttribute('aria-pressed', 'false'); tiltBtn.textContent = 'tilt'; return; }
      const DOE = DeviceOrientationEvent as any;
      try { if (typeof DOE.requestPermission === 'function' && (await DOE.requestPermission()) === 'denied') return; } catch { /* older Safari throws without a gesture; try anyway */ }
      orient.on = true; orient.b0 = null; orient.x = orient.y = 0;
      addEventListener('deviceorientation', onOrient);
      tiltBtn.setAttribute('aria-pressed', 'true'); tiltBtn.textContent = 'tilt on';
      firstTouch();
      orient.seen = false;
      setTimeout(() => { if (orient.on && !orient.seen) { orient.on = false; tiltBtn.setAttribute('aria-pressed', 'false'); tiltBtn.textContent = 'no tilt here'; } }, 2500);
    });
  }

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    if (panel.classList.contains('open')) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
      keys.add(k); e.preventDefault(); firstTouch();
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  const mouse = { in: false, x: 0, y: 0, moved: false };
  const touch = { id: -1, sx: 0, sy: 0, x: 0, y: 0 };
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { mouse.in = true; mouse.x = e.clientX; mouse.y = e.clientY; if (!mouse.moved) { mouse.moved = true; } firstTouch(); }
    else if (e.pointerId === touch.id) {
      touch.x = e.clientX; touch.y = e.clientY;
      // floating stick: drag the origin along when pulled past the rim
      const dx = touch.x - touch.sx, dy = touch.y - touch.sy, l = Math.hypot(dx, dy), rim = 64;
      if (l > rim) { touch.sx = touch.x - (dx / l) * rim; touch.sy = touch.y - (dy / l) * rim; }
      placeJoy();
    }
  });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') mouse.in = false; });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') {
      touch.id = e.pointerId; touch.sx = touch.x = e.clientX; touch.sy = touch.y = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      joy.classList.add('on'); placeJoy();
      firstTouch();
      if (shownCard >= 0 && !(innerWidth >= 820 || (innerWidth > innerHeight && innerWidth >= 560))) cards[shownCard].classList.add('peek');
    }
  });
  const endTouch = (e: PointerEvent) => { if (e.pointerId === touch.id) { touch.id = -1; joy.classList.remove('on'); } };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
  function placeJoy() {
    joy.style.transform = `translate(${touch.sx}px, ${touch.sy}px)`;
    joyDot.style.transform = `translate(${touch.x - touch.sx}px, ${touch.y - touch.sy}px)`;
  }
  cards.forEach((c) => c.addEventListener('click', () => c.classList.remove('peek')));

  // ---------------------------------------------------------------- camera framing
  let az = THREE.MathUtils.degToRad(portrait ? 28 : 36), el = THREE.MathUtils.degToRad(portrait ? 54 : 50);
  const baseAz = az;
  const camT = new THREE.Vector3(), camTs = new THREE.Vector3();
  let camD = 30, camDs = 30, resL = 0, resB = 0;
  const bx0 = L.ox - 0.5, bx1 = -L.ox + 0.5, bz0 = L.oz - 0.5, bz1 = -L.oz + 0.5;
  const by0 = Math.min(...hs) - 2.2, by1 = Math.max(...hs) + 1.6;
  const fit = (min: THREE.Vector3, max: THREE.Vector3, tgt: THREE.Vector3, tanH: number, tanV: number) => {
    const back = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const up = new THREE.Vector3().crossVectors(back, right);
    let d = 0;
    const q = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      q.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).sub(tgt);
      const zb = q.dot(back);
      d = Math.max(d, zb + Math.abs(q.dot(right)) / tanH, zb + Math.abs(q.dot(up)) / tanV);
    }
    return d;
  };
  let introZoom = 0;
  const fmin = new THREE.Vector3(), fmax = new THREE.Vector3(), wpos = new THREE.Vector3();
  function frame(dt: number, snap = false) {
    const W = innerWidth, Hh = innerHeight;
    const wide = W >= 820 || (W > Hh && W >= 560);
    introZoom = Math.min(1, introZoom + dt * (time > 1.2 ? 0.45 : 0));
    const cardOn = shownCard >= 0;
    const wantL = wide && cardOn ? Math.min(410, W * 0.4) : 0;
    let wantB = 0;
    if (!wide && cardOn) {
      const c = cards[shownCard];
      wantB = Math.min(Hh * 0.5, c.offsetHeight + 24);
    }
    const kk = snap ? 1 : 1 - Math.exp(-dt * 2.2);
    resL += (wantL - resL) * kk; resB += (wantB - resB) * kk;
    root.style.setProperty('--resL', resL.toFixed(0) + 'px');
    camera.aspect = W / Hh;
    camera.setViewOffset(W, Hh, -resL / 2, resB / 2, W, Hh);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * ((Hh - resB - 70) / Hh);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * ((W - resL - 30) / W);
    const celebrating = celebrateT >= 0 && celebrateT < 20;
    const zoomK = (celebrating ? 0 : (wide ? 0.55 : 0.74)) * introZoom;
    const F = wide ? 4.2 : 3.0;
    wpos.copy(ball.p);
    fmin.set(THREE.MathUtils.lerp(bx0, wpos.x - F, zoomK), THREE.MathUtils.lerp(by0, wpos.y - 1.5, zoomK), THREE.MathUtils.lerp(bz0, wpos.z - F, zoomK));
    fmax.set(THREE.MathUtils.lerp(bx1, wpos.x + F, zoomK), THREE.MathUtils.lerp(by1, wpos.y + 1.2, zoomK), THREE.MathUtils.lerp(bz1, wpos.z + F, zoomK));
    camT.addVectors(fmin, fmax).multiplyScalar(0.5);
    camD = fit(fmin, fmax, camT, tanH, tanV);
    {
      // keep the view on the board: where the window is bigger than the board, centre it;
      // otherwise slide it so no edge shows more empty sky than it needs to
      const bk = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      const rt = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
      const upv = new THREE.Vector3().crossVectors(bk, rt);
      let r0 = 1e9, r1 = -1e9, u0 = 1e9, u1 = -1e9;
      const q = new THREE.Vector3();
      for (let i = 0; i < 8; i++) {
        q.set(i & 1 ? bx1 : bx0, i & 2 ? by1 : by0, i & 4 ? bz1 : bz0);
        const a = q.dot(rt), b = q.dot(upv);
        r0 = Math.min(r0, a); r1 = Math.max(r1, a); u0 = Math.min(u0, b); u1 = Math.max(u1, b);
      }
      const hr = camD * tanH * 0.92, hu = camD * tanV * 0.92;
      const tr = camT.dot(rt), tu = camT.dot(upv);
      let nr = r1 - r0 <= 2 * hr ? (r0 + r1) / 2 : THREE.MathUtils.clamp(tr, r0 + hr, r1 - hr);
      let nu = u1 - u0 <= 2 * hu ? (u0 + u1) / 2 : THREE.MathUtils.clamp(tu, u0 + hu, u1 - hu);
      // ...but never at the cost of the marble drifting toward the edge
      const mr = wpos.dot(rt), mu = wpos.dot(upv);
      nr = THREE.MathUtils.clamp(nr, mr - hr * 0.45, mr + hr * 0.45);
      nu = THREE.MathUtils.clamp(nu, mu - hu * 0.45, mu + hu * 0.45);
      camT.addScaledVector(rt, nr - tr).addScaledVector(upv, nu - tu);
    }
    const k2 = snap ? 1 : 1 - Math.exp(-dt * (reduced ? 1.2 : 1.8));
    camTs.lerp(camT, k2);
    camDs += (camD - camDs) * k2;
    const back = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(camTs).addScaledVector(back, camDs);
    camera.lookAt(camTs);
    camera.near = Math.max(0.5, camDs - 40); camera.far = camDs + 60;
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- tilt
  const tilt = new THREE.Vector2(), tiltT = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3(), mw = new THREE.Vector3(), ndc = new THREE.Vector2();
  function targetTilt() {
    const right = new THREE.Vector2(Math.cos(az), -Math.sin(az)); // (x, z)
    const fwd = new THREE.Vector2(-Math.sin(az), -Math.cos(az));
    tiltT.set(0, 0);
    if (celebrateT >= 0 && celebrateT < 3) return;
    if (touch.id >= 0) {
      const dx = (touch.x - touch.sx) / 64, dy = (touch.y - touch.sy) / 64;
      tiltT.copy(right).multiplyScalar(dx).addScaledVector(fwd, -dy);
    } else if (keys.size) {
      const x = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
      const y = (keys.has('arrowup') || keys.has('w') ? 1 : 0) - (keys.has('arrowdown') || keys.has('s') ? 1 : 0);
      tiltT.copy(right).multiplyScalar(x).addScaledVector(fwd, y);
    } else if (orient.on) {
      tiltT.copy(right).multiplyScalar(orient.x).addScaledVector(fwd, -orient.y);
    } else if (mouse.in && mouse.moved) {
      // tilt toward the cursor, measured from the marble on the board plane
      mw.copy(ball.p); board.localToWorld(mw);
      ndc.set((mouse.x / innerWidth) * 2 - 1, -(mouse.y / innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.constant = -mw.y;
      if (ray.ray.intersectPlane(plane, hit)) {
        const dx = hit.x - mw.x, dz = hit.z - mw.z, l = Math.hypot(dx, dz);
        const m = THREE.MathUtils.smoothstep(l, 0.25, 3.2);
        if (l > 1e-4) tiltT.set((dx / l) * m, (dz / l) * m);
      }
    }
    if (tiltT.length() > 1) tiltT.normalize();
  }

  // ---------------------------------------------------------------- loop
  const gLocal = new THREE.Vector3();
  const axis = new THREE.Vector3();
  let acc = 0, last = performance.now(), time = 0, running = true, slowFrames = 0;
  let celebrateFired = false;
  const DT = 1 / 240;
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    skyMat.uniforms.res.value.set(innerWidth * dpr, innerHeight * dpr);
    (petals.pts.material as THREE.ShaderMaterial).uniforms.scale.value = innerHeight * dpr * 0.9;
    (glows.pts.material as THREE.ShaderMaterial).uniforms.scale.value = innerHeight * dpr * 0.9;
  }
  addEventListener('resize', () => { resize(); });
  resize();
  frame(0, true);

  function plateCheck() {
    if (!ball.grounded) return;
    for (let k = 0; k < nRooms; k++) {
      const pp = plates[k].grp.position;
      const dx = ball.p.x - pp.x, dz = ball.p.z - pp.z;
      if (dx * dx + dz * dz < 0.42 * 0.42 && Math.abs(ball.p.y - (pp.y + R)) < 0.15) {
        if (plates[k].down < 0.5) {
          if (k === progress) reveal(k);
          else if (revealed[k]) { showCard(k); sound.chime(k * 2, 0.4); }
          else sound.click(0.3);
        }
        plates[k].down = 1;
      }
    }
  }

  function tick(now: number) {
    if (!running) return;
    requestAnimationFrame(tick);
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    // adaptive resolution
    if (dt > 0.026) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 90 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); slowFrames = 0; }

    targetTilt();
    const tk = 1 - Math.exp(-dt * 9);
    tilt.lerp(tiltT, tk);
    const tm = tilt.length();
    if (tm > 1e-4) {
      axis.set(tilt.y, 0, -tilt.x).normalize();
      world.quaternion.setFromAxisAngle(axis, tm * TILT_VIS);
    } else world.quaternion.identity();
    world.position.y = pivotY + (reduced ? 0 : Math.sin(time * 0.6) * 0.06);
    const th = tm * TILT_PHYS;
    const s = tm > 1e-4 ? Math.sin(th) / tm : 0;
    gLocal.set(tilt.x * s * G, -Math.cos(th) * G, tilt.y * s * G);

    // gates
    L.gates.forEach((g, k) => {
      const a = gateAnim[k];
      if (a.t < 0 || g.open >= 1) return;
      a.t += dt;
      const u = THREE.MathUtils.clamp((a.t - 0.7) / 1.5, 0, 1);
      if (a.t - dt < 0.7 && a.t >= 0.7) {
        sound.rumble(1.5);
        const m = gateMeshes[k];
        const bb = new THREE.Box3().setFromObject(m);
        const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
        const lp = board.worldToLocal(new THREE.Vector3(cx, 0, cz));
        for (let i = 0; i < 26; i++) glows.emit(lp.x + (rnd() - 0.5) * 1.0, g.h + 0.05, lp.z + (rnd() - 0.5) * 1.0, (rnd() - 0.5) * 0.8, 0.2 + rnd() * 0.4, (rnd() - 0.5) * 0.8, dustCol, 0.16, 1.2 + rnd(), 3);
      }
      g.open = u * u * (3 - 2 * u);
      gateMeshes[k].position.y = g.h - (WALL_H + 0.03) * g.open + (u > 0 && u < 1 ? Math.sin(time * 60) * 0.004 : 0);
      if (g.open >= 1) gateMeshes[k].visible = false;
    });

    // physics
    acc += dt;
    let steps = 0;
    impacts.length = 0;
    while (acc >= DT && steps < 16) {
      ball.step(L, gLocal, DT, impacts);
      acc -= DT; steps++;
    }
    if (steps >= 16) acc = 0;
    let maxImp = 0;
    for (const im of impacts) maxImp = Math.max(maxImp, im.speed);
    if (maxImp > 0.9) sound.click(Math.min(1, (maxImp - 0.6) / 4));
    sound.roll(ball.v.length(), ball.grounded);
    // safety net
    if (ball.grounded && ball.groundTime > 0.3) {
      const ci = Math.floor((ball.p.x - L.ox) / C), cj = Math.floor((ball.p.z - L.oz) / C);
      if (L.roomOf[cj * L.nx + ci] >= 0) ball.safe.copy(ball.p);
    }
    if (ball.p.y < L.minY - 2 || !isFinite(ball.p.x)) {
      ball.p.copy(ball.safe).y += 2; ball.v.set(0, 0, 0);
    }
    marbleGrp.position.copy(ball.p);
    marble.quaternion.copy(ball.q);
    core.quaternion.copy(ball.q);
    // caustic below the marble
    {
      let gy = ball.p.y - R;
      if (!ball.grounded) {
        let y = ball.p.y;
        for (let i = 0; i < 30; i++) { const d = sdf(L, ball.p.x, y, ball.p.z); if (d < 0.01) break; y -= Math.max(0.02, d); if (y < L.minY) break; }
        gy = y;
      }
      const hgt = ball.p.y - R - gy;
      caustic.position.set(ball.p.x - lightDir.x * 0.2, gy + 0.008, ball.p.z - lightDir.z * 0.2);
      const sc = 0.42 + hgt * 0.3;
      caustic.scale.set(sc, sc, 1);
      (caustic.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.75 - hgt * 0.5, 0, 0.75);
    }

    // rooms & plates
    plateCheck();
    const ci = Math.floor((ball.p.x - L.ox) / C), cj = Math.floor((ball.p.z - L.oz) / C);
    const room = ci >= 0 && cj >= 0 && ci < L.nx && cj < L.nz ? L.roomOf[cj * L.nx + ci] : -1;
    if (room >= 0 && room !== lastRoom) {
      lastRoom = room;
      if (celebrateT < 0 || celebrateT > 20) {
        if (revealed[room]) showCard(room); else showCard(-1);
      }
    }
    plates.forEach((p, k) => {
      const onIt = (() => { const pp = p.grp.position; const dx = ball.p.x - pp.x, dz = ball.p.z - pp.z; return dx * dx + dz * dz < 0.5 * 0.5 && ball.p.y - pp.y < R + 0.2; })();
      if (!onIt) p.down = Math.max(0, p.down - dt * 3);
      p.disc.position.y = -0.035 * Math.min(1, p.down) - 0.005;
      p.dot.position.y = p.disc.position.y + 0.01;
      const active = k === progress;
      const want = revealed[k] ? 1 : active ? 0.45 + 0.35 * Math.sin(time * 2.6) : 0.08;
      p.glow += (want - p.glow) * (1 - Math.exp(-dt * 4));
      p.discMat.emissiveIntensity = p.glow * 0.5;
      p.ringMat.opacity = 0.25 + p.glow * 0.75;
      const hm = p.halo.material as THREE.MeshBasicMaterial;
      hm.opacity = active ? 0.18 + 0.12 * Math.sin(time * 2.6) : revealed[k] ? 0.12 : 0;
      const hs2 = active ? 1 + 0.12 * Math.sin(time * 2.6) : 1;
      p.halo.scale.set(hs2, hs2, 1);
      if (active && !reduced && rnd() < dt * 3) {
        const a = rnd() * Math.PI * 2;
        glows.emit(p.grp.position.x + Math.cos(a) * 0.35, p.grp.position.y + 0.05, p.grp.position.z + Math.sin(a) * 0.35, 0, 0.35 + rnd() * 0.2, 0, plateCol, 0.12, 1.6, 2);
      }
    });

    // ambient life: fountains, fireflies
    for (const r of L.rooms) {
      for (const f of r.fountains) if (rnd() < dt * (reduced ? 6 : 22)) {
        const a = rnd() * Math.PI * 2, s = 0.25 + rnd() * 0.25;
        petals.emit(f[0], f[1], f[2], Math.cos(a) * s, 1.4 + rnd() * 0.5, Math.sin(a) * s, waterCol, 0.05, 0.45, 1);
      }
      const ffRate = (pal.night ? 0.5 : 0.12) + (celebrateT >= 0 && celebrateT < 16 ? 4 : 0);
      for (const tr of r.trees) if (rnd() < dt * ffRate) {
        glows.emit(tr[0] + (rnd() - 0.5) * 1.2, tr[1] + (rnd() - 0.5) * 0.6, tr[2] + (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 0.2, 0.1 + rnd() * 0.25, (rnd() - 0.5) * 0.2, glowCol, 0.13 + rnd() * 0.08, 3 + rnd() * 3, 2);
      }
    }

    // celebration
    if (celebrateT >= 0) {
      celebrateT += dt;
      if (!celebrateFired && celebrateT > 1.0) {
        celebrateFired = true;
        sound.fanfare();
        fin.classList.add('show');
        root.classList.add('done');
      }
      if (celebrateT > 0.8 && celebrateT < 14) {
        for (let k = 0; k < nRooms; k++) if (rnd() < dt * 9) {
          const pp = plates[k].grp.position;
          glows.emit(pp.x + (rnd() - 0.5) * 0.6, pp.y + 0.1, pp.z + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.3, 0.6 + rnd() * 0.8, (rnd() - 0.5) * 0.3, rnd() < 0.5 ? glowCol : plateCol, 0.2 + rnd() * 0.1, 3 + rnd() * 2, 2);
        }
      }
      glowMat.color.setScalar(1 + 0.6 * Math.max(0, Math.min(1, (celebrateT - 0.8) * 0.5)));
      if (!reduced) {
        const u = THREE.MathUtils.clamp((celebrateT - 1.5) / 16, 0, 1);
        az = baseAz + Math.PI * 2 * (u * u * (3 - 2 * u));
      }
    }

    petals.update(dt, time);
    glows.update(dt, time);
    for (const f of flags) {
      const pos = f.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = f.base[i * 3];
        pos.setZ(i, Math.sin(time * (reduced ? 1.5 : 5) - x * 14 + f.ph) * x * 0.16);
      }
      pos.needsUpdate = true;
    }
    for (const b of birds) {
      const a = b.ph + time * b.sp * (reduced ? 0.3 : 1);
      b.g.position.set(Math.cos(a) * b.rad, b.h + Math.sin(time * 0.7 + b.ph) * 0.3, Math.sin(a) * b.rad);
      b.g.rotation.y = -a + (b.sp > 0 ? 0 : Math.PI);
      const flap = reduced ? 0.15 : Math.sin(time * 9 + b.ph * 3) * 0.55 * (0.5 + 0.5 * Math.max(0, Math.sin(time * 0.8 + b.ph)));
      b.l.rotation.z = flap; b.r.rotation.z = -flap;
    }
    for (const c of clouds) {
      c.s.position.x += c.v * dt * (reduced ? 0.3 : 1);
      if (c.s.position.x > span * 0.9) c.s.position.x = -span * 0.9;
    }
    frame(dt);
    {
      const occ = occluded();
      ghost.classList.toggle('on', occ);
      if (occ) {
        gp.copy(ball.p); board.localToWorld(gp);
        const dist = gp.distanceTo(camera.position);
        gp.project(camera);
        const px = R / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * innerHeight / 2;
        ghost.style.transform = `translate(${(gp.x + 1) / 2 * innerWidth}px, ${(1 - gp.y) / 2 * innerHeight}px)`;
        ghost.style.setProperty('--r', px.toFixed(1) + 'px');
      }
    }
    renderer.render(scene, camera);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; }
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); }
  });
  requestAnimationFrame(tick);
}
