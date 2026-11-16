// Firefly rendering: instanced glowing voxels, plus a top-down light map that lets them light the grass.
import * as THREE from 'three';
import type { World } from './world';

export function makeFlyMesh(n: number, world: World) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = box.index;
  g.setAttribute('position', box.getAttribute('position'));
  g.setAttribute('normal', box.getAttribute('normal'));
  const pg = new Float32Array(n * 4);
  const rnd = new Float32Array(n * 4);
  const r = world.rand;
  for (let i = 0; i < n; i++) rnd.set([r() * 6.28, r(), r(), r()], i * 4);
  const aPG = new THREE.InstancedBufferAttribute(pg, 4);
  aPG.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aPG', aPG);
  g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
  g.instanceCount = n;
  const [c0, c1] = world.season.firefly;
  const uniforms = {
    uTime: { value: 0 },
    uPx: { value: 0.001 },
    uC0: { value: new THREE.Color(...c0) },
    uC1: { value: new THREE.Color(...c1) },
    uGain: { value: 4.5 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 aPG; attribute vec4 aRnd;
      uniform float uTime, uPx, uGain; uniform vec3 uC0, uC1;
      varying vec3 vCol;
      mat3 rot(float a, float b){ float ca=cos(a), sa=sin(a), cb=cos(b), sb=sin(b);
        return mat3(ca,0.,-sa, 0.,1.,0., sa,0.,ca) * mat3(1.,0.,0., 0.,cb,sb, 0.,-sb,cb); }
      void main(){
        vec3 p = aPG.xyz; float g = aPG.w;
        float dist = length(p - cameraPosition);
        float base = 0.026 + aRnd.y * 0.014;
        float minS = dist * uPx * 1.9;
        float on = smoothstep(0.02, 0.35, g);
        float s = mix(base * 0.05, max(base, minS), on) * smoothstep(0.6, 1.4, dist) * (0.8 + 0.3 * min(g, 1.5));
        float comp = clamp(base / minS, 0.25, 1.0); // far flies get a bit dimmer per pixel but not too much
        vec3 c = rot(aRnd.x + uTime * (0.4 + aRnd.w), aRnd.x * 1.7 + uTime * 0.3) * position;
        vec3 wp = p + c * s;
        float face = 0.8 + 0.2 * normal.y;
        vCol = vec3(0.004, 0.003, 0.002) + mix(uC0, uC1, aRnd.z) * (g * uGain * mix(0.7, 1.0, comp)) * face;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol, 1.); }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  // light map: the same buffer drawn as soft points from above
  const lg = new THREE.BufferGeometry();
  const lpos = new THREE.BufferAttribute(pg, 4);
  lpos.setUsage(THREE.DynamicDrawUsage);
  lg.setAttribute('aPG', lpos);
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  lg.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  const lmat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uRect: { value: new THREE.Vector4() }, uPxPerUnit: { value: 4 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aPG; attribute vec4 aRnd;
      uniform vec4 uRect; uniform float uPxPerUnit; uniform vec3 uC0, uC1;
      varying vec3 vCol;
      void main(){
        vec2 uv = (aPG.xz - uRect.xy) * uRect.zw;
        float hgt = max(aPG.y, 0.0);
        float a = aPG.w * exp(-hgt * 0.9);
        vCol = mix(uC0, uC1, aRnd.z) * a * 0.035;
        gl_PointSize = (0.8 + hgt * 0.6) * 2.0 * uPxPerUnit;
        gl_Position = a < 0.01 ? vec4(2.,2.,2.,1.) : vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main(){ vec2 q = gl_PointCoord*2.-1.; float r2 = dot(q,q); if (r2>1.) discard; gl_FragColor = vec4(vCol * (1.-r2)*(1.-r2), 1.); }`,
  });
  const lpoints = new THREE.Points(lg, lmat);
  lpoints.frustumCulled = false;
  return { mesh, pg, aPG, lpos, uniforms, lpoints, lmat };
}

export class LightMap {
  rt: THREE.WebGLRenderTarget; scene = new THREE.Scene(); cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  rect: THREE.Vector4;
  constructor(x0: number, z0: number, w: number, d: number, res: [number, number], points: THREE.Points, lmat: THREE.ShaderMaterial) {
    this.rt = new THREE.WebGLRenderTarget(res[0], res[1], { type: THREE.HalfFloatType, depthBuffer: false });
    this.rect = new THREE.Vector4(x0, z0, 1 / w, 1 / d);
    lmat.uniforms.uRect.value.copy(this.rect);
    lmat.uniforms.uPxPerUnit.value = res[0] / w;
    this.scene.add(points);
  }
  render(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(null);
  }
}

// Faint guide stars for unlit constellations, and glowing lines once lit.
export function makeGuides(maxStars: number, maxDots: number, maxSegs: number) {
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxStars * 3), 3));
  sg.setAttribute('aInfo', new THREE.BufferAttribute(new Float32Array(maxStars * 3), 3)); // constellation, kind(1 star / 0 dot), rnd
  const uniforms = { uTime: { value: 0 }, uInvite: { value: new Array(16).fill(0) }, uLit: { value: new Array(16).fill(0) }, uDpr: { value: 1 } };
  const smat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aInfo; uniform float uTime; uniform float uInvite[16]; uniform float uLit[16]; uniform float uDpr;
      varying float vA; varying float vStar;
      void main(){
        int ci = int(aInfo.x + 0.5);
        float inv = uInvite[ci]; float lit = uLit[ci];
        float tw = 0.7 + 0.3 * sin(uTime * (1.3 + aInfo.z * 2.0) + aInfo.z * 30.0);
        float star = aInfo.y;
        float breathe = 0.75 + 0.25 * sin(uTime * 0.9 + aInfo.x * 1.7);
        vA = (star > 0.5 ? (0.36 + inv * 0.7) * tw * breathe : (0.08 + inv * 0.16) * breathe) * (1.0 - lit);
        vStar = star;
        gl_PointSize = (star > 0.5 ? 11.0 + inv * 6.0 : 2.5) * uDpr;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vStar;
      void main(){
        vec2 q = gl_PointCoord*2.-1.; float r2 = dot(q,q); if (r2 > 1.) discard;
        float core = vStar > 0.5 ? exp(-r2*40.0) * 1.6 + exp(-r2*9.0) * 0.25 : exp(-r2*3.0);
        float arms = vStar > 0.5 ? (exp(-q.y*q.y*900.0) + exp(-q.x*q.x*900.0)) * (1.0 - sqrt(r2)) * 0.55 : 0.0;
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.72) * vA * (core + arms) * 1.4, 1.);
      }`,
  });
  const stars = new THREE.Points(sg, smat);
  stars.frustumCulled = false;
  stars.renderOrder = 2;

  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxSegs * 6), 3));
  lg.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(maxSegs * 2), 1));
  const lmat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aC; uniform float uLit[16]; uniform float uTime; varying float vA;
      void main(){ int ci = int(aC + 0.5); vA = uLit[ci] * (0.55 + 0.1*sin(uTime*0.8 + aC)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * vA * 0.5, 1.); }`,
  });
  const lines = new THREE.LineSegments(lg, lmat);
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  void maxDots;
  return { stars, lines, uniforms };
}
