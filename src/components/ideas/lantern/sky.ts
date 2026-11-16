// Sky dome, distant hills, voxel tree line and the ground.
import * as THREE from 'three';
import type { World } from './world';
import { voxGeometry, NOISE, LIGHT_HEAD, type LightUniforms } from './grass';

export function makeSky(world: World) {
  const S = world.season;
  const uniforms = {
    uTime: { value: 0 },
    uZen: { value: new THREE.Color(...S.zenith) },
    uMid: { value: new THREE.Color(...S.mid) },
    uHor: { value: new THREE.Color(...S.horizon) },
    uGlowC: { value: new THREE.Color(...S.glow) },
    uHills: { value: new THREE.Color(...S.hills) },
    uGlowAz: { value: world.glowAz },
    uMoonDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    uMoonSize: { value: world.moon.size },
    uMoonPhase: { value: world.moon.phase },
    uMoonTilt: { value: world.moon.tilt },
    uMoonTint: { value: new THREE.Color(...S.moonTint) },
    uMoonBright: { value: world.moon.bright },
    uPx: { value: 0.001 },
    uStars: { value: S.stars },
    uLit: { value: 0 },
    uMW: { value: new THREE.Vector3(0.3, 0.2, 0.9).normalize() },
    uSeed: { value: (world.seed % 997) * 0.731 },
  };
  // milky way great-circle normal, tilted per visit
  const a = world.mwTilt;
  uniforms.uMW.value.set(Math.sin(a) * 0.9, 0.42, Math.cos(a) * 0.55).normalize();

  const mat = new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGlowAz, uMoonSize, uMoonPhase, uMoonTilt, uMoonBright, uPx, uStars, uLit, uSeed;
      uniform vec3 uZen, uMid, uHor, uGlowC, uHills, uMoonDir, uMoonTint, uMW;
      varying vec3 vDir;
      ${NOISE}
      float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
      vec3 h33(vec3 p){ return vec3(h31(p), h31(p+17.1), h31(p+41.7)); }
      float fbm(vec2 p){ float a=0.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+7.1; a*=0.5; } return s; }
      vec3 starLayer(vec3 d, float scale, float dens, float bright){
        vec3 p = d * scale; vec3 c = floor(p);
        vec3 h = h33(c + uSeed);
        if (h.x > dens) return vec3(0);
        vec3 sp = normalize(c + 0.25 + h.yzx*0.5);
        float ang = acos(clamp(dot(d, sp), -1., 1.));
        float px = ang / uPx;
        float mag = pow(h31(c*1.7 + 3.0), 6.0);
        float r = 0.42 + mag*0.9;
        float core = exp(-px*px/(r*r));
        float tw = 0.65 + 0.35*sin(uTime*(1.0+h.z*3.0) + h.y*40.0);
        vec3 tint = mix(vec3(0.7,0.8,1.0), vec3(1.0,0.86,0.7), h.y);
        return tint * core * (0.05 + mag*2.4) * tw * bright;
      }
      void main(){
        vec3 d = normalize(vDir);
        float el = d.y;
        float az = atan(d.x, -d.z);
        float e = max(el, 0.0);
        vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.28, e));
        col = mix(col, uZen, smoothstep(0.2, 0.95, e));
        // twilight glow, low on one side
        float gaz = cos(az - uGlowAz);
        col += uGlowC * exp(-e*7.0) * (0.35 + 0.65*max(gaz,0.0)) * (1.0 + uLit*0.35);
        // milky way
        float mw = dot(d, uMW);
        float band = exp(-mw*mw/0.035);
        vec2 mwp = vec2(atan(d.x, d.z)*3.0, mw*14.0);
        float dust = fbm(mwp*1.3 + 3.0);
        float lanes = smoothstep(0.35, 0.7, fbm(mwp*2.6 + 11.0));
        float mwI = band * (0.4 + dust*0.9) * (1.0 - lanes*0.65) * smoothstep(0.02, 0.3, e);
        col += vec3(0.05, 0.065, 0.11) * mwI * (0.35 + uLit*0.45);
        // stars
        float sk = smoothstep(0.0, 0.12, e) * uStars * (1.0 + uLit*0.6);
        vec3 st = starLayer(d, 26.0, 0.5, 1.0) + starLayer(d, 58.0, 0.3, 0.5) + starLayer(d, 120.0, 0.04 + band*0.45, 0.28 + band*0.25);
        col += st * sk;
        // moon
        vec3 md = normalize(uMoonDir);
        float mang = acos(clamp(dot(d, md), -1., 1.));
        float m = mang / uMoonSize;
        vec3 mt = uMoonTint * uMoonBright;
        col += mt * (exp(-mang*mang/0.0016)*0.04 + exp(-mang*mang/0.03)*0.018) * (0.3 + uMoonPhase*0.7);
        if (m < 1.0) {
          vec3 right = normalize(cross(md, vec3(0,1,0)));
          vec3 up = cross(right, md);
          vec2 q = vec2(dot(d - md, right), dot(d - md, up)) / uMoonSize;
          q = mat2(cos(uMoonTilt), -sin(uMoonTilt), sin(uMoonTilt), cos(uMoonTilt)) * q;
          vec3 n = vec3(q, sqrt(max(1.0 - dot(q,q), 0.0)));
          float ph = (1.0 - uMoonPhase) * 3.14159;
          vec3 sun = vec3(sin(ph), 0.0, cos(ph));
          float lit = smoothstep(-0.06, 0.12, dot(n, sun));
          float maria = fbm(q*2.3 + 5.0);
          float crater = smoothstep(0.55, 0.75, vnoise(q*9.0 + 2.0)) * 0.25;
          float alb = 0.75 - smoothstep(0.45, 0.7, maria)*0.32 - crater;
          float limb = 0.75 + 0.25*n.z;
          vec3 mc = mt * alb * limb * (lit * 2.6 + 0.02);
          float edge = smoothstep(1.0, 0.94, m);
          col = mix(col, mc + col*0.2, edge);
        }
        // distant hills
        float hill = 0.022 + 0.018*fbm(vec2(az*1.6, 1.0)) + 0.008*vnoise(vec2(az*9.0, 4.0));
        if (el < hill) {
          vec3 hc = mix(uHills, uHor, 0.35 + 0.4*smoothstep(hill-0.03, hill, el));
          col = hc;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// The far tree line, all voxels.
export function makeTrees(world: World, L: LightUniforms) {
  const r = world.rand;
  const S = world.season;
  type V = { x: number; y: number; z: number; s: number; level: number; part: number };
  const all: { x: number; y: number; z: number; s: number; sway: number; shade: number }[] = [];
  const addTree = (bx: number, by: number, bz: number, kind: number, size: number) => {
    const v = 0.42 * size;
    const cells = new Set<string>();
    const add = (i: number, j: number, k: number) => cells.add(`${i},${j},${k}`);
    const trunkH = kind === 1 ? 1 : 2 + Math.floor(r() * 2);
    for (let j = 0; j < trunkH; j++) add(0, j, 0);
    if (kind === 0) {
      // round broadleaf: a couple of overlapping blobs
      const blobs = 3 + Math.floor(r() * 4);
      for (let b = 0; b < blobs; b++) {
        const cx = (r() - 0.5) * 5, cy = trunkH + 3 + r() * 4, cz = (r() - 0.5) * 3;
        const rx = 2.5 + r() * 2.5, ry = 2.2 + r() * 1.6;
        for (let i = -6; i <= 6; i++) for (let j = -5; j <= 5; j++) for (let k = -6; k <= 6; k++) {
          const q = (i * i) / (rx * rx) + (j * j) / (ry * ry) + (k * k) / (rx * rx);
          if (q < 1 && q > 0.45 && r() > 0.12) add(Math.round(cx + i), Math.round(cy + j), Math.round(cz + k));
        }
      }
    } else if (kind === 1) {
      // conifer
      const h = 10 + Math.floor(r() * 7);
      for (let j = 0; j < h; j++) {
        const rad = (1 - j / h) * (3 + r() * 0.5) + ((j % 3) === 0 ? 0.7 : 0);
        for (let i = -4; i <= 4; i++) for (let k = -4; k <= 4; k++) {
          const q = Math.hypot(i, k);
          if (q <= rad && q > rad - 1.6) add(i, j + 1, k);
        }
      }
    } else {
      // poplar
      const h = 9 + Math.floor(r() * 5);
      for (let j = 0; j < h; j++) {
        const rad = Math.sin(((j + 0.5) / h) * Math.PI) * 2 + 0.3;
        for (let i = -3; i <= 3; i++) for (let k = -3; k <= 3; k++) if (Math.hypot(i, k) <= rad) add(i, j + trunkH, k);
      }
    }
    for (const c of cells) {
      const [i, j, k] = c.split(',').map(Number);
      all.push({ x: bx + i * v, y: by + j * v + v * 0.5, z: bz + k * v, s: v, sway: j * v, shade: r() });
    }
  };
  const ground = (az: number) => Math.sin(az * 3.1 + 1) * 0.6 + Math.sin(az * 7.3) * 0.25;
  let az = -1.45;
  while (az < 1.45) {
    const clump = r() < 0.75;
    const d = 70 + r() * 22;
    if (clump) {
      const kind = r() < 0.55 ? 0 : r() < 0.6 ? 1 : 2;
      addTree(Math.sin(az) * d, ground(az) - 0.5, -Math.cos(az) * d, kind, 0.85 + r() * 0.5);
    }
    az += 0.035 + r() * 0.07;
  }
  // a few lone hawthorns / oaks in the middle distance
  for (let i = 0; i < 4; i++) {
    const a = (r() - 0.5) * 2.2, d = 32 + r() * 16;
    addTree(Math.sin(a) * d, -0.3, -Math.cos(a) * d, 0, 0.45 + r() * 0.25);
  }
  const geo = voxGeometry([{ x: 0, y: 0, z: 0, s: 1, level: 0, part: 0 }] as V[]);
  const n = all.length;
  const A = new Float32Array(n * 4), B = new Float32Array(n * 2);
  all.forEach((t, i) => { A.set([t.x, t.y, t.z, t.s], i * 4); B.set([t.sway, t.shade], i * 2); });
  geo.setAttribute('iP', new THREE.InstancedBufferAttribute(A, 4));
  geo.setAttribute('iS', new THREE.InstancedBufferAttribute(B, 2));
  geo.instanceCount = n;
  const uniforms = { ...L, uTree: { value: new THREE.Color(...S.trees) }, uWind: { value: new THREE.Vector2(Math.cos(world.wind.angle), Math.sin(world.wind.angle)).multiplyScalar(world.wind.strength) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 iP; attribute vec2 iS;
      uniform vec3 uTree; uniform vec2 uWind;
      varying vec3 vCol;
      ${NOISE}
      ${LIGHT_HEAD}
      void main(){
        vec3 c = iP.xyz;
        float sw = iS.x * 0.012 * (sin(uTime*0.7 + c.x*0.05) + 0.5*sin(uTime*1.9 + c.z*0.1));
        c.xz += uWind * sw * 3.0;
        vec3 n = normal; vec3 corner = position * iP.w;
        if (c.x < 0.0) { corner.x = -corner.x; n.x = -n.x; }
        vec3 p = c + corner;
        vec3 alb = uTree * (0.7 + iS.y*0.6);
        vec3 lit = uSkyAmb * (0.5 + 0.5*n.y) + uMoonCol * max(dot(n, uMoonDir), 0.0) * 1.4;
        vec3 col = alb * lit * 6.0 + lightMap(p);
        vec3 fc = applyFog(col, p);
        vCol = mix(fc, uFogCol*0.55, 0.25);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol,1.); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function makeGround(world: World, L: LightUniforms) {
  const S = world.season;
  const geo = new THREE.PlaneGeometry(500, 500, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...L, uGround: { value: new THREE.Color(...S.ground) } },
    vertexShader: `varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGround; varying vec3 vP;
      ${NOISE}
      ${LIGHT_HEAD}
      void main(){
        vec3 n = vec3(0,1,0);
        float v = vnoise(floor(vP.xz*6.0)*0.37) * 0.5 + vnoise(vP.xz*0.4)*0.5;
        vec3 alb = uGround * (0.7 + v*0.6);
        vec3 lit = uSkyAmb*1.2 + uMoonCol * max(uMoonDir.y, 0.0) * 0.8 + lanternLight(vP, n, 0.3) * 0.6 + lightMap(vP) * 0.7;
        gl_FragColor = vec4(applyFog(alb * lit * 2.0, vP), 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}
