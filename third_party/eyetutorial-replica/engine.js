/*!
 * Eye -> Space · 浏览器版渲染引擎
 * 基于 iremcnar/eyeTutorial 的效果复刻：纯 JS、无依赖、无图片素材。
 * 用法：Renderer(cellW, cellH, rows).render(t, dt) -> { idx, q }
 */
(function (global) {
  "use strict";

  const PI = Math.PI;
  const CFG = {
    SS: 2,                 // 每格 2x2 个采样点
    ASPECT: 1.40,          // 画面宽高比
    MAX_ROWS: 30,
    T_OPEN: 0.9, T_OPEN_D: 2.4, T_BLINK: 4.0,
    T_Z0: 5.4, T_ZD: 28.0, ZEND: 14.0,
    T_SPACE: 5.4 + 28.0,
    T_HEART: 5.4 + 3.5,
    T_HEART_D: 26.0,
    WO: 0.78, HU: 0.30, HL: 0.20, RI: 0.27, RP0: 0.098, GS0: 0.085,
    RAMP: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    QL: 24,
  };
  const RAMP = CFG.RAMP, NR = RAMP.length - 1, QL = CFG.QL;
  const CIDX = {};
  for (let i = 0; i < RAMP.length; i++) CIDX[RAMP[i]] = i;   // 后写覆盖，与 Python dict 一致

  // ------------------------------------------------------------ 数学小工具
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function ease(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }
  const mix = (a, b, k) => a + (b - a) * k;
  const f32 = Math.fround;

  // ------------------------------------------------------------ MT19937
  // 与 numpy.RandomState / CPython random 的底层发生器保持一致，这样随机纹理、
  // 星点分布、视线关键帧都几乎与 Python 版逐个数值对得上。
  class MT19937 {
    constructor() {
      this.mt = new Uint32Array(624);
      this.mti = 625;
    }
    initGenrand(seed) {
      const mt = this.mt;
      mt[0] = seed >>> 0;
      for (let i = 1; i < 624; i++) {
        mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
      }
      this.mti = 624;
    }
    initByArray(key) {
      const mt = this.mt;
      this.initGenrand(19650218);
      let i = 1, j = 0;
      let k = Math.max(624, key.length);
      for (; k; k--) {
        mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
        i++; j++;
        if (i >= 624) { mt[0] = mt[623]; i = 1; }
        if (j >= key.length) j = 0;
      }
      for (k = 623; k; k--) {
        mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
        i++;
        if (i >= 624) { mt[0] = mt[623]; i = 1; }
      }
      mt[0] = 0x80000000;
      this.mti = 624;
    }
    int32() {
      const mt = this.mt;
      if (this.mti >= 624) {
        for (let kk = 0; kk < 624; kk++) {
          const y = (mt[kk] & 0x80000000) | (mt[(kk + 1) % 624] & 0x7fffffff);
          mt[kk] = mt[(kk + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        }
        this.mti = 0;
      }
      let y = mt[this.mti++];
      y ^= y >>> 11;
      y ^= (y << 7) & 0x9d2c5680;
      y ^= (y << 15) & 0xefc60000;
      y ^= y >>> 18;
      return y >>> 0;
    }
    random() {
      const a = this.int32() >>> 5, b = this.int32() >>> 6;
      return (a * 67108864.0 + b) / 9007199254740992.0;
    }
  }

  class NumpyRandom {
    constructor(seed) {
      this.mt = new MT19937();
      this.mt.initGenrand(seed >>> 0);
    }
    random() { return this.mt.random(); }
    rand(n) {
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = this.random();
      return out;
    }
    uniform(a, b, n) {
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = a + (b - a) * this.random();
      return out;
    }
  }

  class PyRandom {
    constructor(seed) {                    // CPython random.Random(int)
      this.mt = new MT19937();
      const key = [];
      let n = Math.abs(seed);
      do { key.push(n % 4294967296); n = Math.floor(n / 4294967296); } while (n);
      this.mt.initByArray(key);
    }
    random() { return this.mt.random(); }
    uniform(a, b) { return a + (b - a) * this.random(); }
    randbelow(n) {                          // 与 CPython _randbelow_with_getrandbits 一致
      const k = n.toString(2).length;
      let r;
      do { r = this.mt.int32() >>> (32 - k); } while (r >= n);
      return r;
    }
    choice(arr) { return arr[this.randbelow(arr.length)]; }
  }

  // ------------------------------------------------------------ 程序化贴图
  function upsample(b, g, n) {              // 可平铺的二次平滑插值放大
    const t = new Float32Array(g * n);
    const out = new Float32Array(n * n);
    const frac = new Float32Array(n);
    const i0s = new Int32Array(n), i1s = new Int32Array(n);
    for (let j = 0; j < n; j++) {
      const x = (j * g) / n;
      const i0 = Math.floor(x) % g;
      i0s[j] = i0;
      i1s[j] = (i0 + 1) % g;
      let f = x - Math.floor(x);
      frac[j] = f * f * (3 - 2 * f);
    }
    for (let j = 0; j < n; j++) {
      const f = frac[j], a = i0s[j], c = i1s[j];
      for (let row = 0; row < g; row++) {
        t[row * n + j] = b[row * g + a] * (1 - f) + b[row * g + c] * f;
      }
    }
    for (let j = 0; j < n; j++) {
      const f = frac[j], a = i0s[j], c = i1s[j];
      for (let col = 0; col < n; col++) {
        out[j * n + col] = t[a * n + col] * (1 - f) + t[c * n + col] * f;
      }
    }
    return out;
  }

  function normalize01(arr, k) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    const mean = sum / arr.length;
    let varSum = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / arr.length);
    const out = new Float32Array(arr.length);
    const denom = std * k + 1e-9;
    for (let i = 0; i < arr.length; i++) out[i] = clamp(0.5 + (arr[i] - mean) / denom, 0, 1);
    return out;
  }

  function fractalTex(rng, n, grids) {
    const out = new Float32Array(n * n);
    let amp = 1.0;
    for (const g of grids) {
      const layer = upsample(Float32Array.from(rng.rand(g * g)), g, n);
      for (let i = 0; i < out.length; i++) out[i] = f32(out[i] + amp * layer[i]);
      amp *= 0.55;
    }
    return normalize01(out, 4.0);
  }

  function noise1d(rng, n, g) {
    const base = Float32Array.from(rng.rand(g));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * g) / n;
      const i0 = Math.floor(x) % g;
      const i1 = (i0 + 1) % g;
      let f = x - Math.floor(x);
      f = f * f * (3 - 2 * f);
      out[i] = base[i0] * (1 - f) + base[i1] * f;
    }
    return out;
  }

  function bilinear(tex, n, u, v) {
    const u0 = Math.floor(u), v0 = Math.floor(v);
    const fu = u - u0, fv = v - v0;
    const i0 = ((u0 % n) + n) % n, j0 = ((v0 % n) + n) % n;
    const i1 = (i0 + 1) % n, j1 = (j0 + 1) % n;
    return ((tex[j0 * n + i0] * (1 - fu) + tex[j0 * n + i1] * fu) * (1 - fv)
      + (tex[j1 * n + i0] * (1 - fu) + tex[j1 * n + i1] * fu) * fv);
  }

  // ------------------------------------------------------------ 素材
  const NA = 4096, NS = 3200, NUP = 44, NLO = 20;

  class Textures {
    constructor() {
      const rng = new NumpyRandom(5);
      this.rng = rng;

      this.skin = fractalTex(rng, 1024, [6, 20, 64, 200]);
      this.glow = fractalTex(rng, 1024, [8, 24, 64, 160]);
      this.white = Float32Array.from(rng.rand(512 * 512));

      const tv = fractalTex(rng, 512, [5, 12, 30]);
      this.ring = new Float32Array(tv.length);
      for (let i = 0; i < tv.length; i++) this.ring[i] = 1 - Math.abs(2 * tv[i] - 1);

      const tv2 = fractalTex(rng, 512, [3, 7, 16]);
      this.vein = new Float32Array(tv2.length);
      for (let i = 0; i < tv2.length; i++) this.vein[i] = 1 - Math.abs(2 * tv2[i] - 1);

      const mixNoise = (a, b, c) => {
        const n = NA;
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = a[i] * 0.5 + b[i] * 0.3 + c[i] * 0.2;
        return out;
      };
      this.a1 = normalize01(mixNoise(noise1d(rng, NA, 900), noise1d(rng, NA, 300), noise1d(rng, NA, 120)), 3.0);
      this.a2 = normalize01(mixNoise(noise1d(rng, NA, 700), noise1d(rng, NA, 200), noise1d(rng, NA, 80)), 3.0);
      this.a3 = normalize01(noise1d(rng, NA, 13), 3.0);
      this.a4 = normalize01(noise1d(rng, NA, 48), 3.0);

      // ---- 星场 ----
      this.starX = Float32Array.from(rng.uniform(-1, 1, NS));
      this.starY = Float32Array.from(rng.uniform(-1, 1, NS));
      this.starZ = Float32Array.from(rng.uniform(0.06, 1.0, NS));
      this.starB = new Float32Array(NS);
      const randB = rng.rand(NS);
      for (let i = 0; i < NS; i++) this.starB[i] = 0.10 + 0.90 * Math.pow(randB[i], 3.5);
      this.starCol = new Float32Array(NS * 3);
      const warm = rng.rand(NS);
      for (let i = 0; i < NS; i++) {
        const k = Math.pow(warm[i], 1.5);
        this.starCol[i * 3] = mix(0.70, 1.0, k);
        this.starCol[i * 3 + 1] = mix(0.82, 0.80, k);
        this.starCol[i * 3 + 2] = mix(1.0, 0.55, k);
      }
      this.starPhase = Float32Array.from(rng.uniform(0, 6.28, NS));
      this.starFreq = Float32Array.from(rng.uniform(1.0, 3.5, NS));

      // ---- 视线关键帧 ----
      const gaze = new PyRandom(4);
      this.gazeKeys = [[0.0, 0.0, 0.0]];
      let tc = 1.7;
      while (tc < 40) {
        this.gazeKeys.push([tc, gaze.uniform(-0.045, 0.045), gaze.uniform(-0.022, 0.02)]);
        tc += gaze.uniform(0.9, 2.4);
      }

      // ---- 睫毛 ----
      const lash = new PyRandom(21);
      this.upperLashes = [];
      for (let i = 0; i < NUP; i++) this.upperLashes.push(-0.92 + (1.84 * i) / (NUP - 1));
      this.upperLen = [];
      for (let i = 0; i < NUP; i++) this.upperLen.push(lash.uniform(0.92, 1.08));
      this.lowerLashes = [];
      for (let i = 0; i < NLO; i++) this.lowerLashes.push(-0.70 + (1.40 * i) / (NLO - 1));
      this.lowerLen = [];
      for (let i = 0; i < NLO; i++) this.lowerLen.push(lash.uniform(0.90, 1.10));

      this.streakRnd = new PyRandom(9);
    }
  }

  // ------------------------------------------------------------ 几何网格
  function buildGeometry(rows, cw, ch) {
    const nCols = Math.floor((rows * ch * CFG.ASPECT) / cw / 2) * 2;
    const nRows = Math.floor(rows / 2) * 2;
    const W = nCols * cw, H = nRows * ch;
    const GW = nCols * CFG.SS, GH = nRows * CFG.SS;

    const X = new Float32Array(GH * GW), Y = new Float32Array(GH * GW);
    for (let j = 0; j < GH; j++) {
      const y = ((j + 0.5) * (ch / CFG.SS) - H / 2) / H;
      for (let i = 0; i < GW; i++) {
        const x = ((i + 0.5) * (cw / CFG.SS) - W / 2) / H;
        X[j * GW + i] = x;
        Y[j * GW + i] = y;
      }
    }
    const RS = new Float32Array(GH * GW);
    for (let i = 0; i < RS.length; i++) RS[i] = Math.sqrt(X[i] * X[i] + Y[i] * Y[i]);

    const XC = new Float32Array(nRows * nCols), YC = new Float32Array(nRows * nCols);
    const RC = new Float32Array(nRows * nCols);
    for (let j = 0; j < nRows; j++) {
      const y = ((j + 0.5) * ch - H / 2) / H;
      for (let i = 0; i < nCols; i++) {
        const x = ((i + 0.5) * cw - W / 2) / H;
        const p = j * nCols + i;
        XC[p] = x; YC[p] = y; RC[p] = Math.sqrt(x * x + y * y);
      }
    }
    const HASH = new Float32Array(nRows * nCols);
    for (let j = 0; j < nRows; j++) {
      for (let i = 0; i < nCols; i++) {
        HASH[j * nCols + i] = (((j * 73856093) ^ (i * 19349663) ^ 0x5bd1e995) % 1009) / 1009;
      }
    }
    return { nRows, nCols, W, H, GW, GH, cw, ch, X, Y, RS, XC, YC, RC, HASH };
  }

  // ------------------------------------------------------------ 眼球
  function blinkCurve(t) {
    const d = t - CFG.T_BLINK;
    if (d < 0 || d > 0.36) return 0;
    if (d < 0.09) return ease(d / 0.09);
    if (d < 0.12) return 1;
    return 1 - ease((d - 0.12) / 0.24);
  }

  function lidOpen(t) {
    let k = ease((t - CFG.T_OPEN) / CFG.T_OPEN_D);
    k = k * (1 + 0.035 * Math.sin(PI * k));
    return Math.min(1, k) * (1 - 0.985 * blinkCurve(t));
  }

  function lidEdges(u0, ou) {
    const s = u0 / CFG.WO;
    const wu = s < -0.12 ? 0.88 : 1.12;
    const cu = Math.pow(Math.max(0, 1 - Math.pow((s + 0.12) / wu, 2)), 0.8);
    const cl = Math.pow(Math.max(0, 1 - Math.pow(s - 0.08, 2)), 0.9);
    const vc = 0.03 * cl;
    const vl = vc + (CFG.HL * cl - vc) * (0.35 + 0.65 * ou);
    const vu = vl + (-CFG.HU * cu - vl) * ou;
    return [vu, vl, cu, cl];
  }

  class Renderer {
    constructor(cellW, cellH, rows, opts) {
      this.opts = Object.assign({ smooth: 0, levels: 0, hash: 0.07 }, opts || {});
      this.tex = this.opts.tex || new Textures();
      this.geo = buildGeometry(rows, cellW, cellH);
      const g = this.geo;
      this.img = new Float32Array(g.GH * g.GW * 3);
      this.space = new Float32Array(g.GH * g.GW * 3);
      this.pm = new Float32Array(g.GH * g.GW);
      this.cells = new Float32Array(g.nRows * g.nCols * 3);
      this.lum = new Float32Array(g.nRows * g.nCols);
      this.idx = new Uint8Array(g.nRows * g.nCols);
      this.q = new Uint8Array(g.nRows * g.nCols * 3);
      this.streaks = [];
      this.nextShoot = 1e9;
      this.comet = false;
      this.lastT = 0;
      this.reset();
    }

    reset() {
      const tex = this.tex;
      this.nextShoot = 1e9;
      this.comet = false;
      this.streaks.length = 0;
      const z = tex.rng.uniform(0.06, 1.0, NS);
      tex.starZ.set(Float32Array.from(z));
    }

    // -------------------------------------------------- 星空状态
    updateWorld(t, dt, prog) {
      const tex = this.tex;
      const vf = 0.010 + 0.05 * prog + (t > CFG.T_SPACE ? 0.015 : 0);
      if (!this._dead) this._dead = new Uint8Array(NS);
      const dead = this._dead;
      dead.fill(0);
      let nDead = 0;
      for (let i = 0; i < NS; i++) {
        tex.starZ[i] -= vf * dt;
        if (tex.starZ[i] < 0.06) { tex.starZ[i] += 0.94; dead[i] = 1; nDead++; }
      }
      if (nDead > 0) {
        // 与 numpy 版一致：先整批抽 X，再整批抽 Y，按索引升序回填
        const xs = tex.rng.uniform(-1, 1, nDead);
        const ys = tex.rng.uniform(-1, 1, nDead);
        let k = 0;
        for (let i = 0; i < NS; i++) {
          if (dead[i]) { tex.starX[i] = xs[k]; tex.starY[i] = ys[k]; k++; }
        }
      }
      if (this.nextShoot > 1e8 && t > CFG.T_SPACE - 4.0) this.nextShoot = t + 1.0;
      const rnd = tex.streakRnd;
      if (t > this.nextShoot) {
        this.nextShoot = t + rnd.uniform(2.2, 4.5);
        const ang = (rnd.uniform(18, 62) * PI) / 180;
        const sign = rnd.choice([-1, 1]);
        const spd = rnd.uniform(0.7, 1.2);
        this.streaks.push({
          x: rnd.uniform(-0.7, 0.7), y: rnd.uniform(-0.45, -0.15),
          vx: sign * Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          life: rnd.uniform(0.9, 1.4), tail: rnd.uniform(0.14, 0.26),
          col: [0.88, 0.94, 1.0], soft: false, age: 0,
        });
      }
      if (t > CFG.T_SPACE + 1.5 && !this.comet) {
        this.comet = true;
        this.streaks.push({
          x: -0.95, y: -0.28, vx: 0.030, vy: 0.008, life: 70.0, tail: 0.22,
          col: [0.70, 0.86, 1.0], soft: true, age: 0,
        });
      }
      for (const s of this.streaks) s.age += dt;
      this.streaks = this.streaks.filter((s) => s.age < s.life);
    }

    // -------------------------------------------------- 星云
    nebula(xs, ys, sz, hm, t, out, offset, scale) {
      const tex = this.tex;
      const hx = xs / sz, hy = -ys / sz;
      const nC = bilinear(tex.glow, 1024, hx * 16 + 400, hy * 16 + 100);
      const nD = bilinear(tex.glow, 1024, hx * 16 + 90, hy * 16 + 530);
      const nA = bilinear(tex.glow, 1024, hx * 42 + 300, hy * 42 + 700 + t * 0.8);
      const nB = bilinear(tex.glow, 1024, hx * 110 + 80, hy * 110 + 200);

      const wob = 1 - 0.65 * hm;
      const hxw = hx + wob * 0.40 * (nC - 0.5) + 0.05 * (nA - 0.5);
      const hyw = hy + wob * 0.40 * (nD - 0.5) + 0.05 * (nA - 0.5);

      const qc = Math.sqrt(hxw * hxw + hyw * hyw) / 0.80 - 1.0;
      const hyh = hyw + 0.12;
      const fh = Math.pow(hxw * hxw + hyh * hyh - 1.0, 3) - hxw * hxw * hyh * hyh * hyh;
      const qh = 0.5 * Math.cbrt(fh);
      const q = qc * (1 - hm) + qh * hm;

      const ins = clamp(-q / (0.80 - 0.35 * hm), 0, 1);
      const k = 3.0 + 2.5 * hm;
      const body = q < 0 ? 0.50 + 0.50 * Math.sqrt(ins) : Math.exp(-clamp(q, 0, 10) * k) * 0.50;

      const texScale = 1 + (0.62 + 0.80 * nB - 1) * 0.8;
      const tI = Math.pow(ins, 0.8);
      let r = body * texScale * mix(0.92, 1.0, tI);
      let g = body * texScale * mix(0.16, 0.58, tI);
      let b = body * texScale * mix(0.40, 0.78, tI);

      const halo = Math.exp(-clamp(q, 0, 10) * 1.6) * 0.20 * (0.5 + nA) * (q > 0 ? 1 : 0);
      r += halo * 0.78; g += halo * 0.10; b += halo * 0.30;

      const rim = Math.exp(-Math.pow((q + 0.04) / 0.14, 2));
      const rid = clamp((bilinear(tex.ring, 512, hxw * 120 + 50, hyw * 120 + 300 + t * 0.6) - 0.86) * 7, 0, 1);
      const rimK = rim * (0.20 + 0.9 * rid) * (0.5 + nA);
      r += rimK * 0.95; g += rimK * 0.16; b += rimK * 0.34;
      const ridK = rid * clamp(-q, 0, 1) * 0.25;
      r += ridK * 0.95; g += ridK * 0.16; b += ridK * 0.34;

      out[offset] += r * scale;
      out[offset + 1] += g * scale;
      out[offset + 2] += b * scale;
    }

    // -------------------------------------------------- 眼球 + 星空合成
    eyeScene(t, z, ou, gx, gy, Rp, space) {
      const g = this.geo, tex = this.tex, img = this.img, pm = this.pm;
      const iz = 1 / z, px = iz / g.GH;
      const near = z < 3.4;
      const GW = g.GW, GH = g.GH;
      const RI = CFG.RI, WO = CFG.WO, HU = CFG.HU, HL = CFG.HL;

      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          const p = j * GW + i;
          const o3 = p * 3;
          const u = g.X[p] * iz, v = g.Y[p] * iz;
          const pmu = u - gx, pmv = v - gy;
          const r = Math.sqrt(pmu * pmu + pmv * pmv);

          let s = 0, vt = 0, vu = 0, vl = 0, duIn = 0, dlIn = 0, mIn = 1;
          if (near) {
            s = u / WO;
            const sa = clamp(s, -1.3, 1.3);
            const wu = sa < -0.12 ? 0.88 : 1.12;
            const cu = Math.pow(clamp(1 - Math.pow((sa + 0.12) / wu, 2), 0, 1), 0.8);
            const cl = Math.pow(clamp(1 - Math.pow(sa - 0.08, 2), 0, 1), 0.9);
            vt = v + 0.055 * s;
            const vc = 0.03 * cl;
            vl = vc + (HL * cl - vc) * (0.35 + 0.65 * ou);
            vu = vl + (-HU * cu - vl) * ou;
            duIn = vt - vu;
            dlIn = vl - vt;
            mIn = clamp(Math.min(duIn, dlIn) / (1.6 * px) + 0.5, 0, 1);
          }

          // ---- 虹膜 ----
          let angNorm = (Math.atan2(pmv, pmu) / (2 * PI)) % 1.0;
          if (angNorm < 0) angNorm += 1.0;
          const ia = (Math.trunc(angNorm * NA)) % NA;
          const rn = clamp((r - Rp) / (RI - Rp), 0, 1.3);
          const rb = rn * 14;
          const i0 = Math.floor(rb);
          const fr = rb - i0;
          const fib = 0.55 * tex.a1[ia]
            + 0.45 * (tex.a2[(ia + i0 * 131) % NA] * (1 - fr) + tex.a2[(ia + (i0 + 1) * 131) % NA] * fr);
          const zig = Math.abs(((angNorm * 34) % 1.0) - 0.5) * 2 - 0.5;
          const cr = 0.34 + 0.20 * (tex.a3[ia] - 0.5) + 0.035 * zig;
          const mm = smoothstep(-0.10, 0.22, rn - cr);
          let irR = mix(0.80, 0.42, mm), irG = mix(0.45, 0.20, mm), irB = mix(0.10, 0.06, mm);
          const fibK = 0.45 + 1.05 * fib;
          irR *= fibK; irG *= fibK; irB *= fibK;
          const ringK = Math.exp(-Math.pow((rn - cr) / 0.07, 2)) * (0.2 + fib);
          irR += 0.22 * ringK; irG += 0.11 * ringK;
          const crypt = tex.a4[ia] > 0.72 ? smoothstep(0.65, 0.18, rn) : 0;
          const c1 = 1 - 0.55 * crypt;
          const c2 = 1 - 0.82 * smoothstep(0.62, 1.0, rn);
          const c3 = 0.55 + 0.45 * smoothstep(0, 0.07, rn);
          const c4 = near ? 0.30 + 0.70 * smoothstep(0, 0.16, duIn) : 1;
          const irK = c1 * c2 * c3 * c4;
          irR *= irK; irG *= irK; irB *= irK;

          let inR, inG, inB;
          if (near) {
            const corner = smoothstep(0.40, 0.95, Math.abs(s));
            const shade = (0.38 + 0.62 * smoothstep(0, 0.22, duIn))
              * (0.72 + 0.28 * smoothstep(0, 0.10, dlIn))
              * (1 - 0.30 * corner);
            const cw2 = corner * 0.35;
            let scR = mix(0.80, 0.86, cw2) * shade;
            let scG = mix(0.82, 0.50, cw2) * shade;
            let scB = mix(0.86, 0.46, cw2) * shade;
            const vein = clamp((bilinear(tex.vein, 512, u * 85 + 40, v * 85 + 70) - 0.925) * 14, 0, 1)
              * (0.25 + 0.75 * corner) * smoothstep(0.12, 0.32, Math.abs(pmu));
            const vk = vein * 0.65;
            scR = mix(scR, 0.62, vk); scG = mix(scG, 0.15, vk); scB = mix(scB, 0.14, vk);
            const im = clamp((RI - r) / (1.6 * px) + 0.5, 0, 1);
            inR = mix(scR, irR, im); inG = mix(scG, irG, im); inB = mix(scB, irB, im);
          } else {
            inR = irR; inG = irG; inB = irB;
          }

          const Rps = Rp * z;
          const vig = 0.25 + 0.75 * smoothstep(0, 0.30 * Rps, Rps - g.RS[p]);
          const pmVal = clamp((Rp - r) / (1.6 * px) + 0.5, 0, 1);
          inR = mix(inR, space[o3] * vig, pmVal);
          inG = mix(inG, space[o3 + 1] * vig, pmVal);
          inB = mix(inB, space[o3 + 2] * vig, pmVal);

          // ---- 角膜高光 ----
          const fade = Math.max(0, Math.min(1, 1 - (z - 1.6) / 2.4));
          if (fade > 0) {
            const dd = Math.sqrt(Math.pow(pmu - 0.075, 2) + Math.pow(pmv + 0.040, 2));
            const win = clamp(1 - (dd - 0.030) / (1.4 * px + 0.004), 0, 1);
            const dd2 = Math.sqrt(Math.pow(pmu + 0.045, 2) + Math.pow(pmv - 0.050, 2));
            const win2 = clamp(1 - (dd2 - 0.009) / (1.4 * px + 0.003), 0, 1) * 0.5;
            const w = (win + win2) * fade * 1.4;
            inR += w; inG += w * 0.98; inB += w * 0.95;
          }

          pm[p] = pmVal;
          if (!near) {
            img[o3] = inR; img[o3 + 1] = inG; img[o3 + 2] = inB;
            continue;
          }

          if (z < 2.6) {
            const mid = 0.5 * (vu + vl);
            const upper = vt < mid;
            const du = Math.max(vu - vt, 0);
            const dl = Math.max(vt - vl, 0);
            const dd = upper ? du : dl;
            const tx = bilinear(tex.skin, 1024, u * 120 + 100, v * 120 + 100);
            let skR = 0.62 * (0.90 + 0.20 * tx);
            let skG = 0.40 * (0.90 + 0.20 * tx);
            let skB = 0.29 * (0.90 + 0.20 * tx);

            let sh = 0.50 + 0.50 * smoothstep(0, 0.30, dd);
            sh *= 1 + 0.10 * Math.exp(-Math.pow((v + 0.20) / 0.09, 2));
            const crPos = 0.075 + 0.03 * (1 - ou);
            sh *= 1 - 0.42 * Math.exp(-Math.pow((du - crPos) / 0.020, 2)) * (upper ? 1 : 0);
            sh *= 1 + 0.08 * Math.exp(-Math.pow((dl - 0.09) / 0.04, 2)) * (upper ? 0 : 1);
            skR *= sh; skG *= sh; skB *= sh;
            const lidzone = smoothstep(crPos, crPos * 0.4, du) * (upper ? 1 : 0);
            const lk = lidzone * 0.5;
            skR = mix(skR, 0.68 * sh, lk); skG = mix(skG, 0.40 * sh, lk); skB = mix(skB, 0.31 * sh, lk);

            // 眉毛
            const sb = clamp(1 - Math.abs(s), 0, 1);
            const eb = Math.exp(-Math.pow((vt + 0.42 + 0.10 * s * s) / (0.040 + 0.012 * sb), 2));
            const hair = 0.55 + 0.9 * bilinear(tex.white, 512, u * 90, v * 30);
            const browK = clamp(eb * hair, 0, 0.92);
            skR = mix(skR, 0.10, browK); skG = mix(skG, 0.06, browK); skB = mix(skB, 0.04, browK);

            // 上眼睑线
            const line = Math.exp(-Math.pow(du / 0.010, 2)) * (upper ? 1 : 0);
            const lineK = clamp(line * (1.0 - 0.3 * ou) * 0.9, 0, 1);
            skR = mix(skR, 0.05, lineK); skG = mix(skG, 0.03, lineK); skB = mix(skB, 0.022, lineK);

            // 下眼睑湿润反光
            const wl = smoothstep(0.014, 0.0, dl) * (upper ? 0 : 1);
            skR = mix(skR, 0.74, wl * 0.7); skG = mix(skG, 0.34, wl * 0.7); skB = mix(skB, 0.30, wl * 0.7);
            const gl = Math.exp(-Math.pow((dl - 0.016) / 0.006, 2)) * (upper ? 0 : 1)
              * (0.35 + 0.65 * bilinear(tex.white, 512, u * 60, v * 60));
            const glK = gl * 0.55 * smoothstep(0.12, 0.5, ou);
            skR += glK; skG += glK * 0.85; skB += glK * 0.75;

            // 皮肤微光
            const spark = (bilinear(tex.white, 512, u * 150 + 7, v * 150 + 3) > 0.985 ? 1 : 0)
              * 0.35 * (0.4 + tx) * smoothstep(0.0, 0.3, dd);
            skR += spark; skG += spark * 0.9; skB += spark * 0.8;

            inR = mix(skR, inR, mIn); inG = mix(skG, inG, mIn); inB = mix(skB, inB, mIn);

            // 内眼角
            const cg = Math.exp(-(Math.pow((u + WO * 0.90) / 0.045, 2)
              + Math.pow((vt - 0.025) / 0.032, 2))) * smoothstep(0.1, 0.5, ou);
            const cgK = cg * 0.85;
            inR = mix(inR, 0.82, cgK); inG = mix(inG, 0.42, cgK); inB = mix(inB, 0.38, cgK);
          }

          img[o3] = inR; img[o3 + 1] = inG; img[o3 + 2] = inB;
        }
      }
    }

    // -------------------------------------------------- 泛光 + 色调映射
    bloom() {
      const g = this.geo, img = this.img;
      const GW = g.GW, GH = g.GH;
      if (!this._bright) this._bright = new Float32Array(GW * GH * 3);
      const bright = this._bright;
      for (let i = 0; i < bright.length; i++) bright[i] = Math.max(img[i] - 0.45, 0);

      for (const [factor, weight] of [[2, 0.40], [4, 0.30]]) {
        const sw = GW / factor, sh = GH / factor;
        const small = new Float32Array(sw * sh * 3);
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            let sr = 0, sg = 0, sb = 0;
            for (let dy = 0; dy < factor; dy++) {
              for (let dx = 0; dx < factor; dx++) {
                const p = ((y * factor + dy) * GW + (x * factor + dx)) * 3;
                sr += bright[p]; sg += bright[p + 1]; sb += bright[p + 2];
              }
            }
            const o = (y * sw + x) * 3;
            const n = factor * factor;
            small[o] = sr / n; small[o + 1] = sg / n; small[o + 2] = sb / n;
          }
        }
        for (let pass = 0; pass < 2; pass++) {
          const tmp = new Float32Array(small.length);
          for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
              const o = (y * sw + x) * 3;
              const ym = ((y - 1 + sh) % sh) * sw, yp = ((y + 1) % sh) * sw;
              const xm = (x - 1 + sw) % sw, xp = (x + 1) % sw;
              for (let c = 0; c < 3; c++) {
                tmp[o + c] = (small[o + c] * 2 + small[(ym + x) * 3 + c] + small[(yp + x) * 3 + c]
                  + small[(y * sw + xm) * 3 + c] + small[(y * sw + xp) * 3 + c]) / 6;
              }
            }
          }
          small.set(tmp);
        }
        // 上采样叠加
        for (let y = 0; y < GH; y++) {
          const sy = Math.floor(y / factor);
          for (let x = 0; x < GW; x++) {
            const sx = Math.floor(x / factor);
            const p = (y * GW + x) * 3, sp = (sy * sw + sx) * 3;
            img[p] += weight * small[sp];
            img[p + 1] += weight * small[sp + 1];
            img[p + 2] += weight * small[sp + 2];
          }
        }
      }
    }

    // -------------------------------------------------- 星点 / 流星 / 睫毛
    stampStars(lum, t, gs, amt, offx, offy) {
      const g = this.geo, tex = this.tex, idx = this.idx, q = this.q;
      if (amt <= 0.003) return;
      const COLS = g.nCols, ROWS = g.nRows, W = g.W, H = g.H, cw = g.cw, ch = g.ch;
      const pupil = this.pupilCells, vigc = this.vigc;

      for (let i = 0; i < NS; i++) {
        const d = tex.starZ[i];
        const c = Math.trunc((W * 0.5 + (tex.starX[i] * gs / d + offx) * H) / cw);
        const r = Math.trunc((H * 0.5 + (tex.starY[i] * gs / d + offy) * H) / ch);
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
        const alpha = smoothstep(1.0, 0.82, d)
          * (0.80 + 0.20 * Math.sin(t * tex.starFreq[i] + tex.starPhase[i])) * amt;
        if (alpha <= 0.04) continue;
        if (pupil[r * COLS + c] <= 0.5) continue;
        const b = tex.starB[i] * alpha * (1 + 0.05 / d);
        if (b <= lum[r * COLS + c] * 0.7) continue;
        const p = r * COLS + c;
        idx[p] = b < 0.20 ? CIDX["."] : b < 0.42 ? CIDX["+"] : CIDX["*"];
        const k = clamp(0.35 + 0.9 * b, 0, 1) * vigc[p];
        q[p * 3] = (clamp(tex.starCol[i * 3] * k, 0, 1) * (QL - 1)) | 0;
        q[p * 3 + 1] = (clamp(tex.starCol[i * 3 + 1] * k, 0, 1) * (QL - 1)) | 0;
        q[p * 3 + 2] = (clamp(tex.starCol[i * 3 + 2] * k, 0, 1) * (QL - 1)) | 0;

        if (b > 0.55) {
          idx[p] = b > 0.85 ? CIDX["@"] : CIDX["*"];
          const ln = Math.trunc(2 + 6 * (b - 0.5));
          const col = [tex.starCol[i * 3] * vigc[p], tex.starCol[i * 3 + 1] * vigc[p], tex.starCol[i * 3 + 2] * vigc[p]];
          for (let k2 = 1; k2 <= ln; k2++) {
            const a = (1 - k2 / (ln + 1)) * b;
            const vert = Math.floor(k2 / 2) + (k2 > 2 ? 1 : 0);
            const arms = [[0, k2, "-"], [0, -k2, "-"], [vert, 0, "|"], [-vert, 0, "|"]];
            for (const [dr, dc, chh] of arms) {
              if (dr === 0 && dc === 0) continue;
              const r2 = r + dr, c2 = c + dc;
              if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) continue;
              const p2 = r2 * COLS + c2;
              if (pupil[p2] <= 0.5 || lum[p2] >= a * 0.8) continue;
              idx[p2] = CIDX[a > 0.18 ? chh : "."];
              const kk = Math.min(1, 0.25 + a);
              q[p2 * 3] = (clamp(col[0] * kk, 0, 1) * (QL - 1)) | 0;
              q[p2 * 3 + 1] = (clamp(col[1] * kk, 0, 1) * (QL - 1)) | 0;
              q[p2 * 3 + 2] = (clamp(col[2] * kk, 0, 1) * (QL - 1)) | 0;
            }
          }
        }
      }
    }

    stampStreaks() {
      const g = this.geo, idx = this.idx, q = this.q, pm = this.pm, GW = g.GW;
      const COLS = g.nCols, ROWS = g.nRows, W = g.W, H = g.H, cw = g.cw, ch = g.ch;
      for (const s of this.streaks) {
        const hx = s.x + s.vx * s.age;
        const hy = s.y + s.vy * s.age;
        const sp = Math.hypot(s.vx, s.vy);
        const dx = s.vx / sp, dy = s.vy / sp;
        const fade = Math.pow(Math.sin(PI * Math.min(1, s.age / s.life)), 0.7);
        if (fade < 0.02) continue;
        let tc;
        if (Math.abs(dy) < 0.38 * Math.abs(dx)) tc = "-";
        else if (Math.abs(dx) < 0.38 * Math.abs(dy)) tc = "|";
        else if (dx * dy > 0) tc = "\\";
        else tc = "/";
        const n = Math.max(6, Math.trunc((s.tail * H) / (cw * 0.8)));
        for (let k = 0; k < n; k++) {
          const f = k / n;
          const c = Math.trunc((W / 2 + (hx - dx * s.tail * f) * H) / cw);
          const r = Math.trunc((H / 2 + (hy - dy * s.tail * f) * H) / ch);
          const b = Math.pow(1 - f, 1.3) * fade;
          if (b < 0.08 || r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
          if (this.pupilCells[r * COLS + c] < 0.5) continue;
          let chIdx;
          if (k === 0) chIdx = CIDX[s.soft ? "*" : "@"];
          else if (s.soft) chIdx = CIDX[b > 0.35 ? ":" : "."];
          else chIdx = CIDX[b > 0.30 ? tc : "."];
          idx[r * COLS + c] = chIdx;
          const kk = Math.min(1, 0.3 + b) * this.vigc[r * COLS + c];
          q[(r * COLS + c) * 3] = (clamp(s.col[0] * kk, 0, 1) * (QL - 1)) | 0;
          q[(r * COLS + c) * 3 + 1] = (clamp(s.col[1] * kk, 0, 1) * (QL - 1)) | 0;
          q[(r * COLS + c) * 3 + 2] = (clamp(s.col[2] * kk, 0, 1) * (QL - 1)) | 0;
        }
      }
    }

    stampLashes(t, z, ou) {
      if (z > 2.6 || ou < 0) return;
      const g = this.geo, tex = this.tex, idx = this.idx, q = this.q;
      const COLS = g.nCols, ROWS = g.nRows, W = g.W, H = g.H, cw = g.cw, ch = g.ch;
      const closed = 1 - Math.pow(ou, 0.8);

      const toCell = (ue, ve) => [Math.trunc((W / 2 + ue * z * H) / cw),
                                  Math.trunc((H / 2 + ve * z * H) / ch)];
      const pick = (angle) => {
        const deg = ((Math.atan2(-Math.sin(angle), Math.cos(angle)) * 180) / PI) % 180;
        const d = deg < 0 ? deg + 180 : deg;
        if (d < 25 || d >= 155) return "-";
        if (d < 70) return "/";
        if (d < 110) return "|";
        return "\\";
      };
      const draw = (baseU, baseV, a0, len, curl, cRoot, cTip, maxSteps, tip) => {
        const steps = Math.max(2, Math.min(maxSteps, Math.trunc((len * z * H) / (cw * 0.85))));
        const step = len / steps;
        let ue = baseU, ve = baseV;
        for (let k = 0; k < steps; k++) {
          const tt = k / Math.max(1, steps - 1);
          const aa = a0 + curl * tt * tt;
          ue += Math.cos(aa) * step;
          ve += Math.sin(aa) * step;
          const [c, r] = toCell(ue, ve);
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
          const chDig = tip && k === steps - 1 && steps >= 4 ? tip : pick(aa);
          idx[r * COLS + c] = CIDX[chDig];
          const p = r * COLS + c;
          q[p * 3] = (clamp(cRoot[0] + (cTip[0] - cRoot[0]) * tt, 0, 1) * (QL - 1)) | 0;
          q[p * 3 + 1] = (clamp(cRoot[1] + (cTip[1] - cRoot[1]) * tt, 0, 1) * (QL - 1)) | 0;
          q[p * 3 + 2] = (clamp(cRoot[2] + (cTip[2] - cRoot[2]) * tt, 0, 1) * (QL - 1)) | 0;
        }
      };

      for (let i = 0; i < NUP; i++) {
        const s0 = tex.upperLashes[i];
        const u0 = s0 * CFG.WO;
        const [vu, , ,] = lidEdges(u0, ou);
        const bv = vu - 0.055 * s0;
        const aOpen = (-90 + 26 * s0) * PI / 180;
        const aClosed = s0 >= 0 ? (90 - 20 * s0) * PI / 180 : (-270 - 20 * s0) * PI / 180;
        const a0 = aOpen + (aClosed - aOpen) * closed;
        const edge = Math.sqrt(Math.max(0, 1 - s0 * s0));
        const len = (0.070 + 0.050 * edge) * tex.upperLen[i];
        const curl = (-22 * s0) * PI / 180 * (1 - closed);
        draw(u0, bv, a0, len, curl, [0.16, 0.10, 0.07], [0.30, 0.19, 0.13], 14, "'");
      }
      for (let i = 0; i < NLO; i++) {
        const s0 = tex.lowerLashes[i];
        const u0 = s0 * CFG.WO;
        const [, vl, , cl] = lidEdges(u0, ou);
        const bv = vl - 0.055 * s0;
        const a0 = (90 - 20 * s0) * PI / 180;
        const len = 0.034 * (0.5 + 0.8 * cl) * tex.lowerLen[i];
        const curl = (12 * (s0 > 0 ? 1 : -1)) * PI / 180;
        draw(u0, bv, a0, len, curl, [0.17, 0.11, 0.08], [0.30, 0.20, 0.14], 6, ".");
      }
    }

    // -------------------------------------------------- 单元格亮度平滑
    blurLum() {
      const g = this.geo, lum = this.lum;
      const cols = g.nCols, rows = g.nRows;
      const tmp = this._lumTmp || (this._lumTmp = new Float32Array(lum.length));
      for (let r = 0; r < rows; r++) {
        const rm = r > 0 ? r - 1 : 0, rp = r < rows - 1 ? r + 1 : r;
        for (let c = 0; c < cols; c++) {
          const cm = c > 0 ? c - 1 : 0, cp = c < cols - 1 ? c + 1 : c;
          tmp[r * cols + c] = (
            lum[rm * cols + cm] + lum[rm * cols + c] + lum[rm * cols + cp] +
            lum[r * cols + cm] + lum[r * cols + c] * 2 + lum[r * cols + cp] +
            lum[rp * cols + cm] + lum[rp * cols + c] + lum[rp * cols + cp]
          ) / 10;
        }
      }
      lum.set(tmp);
    }

    // -------------------------------------------------- 单元格亮度对比度拉伸
    // 虹膜和皮肤的亮度几乎相同，直接映射成字符会糊成一片。
    // 这里按当前帧的 6%~96% 分位做自动色阶，让画面结构占满整个字符梯度。
    stretchLum(amount) {
      const n = this.geo.nRows * this.geo.nCols;
      const lum = this.lum;
      if (!this._sorted || this._sorted.length !== n) this._sorted = new Float32Array(n);
      const sorted = this._sorted;
      sorted.set(lum);
      const arr = Array.prototype.slice.call(sorted);
      arr.sort((a, b) => a - b);
      const lo = arr[Math.floor(n * 0.06)];
      const hi = arr[Math.floor(n * 0.96)];
      const span = Math.max(1e-3, hi - lo);
      for (let p = 0; p < n; p++) {
        const v = clamp((lum[p] - lo) / span, 0, 1);
        lum[p] = lum[p] * (1 - amount) + v * amount;
      }
    }

    // -------------------------------------------------- 一帧
    render(t, dt) {
      const g = this.geo, tex = this.tex;
      this.lastT = t;
      const prog = ease((t - CFG.T_Z0) / CFG.T_ZD);
      const idle = ease(t / CFG.T_Z0);
      const z = Math.exp(Math.log(CFG.ZEND) * prog) * (1 + 0.05 * idle + 0.004 * Math.sin(t * 0.9));
      const zsp = t < CFG.T_SPACE ? z : CFG.ZEND * Math.exp(0.03 * (t - CFG.T_SPACE));
      const gs = Math.min(6.0, CFG.GS0 * Math.pow(zsp, 1.25));
      const gh = Math.min(1.15, CFG.GS0 * Math.pow(z, 1.25));
      const ou = lidOpen(t);
      const [gx, gy] = this.gaze(t);
      const Rp = CFG.RP0 * (0.76 + 0.24 * ease((t - 1.8) / 3.5))
        * (1 + 0.025 * Math.sin(1.9 * t)) * (1 + 0.30 * prog);
      const Rps = Rp * z;
      const full = Rps * 0.72 > 1.03;

      const starAmt = ease((t - (CFG.T_Z0 + 1.5)) / 4.5);
      const nebAmt = ease((t - (CFG.T_Z0 + 3.5)) / 8.0);
      this.updateWorld(t, dt, prog);

      const offx = gx * z, offy = gy * z;
      const space = this.space;
      for (let i = 0; i < space.length; i += 3) {
        space[i] = 0.004; space[i + 1] = 0.005; space[i + 2] = 0.012;
      }
      if (nebAmt > 0.002) {
        const drift = ease((t - CFG.T_SPACE) / 20.0);
        const morph = ease((t - CFG.T_HEART) / CFG.T_HEART_D);
        const beat = 1 + 0.03 * Math.sin(t * 2.6) * morph * morph;
        const scale = 1.25 * Math.pow(nebAmt, 1.3);
        const shift = 0.03 * drift * Math.sin(t * 0.07);
        const sz = 0.17 * gh * beat;
        for (let p = 0; p < g.GH * g.GW; p++) {
          this.nebula(g.X[p] - offx - shift, g.Y[p] - offy, sz, morph, t, space, p * 3, scale);
        }
      }

      const pupilCells = this.pupilCells || (this.pupilCells = new Float32Array(g.nRows * g.nCols));
      if (full) {
        this.img.set(space);
        pupilCells.fill(1);
      } else {
        this.eyeScene(t, z, ou, gx, gy, Rp, space);
        for (let r = 0; r < g.nRows; r++) {
          for (let c = 0; c < g.nCols; c++) {
            let sum = 0;
            for (let dy = 0; dy < CFG.SS; dy++) {
              for (let dx = 0; dx < CFG.SS; dx++) {
                sum += this.pm[(r * CFG.SS + dy) * g.GW + (c * CFG.SS + dx)];
              }
            }
            pupilCells[r * g.nCols + c] = sum / (CFG.SS * CFG.SS);
          }
        }
      }

      // 星点 / 流星用的暗角表（瞳孔越近越亮）
      const vigc = this.vigc || (this.vigc = new Float32Array(g.nRows * g.nCols));
      for (let p = 0; p < g.nRows * g.nCols; p++) {
        vigc[p] = 0.25 + 0.75 * smoothstep(0, 0.30 * Rps, Rps - g.RC[p]);
      }

      this.bloom();

      // 色调映射 + 暗角 + 淡入
      const fadeIn = ease(t / 1.2);
      for (let p = 0; p < g.GH * g.GW; p++) {
        for (let c = 0; c < 3; c++) {
          const v = this.img[p * 3 + c];
          let o = 1 - Math.exp(-2.0 * (v > 0 ? v : 0));
          o *= (1 - 0.30 * smoothstep(0.4, 1.0, g.RS[p])) * fadeIn;
          this.img[p * 3 + c] = o;
        }
      }

      // 字符格：取 SS×SS 平均色
      for (let r = 0; r < g.nRows; r++) {
        for (let c = 0; c < g.nCols; c++) {
          let sr = 0, sg = 0, sb = 0;
          for (let dy = 0; dy < CFG.SS; dy++) {
            for (let dx = 0; dx < CFG.SS; dx++) {
              const p = ((r * CFG.SS + dy) * g.GW + (c * CFG.SS + dx)) * 3;
              sr += this.img[p]; sg += this.img[p + 1]; sb += this.img[p + 2];
            }
          }
          const n = CFG.SS * CFG.SS;
          const o = (r * g.nCols + c) * 3;
          this.cells[o] = sr / n; this.cells[o + 1] = sg / n; this.cells[o + 2] = sb / n;
          const lum = 0.30 * (sr / n) + 0.60 * (sg / n) + 0.10 * (sb / n);
          this.lum[r * g.nCols + c] = Math.pow(clamp(lum, 0, 1), 0.72);
        }
      }

      // 单元格亮度：可选平滑 + 对比度拉伸 + 字阶量化
      for (let i = 0; i < (this.opts.smooth | 0); i++) this.blurLum();
      if (this.opts.contrast) this.stretchLum(this.opts.contrast);
      const levels = this.opts.levels | 0;
      const glyphs = this.opts.glyphs || null;
      const glyphIdx = glyphs ? Array.from(glyphs, (c) => CIDX[c]) : null;
      const hashAmp = this.opts.hash;
      const solid = full ? null : pupilCells;
      for (let p = 0; p < g.nRows * g.nCols; p++) {
        let li = this.lum[p];
        let ri;
        if (glyphIdx) {
          const k = clamp(Math.round(li * (glyphIdx.length - 1)), 0, glyphIdx.length - 1);
          ri = glyphIdx[k];
        } else {
          if (levels > 0) li = Math.round(li * levels) / levels;
          ri = clamp((li + (g.HASH[p] - 0.5) * hashAmp) * NR, 0, NR);
        }
        if (solid && solid[p] < 0.5) ri = Math.max(ri, 3);
        this.idx[p] = ri | 0;
        const o = p * 3;
        this.q[o] = clamp(this.cells[o] * 1.15, 0, 1) * (QL - 1) | 0;
        this.q[o + 1] = clamp(this.cells[o + 1] * 1.15, 0, 1) * (QL - 1) | 0;
        this.q[o + 2] = clamp(this.cells[o + 2] * 1.15, 0, 1) * (QL - 1) | 0;
      }

      this.stampStars(this.lum, t, gs, starAmt, offx, offy);
      this.stampStreaks();
      if (!full) this.stampLashes(t, z, ou);

      return { idx: this.idx, q: this.q, rows: g.nRows, cols: g.nCols };
    }

    gaze(t) {
      const keys = this.tex.gazeKeys;
      let prev = [0, 0], cur = [0, 0], te = 0;
      for (const [tk, kx, ky] of keys) {
        if (tk <= t) { prev = cur; cur = [kx, ky]; te = tk; } else break;
      }
      const k = ease((t - te) / 0.09);
      let gx = prev[0] + (cur[0] - prev[0]) * k;
      let gy = prev[1] + (cur[1] - prev[1]) * k;
      gx += 0.003 * Math.sin(t * 1.3);
      gy += 0.002 * Math.sin(t * 1.1 + 1);
      const amp = 1 - ease((t - CFG.T_Z0) / 2.5);
      gy -= 0.03 * blinkCurve(t);
      return [gx * amp, gy * amp];
    }
  }

  global.EyeEngine = { CFG, RAMP, NR, QL, Renderer, MT19937 };
})(typeof window !== "undefined" ? window : globalThis);
