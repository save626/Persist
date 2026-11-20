/**
 * 开场动画参数探针
 * ---------------------------------------------------------------------------
 * 目的：量化「字符过于密集」到底来自哪一层 —— 是引擎本身，还是落地页调用侧的
 * 参数（opts / 字体 / 配色）把它推向了「密密麻麻」的区间。
 *
 * 做法：直接加载 third_party/eyetutorial-replica/engine.js（与 Python 原版逐帧
 * 一致），在不同 opts 组合下渲染同一时刻，统计：
 *   · 空格占比      —— 原版的大片留白靠它
 *   · RAMP 索引均值 —— 决定字符落在「窄符号区」还是「宽字符区」
 *   · 宽字符占比    —— `)(|\/tfjrxnuv` 这类视觉上会连成一片的字符
 *   · 索引直方图    —— 看亮度分布
 *
 * 用法：node scripts/intro-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const enginePath = path.join(root, 'third_party/eyetutorial-replica/engine.js');

const code = fs.readFileSync(enginePath, 'utf8');
new Function(code)();
const engine = globalThis.EyeEngine;

const RAMP = engine.RAMP;
const NR = engine.RAMP.length - 1;

// 视觉上「会连成一片」的宽字符（ASCII 宽度 ≥1 格的近似集合）
const WIDE = new Set(['(', ')', '[', ']', '{', '}', '|', '/', '\\', 't', 'f', 'j', 'r', 'x', 'n', 'u', 'v', 'c', 'z', 'X', 'Y', 'U', 'J', 'C', 'L', 'Q', '0', 'O', 'Z', 'm', 'w', 'q', 'p', 'd', 'b', 'k', 'h', 'a', 'o', 'M', 'W', '8', '%', 'B', '@', '$']);

const PRESETS = {
  // Python 原版 renderer.py 的等价参数：没有 blur、没有色阶拉伸、全 70 档字阶
  orig: { smooth: 0, contrast: 0, levels: 0, hash: 0.07 },
  // 落地页当前在用
  cur: { smooth: 1, contrast: 1, levels: 0, hash: 0.02 },
  // 只关拉伸，其余照旧
  noContrast: { smooth: 1, contrast: 0, levels: 0, hash: 0.02 },
};

const TIMES = [0.4, 0.9, 3.5, 6.0, 9.0];
const CW = 8, CH = 17, ROWS = 30;

function stats(idx) {
  let blank = 0, wide = 0, sum = 0;
  const hist = new Array(NR + 1).fill(0);
  for (let p = 0; p < idx.length; p++) {
    const v = idx[p];
    hist[v]++;
    sum += v;
    if (v === 0) blank++;
    else if (WIDE.has(RAMP[v])) wide++;
  }
  const n = idx.length;
  return {
    blankPct: (blank / n * 100),
    widePct: (wide / n * 100),
    avgIdx: sum / n,
  };
}

function dump(idx, cols) {
  const rows = idx.length / cols;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) s += RAMP[idx[r * cols + c]];
    lines.push(s.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

const out = [];
for (const [name, opts] of Object.entries(PRESETS)) {
  const r = new engine.Renderer(CW, CH, ROWS, opts);
  out.push(`\n=========== preset: ${name}  ${JSON.stringify(opts)} ===========`);
  for (const t of TIMES) {
    r.reset();
    // 引擎内部按时间推进，reset 后逐帧喂时间以复现真实状态
    const f = r.render(t, 1 / 30);
    const s = stats(f.idx);
    out.push(
      `t=${String(t).padStart(5)}s  cols=${f.cols} rows=${f.rows}  ` +
      `空格 ${s.blankPct.toFixed(1)}%  宽字符 ${s.widePct.toFixed(1)}%  平均索引 ${s.avgIdx.toFixed(1)}`
    );
  }
}

// 导出文本帧：orig preset 在 t=3.5（睁眼后）与 t=6.0（推进中）
const framesDir = path.join(root, '.workbuddy/tmp/intro-frames');
fs.mkdirSync(framesDir, { recursive: true });
for (const t of [0.9, 3.5, 6.0]) {
  const r = new engine.Renderer(CW, CH, ROWS, PRESETS.orig);
  const f = r.render(t, 1 / 30);
  fs.writeFileSync(path.join(framesDir, `orig-t${String(t).replace('.', '_')}.txt`), dump(f.idx, f.cols), 'utf8');
  const r2 = new engine.Renderer(CW, CH, ROWS, PRESETS.cur);
  const f2 = r2.render(t, 1 / 30);
  fs.writeFileSync(path.join(framesDir, `cur-t${String(t).replace('.', '_')}.txt`), dump(f2.idx, f2.cols), 'utf8');
}
out.push(`\n文本帧已导出到 ${framesDir}`);

console.log(out.join('\n'));
