// Excavate: a block of sedimentary voxels on a plinth, brushed away grain by grain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { World, K_FIND, K_LOOSE, type Find } from './world';
import { meshChunk, CS } from './mesher';
import { DigAudio } from './audio';
import { hexToLinear, hash3, makeNoise, mulberry32 } from './rng';
import { rasterize, textWidth } from './font';
import type { FindItem } from './content';

export type Hooks = {
  labels: HTMLElement;
  makeLabel: (f: FindItem) => HTMLElement;
  onFound: (f: FindItem, count: number, total: number) => void;
  onFirstDig: () => void;
  onFinale: () => void;
};

export type Opts = { seed: number; reduced: boolean; items: FindItem[]; hooks: Hooks };

export function startExcavate(canvas: HTMLCanvasElement, o: Opts) {
  const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  const portrait = innerHeight > innerWidth * 1.15;
  const world = new World({ seed: o.seed, portrait, items: o.items });
  const { X, Y, Z } = world;
  const audio = new DigAudio();
  const rand = mulberry32(o.seed ^ 0x5eed);

  // ---- renderer ------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const dprCap = mobile ? 1.5 : 1.75;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const bg = new THREE.Color().setRGB(...hexToLinear(world.site.bg));
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 260, 620);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.16;

  const camera = new THREE.PerspectiveCamera(portrait ? 34 : 28, 1, 1, 2000);

  // world group: grid coords -> world, block centred on the origin
  const ox = -X / 2, oz = -(world.bz0 + world.bz1) / 2;
  const group = new THREE.Group();
  group.position.set(ox, 0, oz);
  scene.add(group);
  const BH = world.BH;
  const target = new THREE.Vector3(0, BH * 0.46, 0);
  const tTarget = target.clone();

  // ---- lights --------------------------------------------------------------
  const lampCol = new THREE.Color().setRGB(...hexToLinear(world.site.lamp));
  const lampDir = new THREE.Vector3(-0.86 + (rand() - 0.5) * 0.2, 0.52 + rand() * 0.12, 0.13 + rand() * 0.08).normalize();
  const lampDist = 300;
  const coverR = Math.max(world.bx1 - world.bx0, BH) * 0.66;
  const key = new THREE.SpotLight(lampCol, 5.2, 0, Math.atan(coverR / lampDist), 0.85, 0);
  key.position.copy(lampDir).multiplyScalar(lampDist).add(target);
  key.target.position.copy(target);
  key.castShadow = true;
  const sm = mobile ? 1536 : 2048;
  key.shadow.mapSize.set(sm, sm);
  key.shadow.camera.near = lampDist - 160;
  key.shadow.camera.far = lampDist + 200;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.3;
  key.shadow.radius = 2.5;
  scene.add(key, key.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(...hexToLinear('#7d8aa8')), new THREE.Color().setRGB(...hexToLinear('#4a3020')), 0.24);
  scene.add(hemi);
  const rim = new THREE.DirectionalLight(new THREE.Color().setRGB(...hexToLinear('#9fb6e0')), 0.55);
  rim.position.set(160, 120, -200);
  scene.add(rim);

  // ---- voxel material -----------------------------------------------------
  const NF = world.finds.length;
  const uniforms = {
    uTime: { value: 0 },
    uGlow: { value: new Array(17).fill(0) as number[] },
    uFindCol: { value: Array.from({ length: 17 }, (_, i) => new THREE.Vector3(...(world.finds[i]?.colour || [1, 1, 1]))) },
  };
  const voxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  voxMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aAO; attribute vec3 aFx;
        varying float vAO; varying vec3 vFx; varying vec3 vGP; varying vec3 vGN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vAO = aAO; vFx = aFx; vGP = position; vGN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uGlow[17]; uniform vec3 uFindCol[17];
        varying float vAO; varying vec3 vFx; varying vec3 vGP; varying vec3 vGN;
        float h13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x+p.y)*p.z); }
        vec3 h33(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 cell = floor(vGP - vGN*0.5);
        float hv = h13(cell + 17.0);
        diffuseColor.rgb *= 0.93 + 0.14*hv;
        vec3 fr = fract(vGP);
        vec2 fuv = abs(vGN.x) > 0.5 ? fr.yz : (abs(vGN.y) > 0.5 ? fr.xz : fr.xy);
        vec2 fw = fwidth(fuv);
        vec2 ed = min(fuv, 1.0 - fuv);
        float edge = min(ed.x, ed.y);
        float bev = smoothstep(0.0, 0.11, edge);
        float far = clamp(max(fw.x, fw.y) * 3.0 - 0.4, 0.0, 1.0);
        diffuseColor.rgb *= mix(mix(0.86, 1.0, bev), 0.97, far);
        float ao = vAO;
        ao = ao * ao * (3.0 - 2.0 * ao);
        diffuseColor.rgb *= mix(0.28, 1.0, ao);
        if (vGN.y > 0.5) diffuseColor.rgb *= 1.04;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.42, vFx.x);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = vFx.z;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vFx.x > 0.01) {
          vec3 jit = (h33(cell * 1.7 + 3.0) - 0.5) * 0.9 * vFx.x;
          normal = normalize(normal + (viewMatrix * vec4(jit, 0.0)).xyz);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        int fid = int(vFx.y + 0.5);
        if (fid < 17) {
          float g = uGlow[fid];
          float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + hv * 6.28);
          totalEmissiveRadiance += uFindCol[fid] * g * (0.35 + 0.65 * vFx.x) * pulse * mix(0.6, 1.0, ao) * diffuseColor.rgb * 4.5;
        }
        if (vFx.x > 0.5) {
          float tw = pow(max(0.0, sin(uTime * (1.3 + hv * 2.1) + hv * 40.0)), 24.0);
          totalEmissiveRadiance += diffuseColor.rgb * tw * vFx.x * 0.9;
        }`);
  };

  // ---- chunks ---------------------------------------------------------------
  const CX = Math.ceil(X / CS), CY = Math.ceil(Y / CS), CZ = Math.ceil(Z / CS);
  const chunks: (THREE.Mesh | null)[] = new Array(CX * CY * CZ).fill(null);
  const dirty = new Set<number>();
  const cid = (cx: number, cy: number, cz: number) => cx + CX * (cz + CZ * cy);
  function buildChunk(id: number) {
    const cx = id % CX, cz = Math.floor(id / CX) % CZ, cy = Math.floor(id / (CX * CZ));
    const md = meshChunk(world, cx, cy, cz);
    let m = chunks[id];
    if (!md) { if (m) { group.remove(m); m.geometry.dispose(); chunks[id] = null; } return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(md.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(md.nrm, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(md.col, 3));
    g.setAttribute('aAO', new THREE.BufferAttribute(md.ao, 1));
    g.setAttribute('aFx', new THREE.BufferAttribute(md.fx, 3));
    g.setIndex(new THREE.BufferAttribute(md.idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx * CS + 8, cy * CS + 8, cz * CS + 8), 14);
    if (m) { m.geometry.dispose(); m.geometry = g; }
    else {
      m = new THREE.Mesh(g, voxMat);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m); chunks[id] = m;
    }
  }
  function markDirty(x: number, y: number, z: number) {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(z / CS);
    dirty.add(cid(cx, cy, cz));
    const lx = x - cx * CS, ly = y - cy * CS, lz = z - cz * CS;
    if (lx === 0 && cx > 0) dirty.add(cid(cx - 1, cy, cz));
    if (lx === CS - 1 && cx < CX - 1) dirty.add(cid(cx + 1, cy, cz));
    if (ly === 0 && cy > 0) dirty.add(cid(cx, cy - 1, cz));
    if (ly === CS - 1 && cy < CY - 1) dirty.add(cid(cx, cy + 1, cz));
    if (lz === 0 && cz > 0) dirty.add(cid(cx, cy, cz - 1));
    if (lz === CS - 1 && cz < CZ - 1) dirty.add(cid(cx, cy, cz + 1));
  }
  for (let i = 0; i < chunks.length; i++) buildChunk(i);
  function flushDirty(ms: number) {
    const t0 = performance.now();
    for (const id of dirty) { dirty.delete(id); buildChunk(id); if (performance.now() - t0 > ms) break; }
  }

  // ---- plinth, floor, plaque -------------------------------------------------
  const plinthMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...hexToLinear('#2a201b')), roughness: 0.62, metalness: 0 });
  const PH = 14;
  const top = new THREE.Mesh(new THREE.BoxGeometry(X + 3, PH, Z + 3), plinthMat);
  top.position.set(0, -PH / 2, Z / 2 + oz);
  const base = new THREE.Mesh(new THREE.BoxGeometry(X + 9, 5, Z + 9), plinthMat);
  base.position.set(0, -PH - 2.5, Z / 2 + oz);
  for (const m of [top, base]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...hexToLinear('#2a1f19')), roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -PH - 5; floor.receiveShadow = true;
  scene.add(floor);
  // a brass plaque, the name picked out in tiny cubes
  {
    const name = 'BEN FIRSHMAN';
    const s = 0.62, tw = textWidth(name);
    const pw = tw * s + 4, ph = 5 * s + 2.6;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.5), new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...hexToLinear('#5a4325')), metalness: 0.9, roughness: 0.45 }));
    const pz = Z + oz + 1.5 + 0.25;
    plate.position.set(0, -PH * 0.48, pz);
    plate.receiveShadow = true;
    scene.add(plate);
    const pts: number[][] = [];
    rasterize(name, (x, r) => pts.push([x, r]));
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(s * 0.92, s * 0.92, 0.4), new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...hexToLinear('#e8bd62')), metalness: 1, roughness: 0.3 }), pts.length);
    const mm = new THREE.Matrix4();
    pts.forEach(([x, r], i) => { mm.makeTranslation(-tw * s / 2 + (x + 0.5) * s, -PH * 0.48 + (2 - r) * s, pz + 0.35); im.setMatrixAt(i, mm); });
    scene.add(im);
  }

  // ---- grains (pooled, instanced) -------------------------------------------
  const P = mobile ? 1800 : 4200;
  const gx = new Float32Array(P), gy = new Float32Array(P), gz = new Float32Array(P);
  const gvx = new Float32Array(P), gvy = new Float32Array(P), gvz = new Float32Array(P);
  const gm = new Uint8Array(P), gAge = new Float32Array(P), gRest = new Float32Array(P), gFade = new Float32Array(P);
  const gSize = new Float32Array(P), gAng = new Float32Array(P), gSpin = new Float32Array(P), gAx = new Float32Array(P * 3);
  const gNoSettle = new Uint8Array(P);
  let gn = 0;
  const grainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85 }), P);
  grainMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(P * 3), 3);
  grainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grainMesh.castShadow = true; grainMesh.receiveShadow = true;
  grainMesh.frustumCulled = false; grainMesh.count = 0;
  group.add(grainMesh);
  const icol = grainMesh.instanceColor.array as Float32Array;

  function spawnGrain(x: number, y: number, z: number, vx: number, vy: number, vz: number, m: number, size = 0.36 + rand() * 0.3, noSettle = 0) {
    if (gn >= P) return -1;
    const i = gn++;
    gx[i] = x; gy[i] = y; gz[i] = z; gvx[i] = vx; gvy[i] = vy; gvz[i] = vz;
    gm[i] = m; gAge[i] = 0; gRest[i] = 0; gFade[i] = 0; gSize[i] = size; gNoSettle[i] = noSettle;
    gAng[i] = rand() * 6.28; gSpin[i] = (rand() - 0.5) * 18;
    let ax = rand() - 0.5, ay = rand() - 0.5, az = rand() - 0.5; const l = Math.hypot(ax, ay, az) || 1;
    gAx[i * 3] = ax / l; gAx[i * 3 + 1] = ay / l; gAx[i * 3 + 2] = az / l;
    const k = 0.88 + rand() * 0.22;
    icol[i * 3] = world.pal[m * 3] * k; icol[i * 3 + 1] = world.pal[m * 3 + 1] * k; icol[i * 3 + 2] = world.pal[m * 3 + 2] * k;
    return i;
  }
  function killGrain(i: number) {
    const j = --gn;
    if (i === j) return;
    gx[i] = gx[j]; gy[i] = gy[j]; gz[i] = gz[j]; gvx[i] = gvx[j]; gvy[i] = gvy[j]; gvz[i] = gvz[j];
    gm[i] = gm[j]; gAge[i] = gAge[j]; gRest[i] = gRest[j]; gFade[i] = gFade[j]; gSize[i] = gSize[j];
    gAng[i] = gAng[j]; gSpin[i] = gSpin[j]; gNoSettle[i] = gNoSettle[j];
    gAx[i * 3] = gAx[j * 3]; gAx[i * 3 + 1] = gAx[j * 3 + 1]; gAx[i * 3 + 2] = gAx[j * 3 + 2];
    icol[i * 3] = icol[j * 3]; icol[i * 3 + 1] = icol[j * 3 + 1]; icol[i * 3 + 2] = icol[j * 3 + 2];
  }

  // ---- dust motes ------------------------------------------------------------
  const D = mobile ? 700 : 1500;
  const dPos = new Float32Array(D * 3), dVel = new Float32Array(D * 3), dLife = new Float32Array(D), dMax = new Float32Array(D);
  const dA = new Float32Array(D), dS = new Float32Array(D), dC = new Float32Array(D * 3), dSeed = new Float32Array(D);
  let dn = 0;
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
  dGeo.setAttribute('aA', new THREE.BufferAttribute(dA, 1).setUsage(THREE.DynamicDrawUsage));
  dGeo.setAttribute('aS', new THREE.BufferAttribute(dS, 1).setUsage(THREE.DynamicDrawUsage));
  dGeo.setAttribute('aC', new THREE.BufferAttribute(dC, 3).setUsage(THREE.DynamicDrawUsage));
  const beamO = new THREE.Vector3(-X * 0.12, BH * 0.62, 6);
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 }, uBeamO: { value: beamO }, uBeamD: { value: lampDir }, uBeamW: { value: BH * 0.42 }, uLamp: { value: lampCol } },
    vertexShader: `attribute float aA; attribute float aS; attribute vec3 aC; uniform float uScale; uniform vec3 uBeamO, uBeamD; uniform float uBeamW;
      varying float vA; varying vec3 vC;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vec3 r = wp.xyz - uBeamO; float t = dot(r, uBeamD); float d2 = max(0.0, dot(r,r) - t*t);
        float beam = exp(-d2 / (uBeamW*uBeamW)); vA = aA * (0.18 + 1.5 * beam); vC = aC;
        vec4 mv = viewMatrix * wp; gl_PointSize = max(1.0, aS * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC; uniform vec3 uLamp;
      void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); a *= a; gl_FragColor = vec4(vC * uLamp * vA * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  function spawnDust(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r = 1, g = 0.82, b = 0.6) {
    if (dn >= D) return;
    const i = dn++;
    dPos[i * 3] = x; dPos[i * 3 + 1] = y; dPos[i * 3 + 2] = z;
    dVel[i * 3] = vx; dVel[i * 3 + 1] = vy; dVel[i * 3 + 2] = vz;
    dLife[i] = 0; dMax[i] = life; dS[i] = size; dSeed[i] = rand() * 100;
    dC[i * 3] = r; dC[i * 3 + 1] = g; dC[i * 3 + 2] = b;
  }
  function killDust(i: number) {
    const j = --dn;
    if (i === j) return;
    for (let k = 0; k < 3; k++) { dPos[i * 3 + k] = dPos[j * 3 + k]; dVel[i * 3 + k] = dVel[j * 3 + k]; dC[i * 3 + k] = dC[j * 3 + k]; }
    dLife[i] = dLife[j]; dMax[i] = dMax[j]; dS[i] = dS[j]; dSeed[i] = dSeed[j];
  }
  const ambientDust = (n: number) => {
    for (let k = 0; k < n; k++) {
      const t = (rand() - 0.3) * 200;
      const p = beamO.clone().addScaledVector(lampDir, t);
      p.x += (rand() - 0.5) * BH * 0.9; p.y += (rand() - 0.5) * BH * 0.9; p.z += (rand() - 0.5) * BH * 0.9;
      spawnDust(p.x, p.y, p.z, (rand() - 0.5) * 0.6, (rand() - 0.3) * 0.4, (rand() - 0.5) * 0.6, 8 + rand() * 10, 0.35 + rand() * 0.5, 1, 0.86, 0.68);
    }
  };
  for (let k = 0; k < (o.reduced ? 60 : 170); k++) { ambientDust(1); dLife[dn - 1] = rand() * dMax[dn - 1]; }

  // ---- a faint shaft of lamplight, for the dust to drift through ----------------
  {
    const len = 260;
    const geo = new THREE.CylinderGeometry(coverR * 0.95, coverR * 0.62, len, 48, 1, true);
    geo.translate(0, len / 2, 0);
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: lampCol }, uTime: uniforms.uTime },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vT;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vT = position.y / ${len.toFixed(1)}; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uCol; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vT;
        void main(){ float f = abs(dot(normalize(vN), normalize(vV))); f = pow(f, 2.5);
          float a = f * smoothstep(0.0, 0.18, vT) * pow(1.0 - vT, 1.6) * (0.85 + 0.15 * sin(uTime * 0.4 + vT * 9.0));
          gl_FragColor = vec4(uCol * a * 0.045, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const shaft = new THREE.Mesh(geo, shaftMat);
    shaft.position.copy(target).addScaledVector(lampDir, 10);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lampDir);
    shaft.renderOrder = 5;
    scene.add(shaft);
  }

  // ---- brush ring -------------------------------------------------------------
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  ring.renderOrder = 10;
  scene.add(ring);
  const ringDot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), ring.material);
  ringDot.renderOrder = 10;
  ring.add(ringDot);

  // ---- post -----------------------------------------------------------------
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.6, 1.7);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finalPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
      float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
        float v = smoothstep(1.05, 0.18, length(q * vec2(0.9, 1.0)));
        c *= mix(0.42, 1.0, v);
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(lum), c, 0.88);
        c += vec3(0.010, 0.006, 0.003) * (1.0 - c);
        float g = h(gl_FragCoord.xy + fract(uTime * 7.13) * 517.0) + h(gl_FragCoord.xy * 1.37 - fract(uTime * 3.1) * 211.0) - 1.0;
        c += g * 0.026;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  composer.addPass(finalPass);

  // ---- camera rig ---------------------------------------------------------------
  const rig = { yaw: -0.24, pitch: 0.2, dist: 300, tyaw: -0.24, tpitch: 0.2, tdist: 300, vy: 0, vp: 0, zoom: 1, tzoom: 1 };
  let baseDist = 300;
  function fitDist() {
    const a = camera.aspect, f = (camera.fov * Math.PI) / 180;
    const w = (world.bx1 - world.bx0) * (portrait ? 1.14 : 1.28) + 10, h = BH * 1.3 + 24;
    const dh = h / 2 / Math.tan(f / 2), dw = w / 2 / (Math.tan(f / 2) * a);
    baseDist = Math.max(dh, dw) + (world.bz1 - world.bz0) * 0.5;
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitDist();
    const pr = renderer.getPixelRatio();
    dustMat.uniforms.uScale.value = (h * pr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    finalPass.uniforms.uRes.value.set(w * pr, h * pr);
  }
  resize();
  addEventListener('resize', resize);
  const placeCamera = () => {
    const d = baseDist * rig.zoom;
    camera.position.set(
      target.x + Math.sin(rig.yaw) * Math.cos(rig.pitch) * d,
      target.y + Math.sin(rig.pitch) * d,
      target.z + Math.cos(rig.yaw) * Math.cos(rig.pitch) * d,
    );
    camera.lookAt(target);
  };
  placeCamera();

  // ---- ray marching through the grid ------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  type Hit = { x: number; y: number; z: number; nx: number; ny: number; nz: number; px: number; py: number; pz: number };
  function castGrid(sx: number, sy: number): Hit | null {
    ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const ro = ray.ray.origin, rd = ray.ray.direction;
    const o3 = [ro.x - ox, ro.y, ro.z - oz], d3 = [rd.x, rd.y, rd.z], dim = [X, Y, Z];
    let t0 = 0, t1 = 5000, ax = -1;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d3[a]) < 1e-9) { if (o3[a] < 0 || o3[a] > dim[a]) return null; continue; }
      let ta = (0 - o3[a]) / d3[a], tb = (dim[a] - o3[a]) / d3[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) { t0 = ta; ax = a; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    const p = [o3[0] + d3[0] * (t0 + 1e-4), o3[1] + d3[1] * (t0 + 1e-4), o3[2] + d3[2] * (t0 + 1e-4)];
    const c = p.map((v, a) => Math.min(dim[a] - 1, Math.max(0, Math.floor(v))));
    const step = d3.map((v) => (v > 0 ? 1 : -1));
    const tMax = d3.map((v, a) => (Math.abs(v) < 1e-9 ? Infinity : ((v > 0 ? c[a] + 1 : c[a]) - o3[a]) / v));
    const tDel = d3.map((v) => (Math.abs(v) < 1e-9 ? Infinity : Math.abs(1 / v)));
    let n = [0, 0, 0];
    if (ax >= 0) n[ax] = -step[ax];
    let t = t0;
    for (let k = 0; k < 600; k++) {
      if (world.mat[world.idx(c[0], c[1], c[2])]) {
        return { x: c[0], y: c[1], z: c[2], nx: n[0], ny: n[1], nz: n[2], px: o3[0] + d3[0] * t, py: o3[1] + d3[1] * t, pz: o3[2] + d3[2] * t };
      }
      let a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      t = tMax[a];
      c[a] += step[a]; tMax[a] += tDel[a];
      n = [0, 0, 0]; n[a] = -step[a];
      if (c[a] < 0 || c[a] >= dim[a]) {
        if (a === 1 && c[1] < 0) return { x: c[0], y: -1, z: c[2], nx: 0, ny: 1, nz: 0, px: o3[0] + d3[0] * t, py: 0, pz: o3[2] + d3[2] * t };
        return null;
      }
    }
    return null;
  }

  // ---- digging ----------------------------------------------------------------------
  const unsupported: number[] = [];
  let removedThisFrame = 0;
  let nearFind = 0;
  const brushR = mobile ? 3.6 : 3.2;
  function clearCell(x: number, y: number, z: number, i: number) {
    world.mat[i] = 0; world.kind[i] = 0; world.hp[i] = 0;
    markDirty(x, y, z);
    if (y + 1 < Y) unsupported.push(world.idx(x, y + 1, z));
  }
  function exposed(x: number, y: number, z: number) {
    return !world.solid(x + 1, y, z) || !world.solid(x - 1, y, z) || !world.solid(x, y + 1, z) || !world.solid(x, y - 1, z) || !world.solid(x, y, z + 1) || !world.solid(x, y, z - 1);
  }
  function dig(h: Hit, rate: number, dt: number, dvx: number, dvy: number, dvz: number) {
    const R = brushR;
    const cx = h.px - h.nx * R * 0.3, cy = h.py - h.ny * R * 0.3, cz = h.pz - h.nz * R * 0.3;
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(X - 1, Math.floor(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(Y - 1, Math.floor(cy + R));
    const z0 = Math.max(0, Math.floor(cz - R)), z1 = Math.min(Z - 1, Math.floor(cz + R));
    const toRemove: number[] = [];
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > R) continue;
      const i = world.idx(x, y, z);
      const m = world.mat[i];
      if (!m) continue;
      const kd = world.kind[i];
      if (kd >= K_FIND) continue;
      if (!exposed(x, y, z)) continue;
      if (kd === K_LOOSE) { toRemove.push(x, y, z, i); continue; }
      const fall = Math.pow(1 - d / R, 0.6);
      world.hp[i] -= rate * dt * fall;
      if (world.hp[i] <= 0) toRemove.push(x, y, z, i);
    }
    for (let k = 0; k < toRemove.length; k += 4) {
      const x = toRemove[k], y = toRemove[k + 1], z = toRemove[k + 2], i = toRemove[k + 3];
      const m = world.mat[i];
      const loose = world.kind[i] === K_LOOSE;
      clearCell(x, y, z, i);
      removedThisFrame++;
      if (rand() < (loose ? 1 : 0.85)) {
        const out = loose ? 6 : 3.5;
        spawnGrain(x + 0.5, y + 0.5, z + 0.5,
          h.nx * out * (0.5 + rand()) + dvx * 0.35 + (rand() - 0.5) * 4,
          h.ny * out * (0.5 + rand()) + dvy * 0.35 + 2 + rand() * 4,
          h.nz * out * (0.5 + rand()) + dvz * 0.35 + (rand() - 0.5) * 4, m);
      }
      if (rand() < 0.22) {
        const gold = nearFind > 0.15 && rand() < nearFind;
        spawnDust(x + 0.5 + ox, y + 0.5, z + 0.5 + oz, h.nx * 2 + (rand() - 0.5) * 3, 1 + rand() * 2.5, h.nz * 2 + (rand() - 0.5) * 3, 2 + rand() * 3, 0.5 + rand() * 0.8,
          gold ? 1.6 : 1, gold ? 1.2 : 0.8, gold ? 0.5 : 0.62);
      }
    }
    // divining: how near is something still buried?
    nearFind = 0;
    for (const f of world.finds) {
      if (f.found) continue;
      const dx = Math.max(f.x0 - cx, 0, cx - f.x1), dy = Math.max(f.y0 - cy, 0, cy - f.y1), dz = Math.max(f.z0 - cz, 0, cz - f.z1);
      const d = Math.hypot(dx, dy, dz);
      nearFind = Math.max(nearFind, 1 - d / 9);
    }
    if (nearFind > 0) audio.near(nearFind);
  }
  function processUnsupported() {
    let n = 0;
    while (unsupported.length && n++ < 400) {
      const i = unsupported.pop()!;
      if (world.kind[i] !== K_LOOSE || !world.mat[i]) continue;
      const y = Math.floor(i / (X * Z)), r = i - y * X * Z, z = Math.floor(r / X), x = r - z * X;
      if (world.solid(x, y - 1, z)) continue;
      const m = world.mat[i];
      if (spawnGrain(x + 0.5, y + 0.5, z + 0.5, (rand() - 0.5) * 1.5, 0, (rand() - 0.5) * 1.5, m) < 0) continue;
      clearCell(x, y, z, i);
    }
  }

  // ---- grain physics ---------------------------------------------------------------
  const G = 95;
  let tickBudget = 0;
  function stepGrains(dt: number, finale: boolean) {
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), axis = new THREE.Vector3();
    const arr = grainMesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < gn; i++) {
      gAge[i] += dt;
      if (gFade[i] > 0) {
        gFade[i] += dt * 2.2;
        if (gFade[i] >= 1) { killGrain(i); i--; continue; }
      } else if (gAge[i] > 9) gFade[i] = 0.01;
      gvy[i] -= G * dt;
      const drag = 1 - 0.6 * dt;
      gvx[i] *= drag; gvz[i] *= drag; gvy[i] *= 1 - 0.15 * dt;
      // integrate per axis with voxel collision
      let x = gx[i], y = gy[i], z = gz[i];
      let hitY = false;
      const nx = x + gvx[i] * dt;
      if (collides(nx, y, z)) { gvx[i] *= -0.25; gvz[i] *= 0.7; } else x = nx;
      const ny = y + gvy[i] * dt;
      if (collides(x, ny, z)) {
        const sp = Math.abs(gvy[i]);
        if (sp > 14 && tickBudget > 0) { tickBudget--; audio.tick(Math.min(1, sp / 60)); }
        if (sp > 22 && rand() < 0.12) spawnDust(x + ox, y, z + oz, (rand() - 0.5) * 2, 0.6 + rand(), (rand() - 0.5) * 2, 1.5 + rand() * 2, 0.4 + rand() * 0.4);
        gvy[i] = gvy[i] < 0 ? -gvy[i] * (0.18 + rand() * 0.2) : 0;
        gvx[i] *= 0.62; gvz[i] *= 0.62; gSpin[i] *= 0.6;
        hitY = true;
      } else y = ny;
      const nz = z + gvz[i] * dt;
      if (collides(x, y, nz)) { gvz[i] *= -0.25; gvx[i] *= 0.7; } else z = nz;
      gx[i] = x; gy[i] = y; gz[i] = z;
      if (y < -PH - 4.4) { // on the gallery floor
        gy[i] = -PH - 4.4; gvy[i] = Math.abs(gvy[i]) > 4 ? -gvy[i] * 0.25 : 0; gvx[i] *= 0.8; gvz[i] *= 0.8;
        if (gFade[i] === 0 && gAge[i] > 0.6) gFade[i] = 0.01;
      }
      if (y < -80) { killGrain(i); i--; continue; }
      // rest and settle
      const sp2 = gvx[i] * gvx[i] + gvy[i] * gvy[i] + gvz[i] * gvz[i];
      if (hitY && sp2 < 9) gRest[i] += dt; else gRest[i] = Math.max(0, gRest[i] - dt * 0.5);
      if (gRest[i] > 0.09 && gFade[i] === 0) {
        const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
        // roll down a slope rather than stack
        let rolled = false;
        const start = Math.floor(rand() * 4);
        for (let k = 0; k < 4; k++) {
          const dd = (start + k) & 3;
          const ddx = dd === 0 ? 1 : dd === 1 ? -1 : 0, ddz = dd === 2 ? 1 : dd === 3 ? -1 : 0;
          if (!world.solid(cx + ddx, cy, cz + ddz) && !world.solid(cx + ddx, cy - 1, cz + ddz)) {
            gvx[i] = ddx * (3 + rand() * 3); gvz[i] = ddz * (3 + rand() * 3); gvy[i] = 1.5;
            gRest[i] = 0; rolled = true; break;
          }
        }
        if (!rolled) {
          const ok = !finale && !gNoSettle[i] && world.inGrid(cx, cy, cz) && cy >= 0 && rand() < 0.42;
          if (ok) {
            const ci = world.idx(cx, cy, cz);
            if (!world.mat[ci] && world.solid(cx, cy - 1, cz)) {
              world.mat[ci] = gm[i]; world.kind[ci] = K_LOOSE; world.hp[ci] = 1;
              markDirty(cx, cy, cz);
              killGrain(i); i--; continue;
            }
          }
          gFade[i] = 0.01;
        }
      }
      gAng[i] += gSpin[i] * dt;
      const s = gSize[i] * (gFade[i] > 0 ? 1 - gFade[i] : 1);
      axis.set(gAx[i * 3], gAx[i * 3 + 1], gAx[i * 3 + 2]);
      q.setFromAxisAngle(axis, gAng[i]);
      pos.set(x, y + s * 0.5, z);
      scl.set(s, s, s);
      mtx.compose(pos, q, scl);
      mtx.toArray(arr, i * 16);
    }
    grainMesh.count = gn;
    grainMesh.instanceMatrix.needsUpdate = true;
    grainMesh.instanceColor!.needsUpdate = true;
  }
  function inPlinth(x: number, z: number) { return x >= -1.5 && z >= -1.5 && x < X + 1.5 && z < Z + 1.5; }
  function collides(x: number, y: number, z: number) {
    if (y < 0) return inPlinth(x, z) && y > -PH;
    return world.solid(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  function stepDust(dt: number, t: number) {
    const slow = o.reduced ? 0.35 : 1;
    for (let i = 0; i < dn; i++) {
      dLife[i] += dt * slow;
      if (dLife[i] >= dMax[i]) { killDust(i); i--; continue; }
      const s = dSeed[i];
      const k = Math.min(1, dt * 1.4);
      dVel[i * 3] += (Math.sin(t * 0.31 + s) * 0.35 - dVel[i * 3]) * k * 0.4;
      dVel[i * 3 + 1] += (0.12 + Math.sin(t * 0.23 + s * 1.7) * 0.2 - dVel[i * 3 + 1]) * k * 0.4;
      dVel[i * 3 + 2] += (Math.cos(t * 0.27 + s * 0.6) * 0.35 - dVel[i * 3 + 2]) * k * 0.4;
      dPos[i * 3] += dVel[i * 3] * dt * slow; dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt * slow; dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt * slow;
      const u = dLife[i] / dMax[i];
      dA[i] = Math.min(1, u * 6) * Math.pow(1 - u, 1.5) * 0.9;
    }
    for (let i = dn; i < Math.min(D, dn + 4); i++) dA[i] = 0;
    dGeo.setDrawRange(0, dn);
    for (const n of ['position', 'aA', 'aS', 'aC']) (dGeo.attributes[n] as THREE.BufferAttribute).needsUpdate = true;
  }

  // ---- finds -------------------------------------------------------------------------
  const labels: { f: Find; el: HTMLElement; a: number; w: number; h: number; cw: number; ch: number; vis: number }[] = [];
  let foundCount = 0;
  function crackGeode(f: Find) {
    const R = Math.ceil(f.r + 1);
    for (let z = Math.floor(f.cz - R); z <= f.cz + R; z++) for (let y = Math.floor(f.cy - R); y <= f.cy + R; y++) for (let x = Math.floor(f.cx - R); x <= f.cx + R; x++) {
      if (!world.inGrid(x, y, z)) continue;
      const i = world.idx(x, y, z);
      if (world.kind[i] !== K_FIND + f.id) continue;
      const dz = z + 0.5 - f.cz;
      if (dz > f.r * 0.22) {
        const m = world.mat[i];
        clearCell(x, y, z, i);
        spawnGrain(x + 0.5, y + 0.5, z + 0.5, (x + 0.5 - f.cx) * 2 + (rand() - 0.5) * 3, 4 + rand() * 6, 5 + rand() * 6, m, 0.35 + rand() * 0.3, 1);
        spawnDust(x + 0.5 + ox, y + 0.5, z + 0.5 + oz, (rand() - 0.5) * 4, rand() * 3, 2 + rand() * 3, 2 + rand() * 2, 0.7, f.colour[0] * 2, f.colour[1] * 2, f.colour[2] * 2);
      }
    }
  }
  function discover(f: Find) {
    f.found = true; f.t = 0;
    foundCount++;
    if (f.type === 'geode') crackGeode(f);
    const el = o.hooks.makeLabel(f.item);
    el.style.opacity = '0';
    o.hooks.labels.appendChild(el);
    labels.push({ f, el, a: 0, w: 0, h: 0, cw: 0, ch: 0, vis: 0 });
    audio.found(foundCount - 1, f.type === 'geode');
    o.hooks.onFound(f.item, foundCount, world.finds.length);
    for (let k = 0; k < 26; k++) {
      const a = f.anchor;
      spawnDust(a[0] + ox + (rand() - 0.5) * (f.x1 - f.x0), a[1] - rand() * (f.y1 - f.y0), a[2] + oz + 1, (rand() - 0.5) * 2, 0.5 + rand() * 2, 1 + rand() * 2, 2.5 + rand() * 2, 0.5 + rand() * 0.6, f.colour[0] * 2.2, f.colour[1] * 2.2, f.colour[2] * 2.2);
    }
    if (foundCount === world.finds.length) setTimeout(startFinale, 2400);
  }
  let checkTick = 0;
  function checkFinds(dt: number) {
    if (++checkTick % 5 === 0) {
      for (const f of world.finds) {
        if (f.found) continue;
        f.exposure = world.exposure(f);
        if (f.exposure >= f.need) discover(f);
      }
    }
    for (const f of world.finds) {
      let g: number;
      if (f.found) {
        f.t += dt;
        g = 0.5 + 1.1 * Math.exp(-f.t * 1.3);
      } else g = Math.max(0, (f.exposure / f.need - 0.25)) * 0.35;
      f.glow += (g - f.glow) * Math.min(1, dt * 4);
      uniforms.uGlow.value[f.id] = f.glow * (f.type === 'geode' ? 0.7 : 1);
    }
  }
  const v3 = new THREE.Vector3();
  // Labels sit against their find: above, below, or just inside its lower edge, whichever is free.
  // The hovered and the newest finds show in full; the rest shrink to their names or step aside.
  const corners = new Float32Array(8);
  function screenRect(f: Find) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, ok = true;
    const pts = f.type === 'tablet'
      ? [[f.x0, f.y0, f.zr + 1], [f.x1, f.y0, f.zr + 1], [f.x0, f.y1, f.zr + 1], [f.x1, f.y1, f.zr + 1]]
      : [[f.cx - f.r, f.cy - f.r, f.cz + f.r * 0.5], [f.cx + f.r, f.cy - f.r, f.cz + f.r * 0.5], [f.cx - f.r, f.cy + f.r, f.cz + f.r * 0.5], [f.cx + f.r, f.cy + f.r, f.cz + f.r * 0.5]];
    for (const p of pts) {
      v3.set(p[0] + ox, p[1], p[2] + oz).project(camera);
      if (v3.z > 1) ok = false;
      const sx = (v3.x * 0.5 + 0.5) * innerWidth, sy = (-v3.y * 0.5 + 0.5) * innerHeight;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    corners[0] = x0; corners[1] = y0; corners[2] = x1; corners[3] = y1;
    return ok;
  }
  function measure(L: (typeof labels)[number]) {
    L.el.classList.add('compact');
    L.cw = L.el.offsetWidth; L.ch = L.el.offsetHeight;
    L.el.classList.remove('compact');
    L.w = L.el.offsetWidth; L.h = L.el.offsetHeight;
  }
  function placeLabels(dt: number) {
    const W = innerWidth, H = innerHeight;
    const placed: number[][] = [];
    const cxp = kbd.on ? kbd.x : px, cyp = kbd.on ? kbd.y : py;
    let hovered: (typeof labels)[number] | null = null, best = 1e9;
    const info = labels.map((L) => {
      const ok = screenRect(L.f);
      const r = [corners[0], corners[1], corners[2], corners[3]];
      if (ok && (hover || kbd.on || pointers.size) && cxp > r[0] - 12 && cxp < r[2] + 12 && cyp > r[1] - 12 && cyp < r[3] + 12) {
        const d = Math.hypot(cxp - (r[0] + r[2]) / 2, cyp - (r[1] + r[3]) / 2);
        if (d < best) { best = d; hovered = L; }
      }
      return { L, r, ok };
    });
    info.sort((a, b) => (a.L === hovered ? -1 : b.L === hovered ? 1 : a.L.f.t - b.L.f.t));
    // keep the labels clear of the finds themselves where possible
    const blockers = info.filter((i) => i.ok).map((i) => i.r);
    const overlaps = (x0: number, y0: number, x1: number, y1: number, own: number[], strict: boolean) => {
      for (const p of placed) if (x0 < p[2] + 4 && x1 > p[0] - 4 && y0 < p[3] + 2 && y1 > p[1] - 2) return true;
      if (strict) for (const b of blockers) if (b !== own && x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return true;
      return false;
    };
    info.forEach(({ L, r, ok }, rank) => {
      if (!L.w) measure(L);
      L.a = Math.min(1, L.a + dt * 1.1);
      const full = L === hovered || L.f.t < 7;
      L.el.classList.toggle('compact', !full);
      const w = full ? L.w : L.cw, h = full ? L.h : L.ch;
      const cx = (r[0] + r[2]) / 2;
      const cands = [[cx, r[1] - 4 - h], [cx, r[3] + 4], [cx, r[3] - h - 2], [cx, r[1] + 2]];
      let pick: number[] | null = null;
      for (const c of cands) {
        const x0 = Math.max(6, Math.min(W - 6 - w, c[0] - w / 2)), y0 = Math.max(6, Math.min(H - 6 - h, c[1]));
        if (!overlaps(x0, y0, x0 + w, y0 + h, r, true)) { pick = [x0, y0]; break; }
      }
      if (!pick) for (const c of cands) {
        const x0 = Math.max(6, Math.min(W - 6 - w, c[0] - w / 2)), y0 = Math.max(6, Math.min(H - 6 - h, c[1]));
        if (!overlaps(x0, y0, x0 + w, y0 + h, r, false)) { pick = [x0, y0]; break; }
      }
      if (!pick && rank === 0 && (L === hovered || L.f.t < 7)) pick = [Math.max(6, Math.min(W - 6 - w, cands[0][0] - w / 2)), Math.max(6, cands[0][1])];
      const show = ok && !!pick && (finale < 2 || full);
      if (pick) {
        placed.push([pick[0], pick[1], pick[0] + w, pick[1] + h]);
        L.el.style.transform = `translate3d(${pick[0].toFixed(1)}px, ${pick[1].toFixed(1)}px, 0)`;
      }
      L.vis += ((show ? 1 : 0) - L.vis) * Math.min(1, dt * 8);
      L.el.style.opacity = String((L.vis * L.a * (full ? 1 : 0.8)).toFixed(3));
      L.el.style.pointerEvents = L.vis > 0.5 ? 'auto' : 'none';
      L.el.classList.toggle('hot', L === hovered);
    });
  }


  // ---- finale: the block gives way, the finds settle into a dune, the name is written in the sand
  let finale = -1;
  let fin = { top: Y - 1, dune: 0 };
  const duneH = new Float32Array(X * Z);
  const duneM = new Uint8Array(X * Z);
  type Faller = { f: Find; cells: number[]; v: number; acc: number; rest: boolean; fell: number };
  let fallers: Faller[] = [];
  const NAME_FID = 16;
  function prepDune() {
    const n = makeNoise(mulberry32(o.seed + 99));
    const ccx = X / 2, ccz = (world.bz0 + world.bz1) / 2;
    const sx = (world.bx1 - world.bx0) * 0.6, sz = (world.bz1 - world.bz0) * 0.75;
    const Hm = portrait ? 9 : 7;
    const lum = (m: number) => world.pal[m * 3] * 0.3 + world.pal[m * 3 + 1] * 0.59 + world.pal[m * 3 + 2] * 0.11;
    const sand = [...world.sand].sort((a, b) => lum(a) - lum(b)).slice(0, Math.max(2, Math.ceil(world.sand.length * 0.7)));
    for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
      const dx = (x - ccx) / sx, dz = (z - ccz) / sz;
      const r2 = dx * dx + dz * dz;
      let h = Hm * Math.exp(-r2 * 1.5) + 2.2 * Math.exp(-dx * dx * 0.9);
      const rip = Math.sin(x * 0.5 + z * 0.24 + n(x * 0.05, 0, z * 0.05) * 3);
      h += rip * 0.55 * Math.min(1, h / 2.5);
      duneH[x + z * X] = Math.max(0, h);
      duneM[x + z * X] = sand[Math.floor((rip * 0.5 + 0.5) * sand.length * 0.999 + hash3(x, 0, z, 5) * 1.2) % sand.length];
    }
    // the name, raised and faintly lit, on the apron in front of where the block stood
    const lines = portrait ? ['BEN', 'FIRSHMAN'] : ['BEN FIRSHMAN'];
    const S = 2;
    const rows = lines.length * 5 * S + (lines.length - 1) * 3;
    let zTop = Math.round(world.bz1 + (Z - world.bz1 - rows) / 2);
    lines.forEach((ln) => {
      const lw = textWidth(ln) * S;
      const x0 = Math.round(ccx - lw / 2);
      rasterize(ln, (gx2, row) => {
        for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
          const x = x0 + gx2 * S + a, z = zTop + row * S + b;
          if (x < 0 || z < 0 || x >= X || z >= Z) continue;
          duneH[x + z * X] = Math.max(2.2, duneH[x + z * X]) + 1.01;
          duneM[x + z * X] = world.nameIdx;
        }
      });
      zTop += 5 * S + 3;
    });
    // the finds, ready to settle
    fallers = world.finds.map((f) => {
      const cells: number[] = [];
      const k = K_FIND + f.id;
      const R = f.type === 'geode' ? Math.ceil(f.r + 1) : 0;
      const x0 = f.type === 'geode' ? Math.floor(f.cx - R) : f.x0, x1 = f.type === 'geode' ? Math.ceil(f.cx + R) : f.x1;
      const y0 = f.type === 'geode' ? Math.floor(f.cy - R) : f.y0, y1 = f.type === 'geode' ? Math.ceil(f.cy + R) : f.y1;
      const z0 = f.type === 'geode' ? Math.floor(f.cz - R) : f.z0, z1 = f.type === 'geode' ? Math.ceil(f.cz + R) : f.z1;
      for (let y = Math.max(0, y0); y <= Math.min(Y - 1, y1); y++) for (let z = Math.max(0, z0); z <= Math.min(Z - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(X - 1, x1); x++) {
        const i = world.idx(x, y, z);
        if (world.kind[i] === k) cells.push(i);
      }
      return { f, cells, v: 0, acc: 0, rest: false, fell: 0 };
    });
  }
  function fallStep(F: Faller) {
    const XZ = X * Z, k = K_FIND + F.f.id;
    for (const i of F.cells) {
      if (i < XZ) return false; // on the plinth
      const b = i - XZ;
      if (world.mat[b] && world.kind[b] !== k) return false;
    }
    const mats = F.cells.map((i) => world.mat[i]);
    for (const i of F.cells) { world.mat[i] = 0; world.kind[i] = 0; }
    F.cells = F.cells.map((i, j) => {
      const b = i - XZ;
      world.mat[b] = mats[j]; world.kind[b] = k; world.hp[b] = 999;
      return b;
    });
    for (const i of F.cells) {
      const y = Math.floor(i / XZ), r = i - y * XZ, z = Math.floor(r / X), x = r - z * X;
      markDirty(x, y, z); markDirty(x, y + 1, z);
    }
    const f = F.f;
    f.y0 -= 1; f.y1 -= 1; f.cy -= 1; f.anchor[1] -= 1;
    F.fell++;
    return true;
  }
  function startFinale() {
    if (finale >= 0) return;
    prepDune();
    finale = 0;
    fin = { top: Y - 1, dune: 0 };
    audio.finale();
    o.hooks.onFinale();
    rig.tpitch = portrait ? 0.9 : 0.72; rig.tyaw = 0; rig.tzoom = portrait ? 0.9 : 0.86;
    tTarget.set(0, BH * 0.16, (Z - world.bz1) * 0.3);
    uniforms.uFindCol.value[NAME_FID].set(...hexToLinear('#ffcf80'));
  }
  function stepFinale(dt: number) {
    if (finale < 0) return;
    finale += dt;
    const dur = o.reduced ? 3 : 7;
    const lvl = Math.floor((Y - 1) * (1 - Math.min(1, finale / dur)));
    const duneT = Math.max(0, Math.min(1, (finale - dur * 0.45) / (dur * 0.75)));
    let spawned = 0;
    const room = P - gn;
    while (fin.top >= lvl && fin.top >= 0) {
      const y = fin.top--;
      for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
        const i = world.idx(x, y, z);
        if (!world.mat[i] || world.kind[i] >= K_FIND) continue;
        if (y < duneH[x + z * X] * duneT) continue;
        const m = world.mat[i];
        clearCell(x, y, z, i);
        if (!o.reduced && spawned < room * 0.5 && rand() < 0.07) {
          spawned++;
          spawnGrain(x + 0.5, y + 0.5, z + 0.5, (rand() - 0.5) * 6, rand() * 3, (rand() - 0.5) * 6 + 2, m, undefined, 1);
        }
        if (!o.reduced && rand() < 0.004) spawnDust(x + 0.5 + ox, y + 0.5, z + 0.5 + oz, (rand() - 0.5) * 2, 0.5, (rand() - 0.5) * 2, 3 + rand() * 3, 0.6 + rand() * 0.8);
      }
    }
    // the finds sink with the stone and settle
    for (const F of fallers) {
      if (F.rest) continue;
      F.v = Math.min(36, F.v + 60 * dt);
      F.acc += F.v * dt;
      let moved = false, blocked = false;
      while (F.acc >= 1) {
        F.acc -= 1;
        if (fallStep(F)) moved = true; else { blocked = true; break; }
      }
      if (blocked) {
        if (F.fell > 2 && F.v > 8) {
          audio.tick(0.9, 0.1);
          const f = F.f;
          for (let k = 0; k < 14; k++) spawnDust(f.cx + ox + (rand() - 0.5) * (f.x1 - f.x0), f.y0 + 0.5, (f.zr || f.cz) + oz + (rand() - 0.5) * 4, (rand() - 0.5) * 6, 0.8 + rand() * 1.5, (rand() - 0.5) * 6, 2 + rand() * 2, 0.6 + rand() * 0.6);
        }
        F.v = 0; F.acc = 0;
        if (fin.top < 0 && duneT > 0.2) F.rest = true;
      }
      void moved;
    }
    // grow the dune around them
    const lvlD = duneT;
    if (lvlD > fin.dune) {
      for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
        const h = duneH[x + z * X];
        const y0 = Math.floor(h * fin.dune), y1 = Math.min(Y - 1, Math.floor(h * lvlD));
        for (let y = y0; y < y1; y++) {
          const i = world.idx(x, y, z);
          if (world.kind[i] >= K_FIND) continue;
          const top = y >= Math.floor(h) - 1;
          const nm = duneM[x + z * X] === world.nameIdx;
          const m = top ? (nm && y === Math.floor(h) - 1 ? world.nameIdx : (nm ? world.paleIdx : duneM[x + z * X])) : world.sand[Math.floor(hash3(x, y, z, 8) * world.sand.length) % world.sand.length];
          world.mat[i] = m; world.kind[i] = m === world.nameIdx ? K_FIND + NAME_FID : K_LOOSE; world.hp[i] = 1;
          markDirty(x, y, z);
        }
      }
      fin.dune = lvlD;
    }
    uniforms.uGlow.value[NAME_FID] = Math.max(0, Math.min(1, (finale - dur * 1.15) / 3)) * 0.42;
  }

  // ---- input ------------------------------------------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let digging = false, orbiting = false, firstDig = false, lastInteract = performance.now();
  let px = innerWidth / 2, py = innerHeight / 2, lastPX = px, lastPY = py, pSpeed = 0, hover = false;
  let pinch0 = 0, zoom0 = 1;
  let prevHit: Hit | null = null;
  const kbd = { on: false, x: innerWidth / 2, y: innerHeight * 0.55, dig: false, keys: new Set<string>() };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteract = performance.now();
    kbd.on = false;
    if (pointers.size === 2) {
      digging = false; orbiting = true;
      const [a, b] = [...pointers.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = rig.tzoom;
    } else if (e.button === 2 || e.button === 1 || e.shiftKey || e.altKey) {
      orbiting = true;
    } else {
      digging = true; prevHit = null;
    }
    px = lastPX = e.clientX; py = lastPY = e.clientY;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (orbiting && p) {
      if (pointers.size === 2) {
        const before = [...pointers.values()];
        const cxb = (before[0].x + before[1].x) / 2, cyb = (before[0].y + before[1].y) / 2;
        p.x = e.clientX; p.y = e.clientY;
        const after = [...pointers.values()];
        const cxa = (after[0].x + after[1].x) / 2, cya = (after[0].y + after[1].y) / 2;
        rig.tyaw -= (cxa - cxb) * 0.006; rig.tpitch += (cya - cyb) * 0.004;
        const pd = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
        if (pinch0 > 0) rig.tzoom = Math.max(0.45, Math.min(1.5, zoom0 * pinch0 / pd));
      } else {
        rig.tyaw -= (e.clientX - p.x) * 0.006; rig.tpitch += (e.clientY - p.y) * 0.004;
        p.x = e.clientX; p.y = e.clientY;
      }
      clampRig();
      return;
    }
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    px = e.clientX; py = e.clientY; hover = true;
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { digging = false; orbiting = false; }
    else if (pointers.size === 1) { orbiting = false; digging = false; }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hover = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    rig.tzoom = Math.max(0.45, Math.min(1.5, rig.tzoom * Math.exp(e.deltaY * 0.0012)));
    lastInteract = performance.now();
  }, { passive: false });
  function clampRig() {
    rig.tyaw = Math.max(-1.25, Math.min(1.25, rig.tyaw));
    rig.tpitch = Math.max(0.02, Math.min(1.15, rig.tpitch));
  }
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest?.('a, button, input, [role=dialog]') && e.target !== canvas) return;
    if (document.documentElement.classList.contains('reading')) return;
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'q', 'e', 'Q', 'E', '+', '-', '=', '_'].includes(k)) {
      e.preventDefault();
      if (!kbd.on) { kbd.on = true; kbd.x = innerWidth / 2; kbd.y = innerHeight * 0.52; }
      kbd.keys.add(k);
      lastInteract = performance.now();
      if (k === '+' || k === '=') rig.tzoom = Math.max(0.45, rig.tzoom * 0.88);
      if (k === '-' || k === '_') rig.tzoom = Math.min(1.5, rig.tzoom / 0.88);
    }
  });
  addEventListener('keyup', (e) => { kbd.keys.delete(e.key); });

  // ---- loop -------------------------------------------------------------------------------
  let last = performance.now(), running = true, raf = 0, time = 0, trickle = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    time += dt;
    uniforms.uTime.value = time;
    finalPass.uniforms.uTime.value = time;
    tickBudget = 6;

    // keyboard cursor & orbit
    if (kbd.on) {
      const sp = 420 * dt;
      if (kbd.keys.has('ArrowLeft')) kbd.x -= sp;
      if (kbd.keys.has('ArrowRight')) kbd.x += sp;
      if (kbd.keys.has('ArrowUp')) kbd.y -= sp;
      if (kbd.keys.has('ArrowDown')) kbd.y += sp;
      kbd.x = Math.max(0, Math.min(innerWidth, kbd.x)); kbd.y = Math.max(0, Math.min(innerHeight, kbd.y));
      if (kbd.keys.has('q') || kbd.keys.has('Q')) rig.tyaw += 1.2 * dt;
      if (kbd.keys.has('e') || kbd.keys.has('E')) rig.tyaw -= 1.2 * dt;
      clampRig();
      kbd.dig = kbd.keys.has(' ') || kbd.keys.has('Enter');
    }
    const cxp = kbd.on ? kbd.x : px, cyp = kbd.on ? kbd.y : py;
    const moved = Math.hypot(cxp - lastPX, cyp - lastPY);
    lastPX = cxp; lastPY = cyp;
    pSpeed += (moved / Math.max(dt, 1e-3) - pSpeed) * Math.min(1, dt * 12);

    // camera
    const idle = (now - lastInteract) / 1000;
    const sway = o.reduced || finale >= 0 ? 0 : Math.min(1, idle / 6) * 0.06;
    const k = 1 - Math.exp(-dt * (finale >= 0 ? 0.7 : 5));
    rig.yaw += (rig.tyaw + Math.sin(time * 0.11) * sway - rig.yaw) * k;
    rig.pitch += (rig.tpitch + Math.sin(time * 0.07) * sway * 0.3 - rig.pitch) * k;
    rig.zoom += (rig.tzoom - rig.zoom) * (1 - Math.exp(-dt * (finale >= 0 ? 0.7 : 6)));
    target.lerp(tTarget, k);
    placeCamera();

    // brush
    removedThisFrame = 0;
    const active = (digging || (kbd.on && kbd.dig)) && finale < 0;
    const showRing = (hover || kbd.on || digging) && finale < 0;
    let h: Hit | null = null;
    if (showRing || active) h = castGrid(cxp, cyp);
    if (h && h.y >= 0 && active) {
      if (!firstDig) { firstDig = true; o.hooks.onFirstDig(); }
      const sp = Math.min(1.6, pSpeed / 500);
      let dvx = 0, dvy = 0, dvz = 0;
      if (prevHit) { dvx = Math.max(-40, Math.min(40, (h.px - prevHit.px) / dt)); dvy = Math.max(-40, Math.min(40, (h.py - prevHit.py) / dt)); dvz = Math.max(-40, Math.min(40, (h.pz - prevHit.pz) / dt)); }
      dig(h, 110 * (0.6 + sp), dt, dvx, dvy, dvz);
      prevHit = h;
      lastInteract = now;
    } else prevHit = null;
    audio.scrape(removedThisFrame, Math.min(1, pSpeed / 900));
    const rm = ring.material as THREE.MeshBasicMaterial;
    if (h && showRing) {
      const n = v3.set(h.nx, h.ny, h.nz);
      ring.position.set(h.px + ox + h.nx * 0.05, h.py + h.ny * 0.05, h.pz + oz + h.nz * 0.05);
      ring.lookAt(ring.position.x + n.x, ring.position.y + n.y, ring.position.z + n.z);
      const pulse = active ? 0.92 + Math.sin(time * 30) * 0.04 : 1;
      ring.scale.setScalar(brushR * pulse);
      const gold = nearFind;
      rm.color.setRGB(1, 0.86 - gold * 0.1, 0.66 - gold * 0.35);
      rm.opacity += ((active ? 0.32 : 0.2) + gold * 0.25 - rm.opacity) * 0.3;
      canvas.style.cursor = h.y >= 0 ? 'none' : '';
    } else {
      rm.opacity *= 0.8;
      canvas.style.cursor = '';
    }
    ring.visible = rm.opacity > 0.01;
    if (!active) nearFind *= 0.95;

    // idle trickle: a little scree now and then, to invite a touch
    trickle -= dt;
    if (!firstDig && trickle < 0 && finale < 0 && !o.reduced) {
      trickle = 1.6 + rand() * 2.4;
      const x = world.bx0 + 4 + Math.floor(rand() * (world.bx1 - world.bx0 - 8));
      for (let kk = 0; kk < 3 + rand() * 4; kk++) spawnGrain(x + rand(), BH - 2 + rand(), world.bz1 + 0.3, (rand() - 0.5) * 1.5, 0, 1.2 + rand() * 1.5, world.sand[Math.floor(rand() * world.sand.length)], 0.4 + rand() * 0.3, 1);
    }
    if (rand() < dt * (o.reduced ? 3 : 9) && dn < D * 0.5) ambientDust(1);

    processUnsupported();
    stepFinale(dt);
    stepGrains(dt, finale >= 0);
    stepDust(dt, time);
    checkFinds(dt);
    flushDirty(finale >= 0 ? 12 : 7);
    placeLabels(dt);
    composer.render(dt);
  }
  raf = requestAnimationFrame((t) => { last = t; frame(t); });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) last = performance.now();
  });

  return {
    world,
    setSound(on: boolean) { if (on) return audio.enable(); audio.disable(); return false; },
    finale: startFinale,
    found: () => foundCount,
    total: world.finds.length,
    stop() { cancelAnimationFrame(raf); renderer.dispose(); },
  };
}
