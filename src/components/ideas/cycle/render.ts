// The compositor: builds this frame's palettes (lighting + rotating ranges)
// and pushes the indexed buffers through them.

import {
  type World, MATS, NB, BUCKET_N, SKY0, NSKY, WF0, NWF, FOAM0, NFOAM, ST0, NST, FLOWER0, NFLOWER, WATER,
  STAR_CLS, CL_N, CL_L,
} from './world';
import { type Light, type RGB, hex, lin, toSrgb, mix, mixOk } from './light';
import { bayer, clamp, hash2 } from './noise';

export interface Ripple { x: number; y: number; t0: number; amp: number }
export interface Frame {
  t: number; // cycle clock, seconds
  L: Light;
  panX: number;
  ripples: Ripple[];
  hover: string | null;
  reveal: number; // 0..1 extra brightness for the name lights
  balloon: { x: number; y: number } | null;
  meteors: Meteor[];
}
export interface Meteor { x: number; y: number; vx: number; vy: number; t0: number; life: number }

const ALB = MATS.map((m) => lin(hex(m.albedo)));
const WATER_ALB = lin(hex('#e4f2fb'));
const FLOWERS = ['#f2d25a', '#ee8cae', '#f6f4ee'].map((h) => lin(hex(h)));
// prettier-ignore
const WFPAT = [1.06, 0.96, 0.74, 0.52, 0.38, 0.5, 0.72, 0.92, 1.02, 0.8, 0.56, 0.4, 0.32, 0.48, 0.7, 0.9];
const FOAMPAT = [1, 0.78, 0.96, 0.66, 0.9, 0.72, 1, 0.84];
// prettier-ignore
const STPAT = [1, 0.85, 0.62, 0.48, 0.55, 0.75, 0.95, 0.8, 0.58, 0.5, 0.64, 0.86];
const WOB = [0, 0, 1, 1, 1, 0.5, 0, -0.5, -1, -1, -1, -0.5, 0, 0.5, 1, 0.5];
const STAR_A = [0.32, 0.62, 0.95, 1.0, 0.36, 0.12];
const STAR_TW = [0.55, 0.45, 0.3, 0.22, 0.7, 0];

const soft = (c: number) => (c < 0.82 ? c : 0.82 + 0.18 * (1 - Math.exp(-(c - 0.82) / 0.18)));
const enc = (c: number) => Math.round(toSrgb(clamp(soft(c))) * 255);

export class Renderer {
  w: World; W = 0;
  img!: ImageData; out!: Uint32Array;
  pr = new Float32Array(256); pg = new Float32Array(256); pb = new Float32Array(256);
  cloudOn: Uint8Array;
  starA = new Float32Array(1 + 6 * STAR_CLS);
  starC = new Uint8Array(1 + 6 * STAR_CLS);
  lightA = new Float32Array(1 + 4 * 32);
  rainA = new Float32Array(1 + 2 * 64);
  snowA = new Float32Array(1 + 2 * 64);
  mist = new Float32Array(128);

  constructor(w: World, public ctx: CanvasRenderingContext2D, W: number) {
    this.w = w;
    this.cloudOn = new Uint8Array(1 + w.bands.length * 3 * CL_L * CL_N);
    for (let i = 0; i < 128; i++) {
      this.mist[i] = 0.5 + 0.28 * Math.sin((i / 128) * Math.PI * 2 * 2 + 1) + 0.22 * Math.sin((i / 128) * Math.PI * 2 * 5 + 2);
    }
    this.resize(W);
  }

  resize(W: number) {
    this.W = W;
    this.img = this.ctx.createImageData(W, this.w.H);
    this.out = new Uint32Array(this.img.data.buffer);
  }

  sunPos(a: number) {
    const { WW, HZ } = this.w;
    return { x: WW / 2 - Math.cos(a) * WW * 0.42, y: HZ + 6 - Math.sin(a) * HZ * 0.86 };
  }

  palette(f: Frame) {
    const { L, t } = f;
    const { pr, pg, pb } = this;
    const key = lin(L.key), amb = lin(L.amb), haze = lin(L.haze);
    const [lx, ly, lz] = L.L;
    const hk = L.hazeK * 0.55;
    const set = (i: number, c: RGB) => { pr[i] = enc(c[0]); pg[i] = enc(c[1]); pb[i] = enc(c[2]); };
    const shade = (alb: RGB, n: [number, number, number], depth: number, wrap = 0.12): RGB => {
      const ndl = Math.max(0, (n[0] * lx + n[1] * ly + n[2] * lz + wrap) / (1 + wrap));
      const af = (0.5 + 0.5 * n[1]) * L.ambI;
      const kf = ndl * L.keyI;
      const c: RGB = [alb[0] * (amb[0] * af + key[0] * kf), alb[1] * (amb[1] * af + key[1] * kf), alb[2] * (amb[2] * af + key[2] * kf)];
      const h = 1 - Math.exp(-depth * hk);
      return mix(c, haze, h);
    };
    // sky
    for (let j = 0; j < NSKY; j++) {
      const u = j / (NSKY - 1);
      const c = u < 0.58 ? mixOk(L.zen, L.mid, Math.pow(u / 0.58, 1.15)) : mixOk(L.mid, L.hor, Math.pow((u - 0.58) / 0.42, 1.5));
      pr[SKY0 + j] = Math.round(c[0] * 255); pg[SKY0 + j] = Math.round(c[1] * 255); pb[SKY0 + j] = Math.round(c[2] * 255);
    }
    // lit materials
    const flat: [number, number, number] = [0, 0.9, 0.44];
    MATS.forEach((m, mi) => {
      if (m.ramp) {
        // tonal ramp: shadows lose the key light faster than the sky light, so they cool
        const nf = flat;
        const ndl = Math.max(0, (nf[0] * lx + nf[1] * ly + nf[2] * lz + 0.3) / 1.3);
        for (let b = 0; b < NB; b++) {
          const l = b / (NB - 1);
          const af = (0.42 + 0.62 * l) * L.ambI * 0.95, kf = ndl * L.keyI * Math.pow(l, 1.5) * 1.05;
          const a = ALB[mi];
          const c: RGB = [a[0] * (amb[0] * af + key[0] * kf), a[1] * (amb[1] * af + key[1] * kf), a[2] * (amb[2] * af + key[2] * kf)];
          set(m.base + b, mix(c, haze, 1 - Math.exp(-m.depth * hk)));
        }
      } else for (let b = 0; b < NB; b++) set(m.base + b, shade(ALB[mi], BUCKET_N[b], m.depth));
    });
    // rotating water ranges
    const waterLit = shade(WATER_ALB, [0, 0.55, 0.83], 0.5, 0.6);
    const deep = mix(lin(L.water), waterLit, 0.35);
    const wfStep = Math.floor(t * 18), foamStep = Math.floor(t * 7), stStep = Math.floor(t * 11);
    for (let j = 0; j < NWF; j++) set(WF0 + j, mix(deep, waterLit, WFPAT[(j + wfStep) % NWF]));
    for (let j = 0; j < NFOAM; j++) set(FOAM0 + j, mix(deep, [waterLit[0] * 1.08, waterLit[1] * 1.08, waterLit[2] * 1.08], FOAMPAT[(j + foamStep) % NFOAM]));
    for (let j = 0; j < NST; j++) set(ST0 + j, mix(deep, waterLit, STPAT[(j + stStep) % NST] * 0.9));
    for (let j = 0; j < NFLOWER; j++) set(FLOWER0 + j, shade(FLOWERS[j], [0, 0.8, 0.6], 0.05));
    set(WATER, lin(L.water));

    // clouds: a travelling wave against a fixed threshold field
    const { cloudF, bands } = this.w;
    const on = this.cloudOn;
    const over = L.rain * 0.3 + L.snow * 0.22 + L.fog * 0.1;
    for (let b = 0; b < bands.length; b++) {
      const shift = Math.floor(t * bands[b].speed);
      for (let s = 0; s < 3; s++) for (let l = 0; l < CL_L; l++) {
        const thr = (l + 0.5) / CL_L;
        const base = 1 + ((b * 3 + s) * CL_L + l) * CL_N;
        for (let p = 0; p < CL_N; p++) {
          const v = cloudF[b * CL_N + ((p - shift) & (CL_N - 1))] - thr + over;
          on[base + p] = v > 0 ? (v < 0.07 && s === 1 ? 4 : s + 1) : 0;
        }
      }
    }
    // stars twinkle by rotating their phase
    const sa = this.starA, sc = this.starC;
    for (let c = 0; c < 6; c++) for (let p = 0; p < STAR_CLS; p++) {
      const tw = 0.5 + 0.5 * Math.sin((p / STAR_CLS) * Math.PI * 2 + t * (0.9 + (p % 5) * 0.35));
      sa[1 + c * STAR_CLS + p] = STAR_A[c] * (1 - STAR_TW[c] * tw) * L.stars;
      sc[1 + c * STAR_CLS + p] = p % 4;
    }
    // lights flicker
    for (let kind = 0; kind < 4; kind++) for (let p = 0; p < 32; p++) {
      const fl = 0.86 + 0.14 * Math.sin(t * (1.3 + p * 0.21) + p) - (Math.sin(t * 0.37 + p * 7.1) > 0.985 ? 0.4 : 0);
      // lights come on one by one as the evening deepens
      const on = clamp((L.lights - (p / 32) * 0.75) * 5);
      let a = on * fl * (kind === 2 ? 0.75 : 1);
      if (kind === 0) a = Math.max(a, f.reveal * 0.9);
      if (kind === 3) a = Math.max(clamp((L.lights - 0.75) * 4), f.reveal) * 0.22;
      this.lightA[1 + kind * 32 + p] = clamp(a);
    }
    // rain & snow streaks
    const rs = [Math.floor(t * 110), Math.floor(t * 150)];
    for (let l = 0; l < 2; l++) for (let p = 0; p < 48; p++) {
      const q = (((p - rs[l]) % 48) + 48) % 48;
      const len = l ? 5 : 3;
      this.rainA[1 + l * 64 + p] = q < len ? (1 - q / len) * (l ? 0.55 : 0.32) * L.rain : 0;
    }
    const ss = [Math.floor(t * 14), Math.floor(t * 26)];
    for (let l = 0; l < 2; l++) for (let p = 0; p < 40; p++) {
      const q = (((p - ss[l]) % 40) + 40) % 40;
      this.snowA[1 + l * 64 + p] = q === 0 ? (l ? 0.95 : 0.6) * L.snow : 0;
    }
  }

  frame(f: Frame) {
    this.palette(f);
    const w = this.w, { WW, H, HZ, scene, star, cloud, light, rain, snow } = w;
    const W = this.W, out = this.out, panX = Math.round(f.panX);
    const { pr, pg, pb, cloudOn, starA, starC, lightA, rainA, snowA } = this;
    const L = f.L, t = f.t;
    const k = H / 270;

    const useSun = L.sunUp > 0.02 || L.moonUp < 0.02;
    const cel = this.sunPos(useSun ? L.sunA : L.moonA);
    const sun = this.sunPos(L.sunA), moon = this.sunPos(L.moonA);
    const sunR = 5.2 * k, moonR = 4.6 * k;
    const low = useSun ? clamp(1 - Math.sin(Math.max(0, Math.min(Math.PI, L.sunA))) * 2.2) : 0;
    const gR = (useSun ? 44 + 70 * low : 30) * k, gR2 = gR * gR, gFlat = 1.15 + low * 0.9;
    const mistC = mix(L.haze, L.hor, 0.5).map((v) => v * 255);
    const mistK = 0.42 + L.fog * 0.5, mistH = 30 * k;
    const LM = [0, 0.9, 0.62, 0.3, 0, 0];
    const layer = w.layer;
    const glow = L.glow, gI = L.glowI;
    const gr = glow[0] * 255, gg = glow[1] * 255, gb = glow[2] * 255;
    const sunC = mixOk(hex('#fffbea'), L.key, 0.35);
    const moonLit = [232, 236, 246], moonDark = [L.zen[0] * 255 + 14, L.zen[1] * 255 + 16, L.zen[2] * 255 + 26];
    const cHi = L.cHi.map((v) => v * 255), cMid = L.cMid.map((v) => v * 255), cLo = L.cLo.map((v) => v * 255);
    const cEdge = mix(L.cMid, L.cHi, 0.6).map((v) => v * 255);
    const cl = [cHi, cMid, cLo, cEdge];
    const STARCOL = [[255, 236, 210], [208, 224, 255], [255, 255, 255], [236, 240, 255]];
    const lightCol = [[255, 212, 126], [255, 188, 100], [255, 168, 88], [255, 150, 70]];
    const rainC = [L.hor[0] * 200 + 50, L.hor[1] * 200 + 55, L.hor[2] * 200 + 60];
    const lakeH = H - HZ;
    const wobStep = Math.floor(t * 5);
    const waterC = [L.water[0] * 255, L.water[1] * 255, L.water[2] * 255];
    const rip = f.ripples;
    const fog = L.fog, mist = this.mist, mistShift = Math.floor(t * 4);
    const pm = w.moonPhase, pmc = Math.cos(pm * Math.PI * 2);
    const sunVis = L.sunUp, moonVis = L.moonUp;
    const wantRain = L.rain > 0.01, wantSnow = L.snow > 0.01;

    for (let y = 0; y < H; y++) {
      const row = y * WW;
      const d = y - HZ;
      const sy = HZ - 1 - d;
      const wamp = d < 2 ? 0 : Math.min(2.6, (d / lakeH) * 3.2 * (1 + L.rain * 0.8));
      const wv = WOB[(w.wob[y] + wobStep) & 15] * wamp;
      const mistRow = fog > 0 ? fog * Math.max(0, 1 - Math.abs(y - HZ - 2 * k) / (26 * k)) * 0.6 : 0;
      const mistOff = Math.round(Math.sin(y * 0.45) * 9 + Math.sin(y * 0.11 + 2) * 23);
      for (let x = 0; x < W; x++) {
        const wx = x + panX, i = row + wx;
        const idx = scene[i];
        let r: number, g: number, b: number;
        if (idx === WATER) {
          let ox = wv, oy = 0, lit = 0;
          for (let q = 0; q < rip.length; q++) {
            const R0 = rip[q];
            const age = t - R0.t0;
            if (age < 0 || age > 3.2) continue;
            const ex = wx - R0.x, ey = (y - R0.y) / (0.26 + 0.22 * (d / lakeH));
            const e = Math.sqrt(ex * ex + ey * ey);
            const fade = (1 - age / 3.2) ** 2 * R0.amp;
            for (let j = 0; j < 3; j++) {
              const Rj = age * 15 * k - j * 5 * k;
              if (Rj <= 0) continue;
              const dist = e - Rj;
              if (dist > -2.5 && dist < 2.5) {
                ox += Math.sin(dist * 1.4) * 1.6 * fade;
                oy += dist < 0 ? -1 : 1;
                if (dist > -0.8 && dist < 0.2) lit += 0.55 * fade * (1 - j * 0.25);
                else if (dist > 0.6 && dist < 1.4) lit -= 0.35 * fade * (1 - j * 0.25);
              }
            }
          }
          let sx = x + Math.round(ox), syy = sy + (oy > 0 ? 1 : oy < 0 ? -1 : 0);
          if (sx < 0) sx = 0; else if (sx >= W) sx = W - 1;
          if (syy < 0) syy = 0; else if (syy >= HZ) syy = HZ - 1;
          const s = out[syy * W + sx];
          const ff = 0.16 + 0.42 * (d / lakeH);
          r = ((s & 255) * (1 - ff) + waterC[0] * ff) * 0.92;
          g = (((s >> 8) & 255) * (1 - ff) + waterC[1] * ff) * 0.93;
          b = (((s >> 16) & 255) * (1 - ff) + waterC[2] * ff) * 0.96;
          if (lit > 0) { r += (255 - r) * lit * 0.6; g += (255 - g) * lit * 0.6; b += (255 - b) * lit * 0.6; }
          else if (lit < 0) { r *= 1 + lit; g *= 1 + lit; b *= 1 + lit * 0.7; }
        } else if (idx >= SKY0 && idx < SKY0 + NSKY) {
          r = pr[idx]; g = pg[idx]; b = pb[idx];
          // dithered glow rings
          const dx = wx - cel.x, dy = (y - cel.y) * gFlat, d2 = dx * dx + dy * dy;
          let gq = 0;
          if (gI > 0.01 && d2 < gR2) {
            const fq = (1 - Math.sqrt(d2) / gR) ** 2 * gI;
            gq = Math.floor(fq * 7 + bayer(wx, y) - 0.3) / 7;
            if (gq > 0) { r += (gr - r) * gq * 0.8; g += (gg - g) * gq * 0.8; b += (gb - b) * gq * 0.8; }
          }
          const sv = star[i];
          if (sv) {
            const a = starA[sv];
            if (a > 0.01) { const c = STARCOL[starC[sv]]; r += (c[0] - r) * a; g += (c[1] - g) * a; b += (c[2] - b) * a; }
          }
          // sun disc
          if (sunVis > 0.01) {
            const ux = wx - sun.x, uy = y - sun.y, u2 = ux * ux + uy * uy;
            if (u2 < sunR * sunR) {
              const e = Math.sqrt(u2) / sunR;
              const a = sunVis * (e > 0.8 ? 0.75 : 1) * (1 - Math.max(L.rain, L.snow) * 0.75);
              r += (sunC[0] * 255 - r) * a; g += (sunC[1] * 255 - g) * a; b += (sunC[2] * 255 - b) * a;
            }
          }
          if (moonVis > 0.01) {
            const ux = (wx - moon.x) / moonR, uy = (y - moon.y) / moonR, u2 = ux * ux + uy * uy;
            if (u2 < 1) {
              const lw = Math.sqrt(1 - uy * uy);
              const tq = (bayer(wx, y) - 0.5) * 0.25;
              const litp = pm < 0.5 ? ux + tq > lw * pmc : ux + tq < -lw * pmc;
              let c = litp ? moonLit : moonDark;
              let a = moonVis * (litp ? 1 : 0.85);
              let mr = c[0], mg = c[1], mb = c[2];
              if (litp && hash2(Math.floor(ux * 3.2 + 9), Math.floor(uy * 3.2 + 9), 5) < 0.3 && u2 < 0.7) { mr -= 30; mg -= 28; mb -= 18; }
              if (litp && u2 > 0.72) { mr -= 14; mg -= 12; mb -= 6; }
              r += (mr - r) * a; g += (mg - g) * a; b += (mb - b) * a;
            }
          }
          const cv = cloud[i];
          if (cv) {
            const on = cloudOn[cv];
            if (on) {
              const c = cl[on - 1];
              let cr = c[0], cg = c[1], cb = c[2];
              if (gq > 0) { const rim = gq * 1.6; cr += (gr - cr) * Math.min(1, rim) * 0.7; cg += (gg - cg) * Math.min(1, rim) * 0.7; cb += (gb - cb) * Math.min(1, rim) * 0.7; }
              r = cr; g = cg; b = cb;
            }
          }
        } else {
          r = pr[idx]; g = pg[idx]; b = pb[idx];
          if (y < HZ && y > HZ - mistH) {
            const lm = LM[layer[i]];
            if (lm > 0) {
              const u = 1 - (HZ - y) / mistH;
              const m = Math.floor(u * u * lm * mistK * 6 + bayer(wx, y) - 0.5) / 6;
              if (m > 0) { r += (mistC[0] - r) * m; g += (mistC[1] - g) * m; b += (mistC[2] - b) * m; }
            }
          }
        }
        const lv = light[i];
        if (lv) {
          const a = lightA[lv];
          if (a > 0.01) { const c = lightCol[((lv - 1) >> 5)]; r += (c[0] - r) * a; g += (c[1] - g) * a; b += (c[2] - b) * a; }
        }
        if (mistRow > 0) {
          const m = Math.floor(mistRow * mist[(wx + mistOff - mistShift) & 127] * 5 + bayer(wx, y) - 0.5) / 5;
          if (m > 0) { r += (rainC[0] - r) * m; g += (rainC[1] - g) * m; b += (rainC[2] - b) * m; }
        }
        if (wantRain) {
          const rv = rain[i];
          if (rv) { const a = rainA[rv]; if (a > 0) { r += (rainC[0] - r) * a; g += (rainC[1] - g) * a; b += (rainC[2] - b) * a; } }
        }
        if (wantSnow) {
          const sv = snow[i];
          if (sv) { const a = snowA[sv]; if (a > 0) { r += (250 - r) * a; g += (252 - g) * a; b += (255 - b) * a; } }
        }
        out[y * W + x] = 0xff000000 | (clamp8(b) << 16) | (clamp8(g) << 8) | clamp8(r);
      }
    }

    this.glints(f, cel, panX);
    if (wantRain) this.splashes(f, panX);
    if (f.hover && f.hover.startsWith('star')) this.constellation(f, panX);
    if (f.meteors.length) this.meteors(f, panX);
    if (f.balloon) this.balloon(f, panX);
    this.ctx.putImageData(this.img, 0, 0);
  }

  glints(f: Frame, cel: { x: number; y: number }, panX: number) {
    const { glints, H, HZ, WW } = this.w;
    const L = f.L, W = this.W, out = this.out;
    const step = Math.floor(f.t * 9);
    const lakeH = H - HZ;
    const vis = Math.max(L.sunUp * (0.7 + 0.3 * (1 - Math.sin(Math.max(0, L.sunA)))), L.moonUp * 0.85) * (1 - L.rain * 0.7) * (1 - L.fog * 0.5);
    const gc = mix(L.glow, [1, 1, 1], 0.45);
    const base = L.sunUp * 0.12 * (1 - L.rain);
    for (let q = 0; q < glints.length; q += 4) {
      const gx = glints[q], gy = glints[q + 1], len = glints[q + 2], ph = glints[q + 3];
      const pp = (ph + step) & 31;
      if (pp > 11) continue;
      const u = (gy - HZ) / lakeH;
      const spread = (5 + 26 * u) * (H / 270);
      const dx = (gx - cel.x) / spread;
      const a = (Math.exp(-dx * dx) * vis + base) * (pp < 4 ? 1 : pp < 8 ? 0.6 : 0.3);
      if (a < 0.04) continue;
      const sx = gx - panX;
      if (sx < -len || sx >= W || gx >= WW) continue;
      for (let j = 0; j < len; j++) {
        const x = sx + j;
        if (x < 0 || x >= W) continue;
        if (this.w.scene[gy * WW + gx + j] !== WATER) continue;
        const o = gy * W + x, s = out[o];
        const aa = Math.min(1, a * (j === 0 || j === len - 1 ? 0.6 : 1));
        const r = (s & 255) + (gc[0] * 255 - (s & 255)) * aa;
        const g = ((s >> 8) & 255) + (gc[1] * 255 - ((s >> 8) & 255)) * aa;
        const b = ((s >> 16) & 255) + (gc[2] * 255 - ((s >> 16) & 255)) * aa;
        out[o] = 0xff000000 | (clamp8(b) << 16) | (clamp8(g) << 8) | clamp8(r);
      }
    }
  }

  splashes(f: Frame, panX: number) {
    const { splashes, WW, scene } = this.w;
    const W = this.W, out = this.out, step = Math.floor(f.t * 30), a0 = f.L.rain;
    const px = (x: number, y: number, a: number) => {
      if (x < 0 || x >= W || scene[y * WW + x + panX] !== WATER) return;
      const o = y * W + x, s = out[o];
      const r = (s & 255) + (235 - (s & 255)) * a, g = ((s >> 8) & 255) + (240 - ((s >> 8) & 255)) * a, b = ((s >> 16) & 255) + (250 - ((s >> 16) & 255)) * a;
      out[o] = 0xff000000 | (clamp8(b) << 16) | (clamp8(g) << 8) | clamp8(r);
    };
    for (let q = 0; q < splashes.length; q += 3) {
      const p = (splashes[q + 2] + step) % 40;
      if (p > 3) continue;
      const x = splashes[q] - panX, y = splashes[q + 1];
      if (p === 0) px(x, y, 0.6 * a0);
      else { px(x - p, y, 0.35 * a0 / p); px(x + p, y, 0.35 * a0 / p); }
    }
  }

  constellation(f: Frame, panX: number) {
    const h = this.w.hot.find((h) => h.id === f.hover);
    if (!h || !h.pts || !h.lines) return;
    const { WW, scene } = this.w, W = this.W, out = this.out;
    const a = 0.28 + 0.3 * f.L.stars;
    const plot = (x: number, y: number) => {
      const sx = x - panX;
      if (sx < 0 || sx >= W) return;
      const v = scene[y * WW + x];
      if (v < SKY0 || v >= SKY0 + NSKY) return;
      const o = y * W + sx, s = out[o];
      const r = (s & 255) + (190 - (s & 255)) * a, g = ((s >> 8) & 255) + (210 - ((s >> 8) & 255)) * a, b = ((s >> 16) & 255) + (255 - ((s >> 16) & 255)) * a;
      out[o] = 0xff000000 | (clamp8(b) << 16) | (clamp8(g) << 8) | clamp8(r);
    };
    for (const [ia, ib] of h.lines) {
      const [x0, y0] = h.pts[ia], [x1, y1] = h.pts[ib];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 2; s <= n - 2; s++) {
        if (s % 2) continue;
        plot(Math.round(x0 + ((x1 - x0) * s) / n), Math.round(y0 + ((y1 - y0) * s) / n));
      }
    }
    // brighten the member stars
    for (const [x, y] of h.pts) {
      const sx = x - panX;
      if (sx >= 0 && sx < W) out[y * W + sx] = 0xffffffff;
    }
  }

  meteors(f: Frame, panX: number) {
    const { WW, HZ, scene } = this.w, W = this.W, out = this.out;
    for (const m of f.meteors) {
      const age = f.t - m.t0;
      if (age < 0 || age > m.life) continue;
      const fade = Math.sin((age / m.life) * Math.PI);
      const hx = m.x + m.vx * age, hy = m.y + m.vy * age;
      const sp = Math.hypot(m.vx, m.vy), ux = m.vx / sp, uy = m.vy / sp;
      const len = 14 * (this.w.H / 270);
      for (let j = 0; j < len; j++) {
        const x = Math.round(hx - ux * j), y = Math.round(hy - uy * j);
        const sx = x - panX;
        if (sx < 0 || sx >= W || y < 0 || y >= HZ || x < 0 || x >= WW) continue;
        const v = scene[y * WW + x];
        if (v < SKY0 || v >= SKY0 + NSKY) continue;
        const a = fade * Math.pow(1 - j / len, 1.6) * (j === 0 ? 1 : 0.8);
        const o = y * W + sx, s = out[o];
        const r = (s & 255) + (255 - (s & 255)) * a, g = ((s >> 8) & 255) + (246 - ((s >> 8) & 255)) * a, b = ((s >> 16) & 255) + (230 - ((s >> 16) & 255)) * a;
        out[o] = 0xff000000 | (clamp8(b) << 16) | (clamp8(g) << 8) | clamp8(r);
      }
    }
  }

  balloon(f: Frame, panX: number) {
    const b = f.balloon!;
    const { H } = this.w, W = this.W, out = this.out, L = f.L;
    const k = H / 270;
    const R = Math.max(2.5, 3.2 * k);
    const cx = Math.round(b.x - panX), cy = Math.round(b.y);
    const key = lin(L.key), amb = lin(L.amb);
    const [lx, ly] = L.L;
    const put = (x: number, y: number, c: RGB) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      out[y * W + x] = 0xff000000 | (enc(c[2]) << 16) | (enc(c[1]) << 8) | enc(c[0]);
    };
    const lit = (alb: RGB, nx: number, ny: number): RGB => {
      const ndl = Math.max(0, nx * lx + ny * ly + 0.4 * 0.5);
      const q = Math.round(ndl * 3) / 3;
      return [alb[0] * (amb[0] * L.ambI * 0.8 + key[0] * L.keyI * q), alb[1] * (amb[1] * L.ambI * 0.8 + key[1] * L.keyI * q), alb[2] * (amb[2] * L.ambI * 0.8 + key[2] * L.keyI * q)];
    };
    const white = lin(hex('#f4f2ee')), orange = lin(hex('#ee7040')), foil = lin(hex('#d8d0b8'));
    for (let y = -Math.ceil(R * 1.15); y <= Math.ceil(R); y++) for (let x = -Math.ceil(R); x <= Math.ceil(R); x++) {
      const u = x / R, v = y / (R * 1.12);
      if (u * u + v * v > 1) continue;
      put(cx + x, cy + y, lit(white, u, -v));
    }
    const cord = Math.round(R * 1.2);
    for (let j = 1; j <= cord; j++) put(cx, cy + Math.ceil(R) + j, lit(white, 0, 0.2));
    const py = cy + Math.ceil(R) + cord + 1;
    put(cx - 1, py, lit(orange, -0.6, 0.6)); put(cx, py, lit(orange, 0, 0.9)); put(cx + 1, py, lit(orange, 0.6, 0.6));
    for (let j = 1; j <= 3; j++) put(cx, py + j, lit(white, 0, 0.1));
    put(cx, py + 4, lit(foil, -0.4, 0.6)); put(cx + 1, py + 4, lit(foil, 0.4, 0.6));
    if (L.lights > 0.2 && Math.floor(f.t * 1.5) % 2 === 0) put(cx + 1, py + 5, [1, 0.12, 0.08]);
    else put(cx + 1, py + 5, lit(foil, 0, 0.2));
  }
}

function clamp8(v: number) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
