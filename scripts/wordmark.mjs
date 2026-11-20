// 手写体字形生成器：输出「Persist」字形 path + 完整 <svg> 块。
//
// 这是落地页手写标题的**唯一事实源** —— 页面里的 <svg> 块由本脚本产出后
// 直接粘贴（手抄进 HTML 出过错：P 的路径和生成器对不上、viewBox 算错）。
//
// 用法：node scripts/wordmark.mjs
//   → .workbuddy/tmp/wordmark-block.html   粘贴用的 <svg> 块
//   → .workbuddy/tmp/letter-audit.html     逐字母放大审查页
//   → .workbuddy/tmp/word-preview.html     整词预览
//
// 改完字形后必须：① 单独放大审查每个字母；② 按落地页实际显示宽度（460px）
// 再看整词 —— 单看正常、缩到整词就糊成一团的情况很常见。
// 坐标系：基线 y=0，x-height 顶 y=-100，ascender y=-150。向上为负。
//
// 倾斜用 <g transform="skewX(-11)">（沿用 2026-11-19 上一版的写法）：
//   skewX 是仿射变换 x' = x + y·tan(-11°)，可以直接对控制点换算，
//   所以本脚本用同一套公式算 viewBox —— 上一版 viewBox 的左边多留了约 52px
//   空档（符号算反），整词因此偏右；这里按正确符号算紧。
import fs from 'node:fs';

const SLANT = -11;                       // 度，负值 = 向右倾（italic）
const TAN = Math.tan(SLANT * Math.PI / 180);

const WORD = 'Persist';

// 每个字母：adv = 前进宽度（下一个字母的 translate 偏移），paths = 笔画。
// 路径是**未倾斜**的原始坐标，倾斜由 <g transform="skewX(-11)"> 统一施加。
const LETTERS = {
  // P：大写。竖笔 + 一笔画完的碗形（上游 eyeTutrial 的 Round 眼型同源的手绘感）。
  P: { adv: 65, paths: [
    'M 4,0 C 6,-52 8,-112 10,-158 C 42,-166 60,-148 58,-124 C 56,-102 32,-92 12,-94',
  ]},
  // e：横杠 + 从横杠右端绕顶绕底的弧（两笔）。
  e: { adv: 65, paths: [
    'M -2,-56 L 46,-56',
    'M 46,-56 C 46,-84 34,-102 18,-100 C 2,-98 -6,-76 0,-56 C 6,-30 26,-16 44,-32',
  ]},
  // r：竖笔 + 高位肩部（肩部停在高处，不能像 n 那样落到基线）。
  r: { adv: 37, paths: [
    'M 2,0 C 3,-30 5,-60 7,-92',
    'M 7,-92 C 12,-99 24,-97 28,-86',
  ]},
  // s：上下两环一笔连写，尾巴收在上方。
  s: { adv: 39, paths: [
    'M 32,-88 C 24,-102 0,-102 0,-84 C 0,-68 30,-70 30,-46 C 30,-26 8,-16 0,-32',
  ]},
  // i：竖笔 + 点（点做成一小段干净短划，不要像逗号）。
  i: { adv: 25, paths: [
    'M 0,0 C 2,-32 3,-66 4,-100',
    'M 6,-118 C 9,-126 16,-127 19,-122',
  ]},
  // t：长竖 + 短尾 + 横画。
  t: { adv: 42, paths: [
    'M 12,-142 C 8,-104 5,-56 5,-24 C 5,-8 20,-4 30,-16',
    'M -10,-96 C 8,-102 24,-100 38,-94',
  ]},
};
// 第二个 s 复用同一个字形
LETTERS.s2 = LETTERS.s;

const ORDER = ['P', 'e', 'r', 's', 'i', 's2', 't'];

// 把一条 path 的控制点坐标解析出来（不改变 path 本身，只为算包围盒）。
function points(d) {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

// 施加 skewX 之后的包围盒（控制点即极值，bezier 不会超出控制点凸包）。
function skewedBBox(items, pad) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const it of items) {
    for (const [x, y] of points(it.d)) {
      const sx = x + it.tx + y * TAN;      // skewX: x' = x + y·tan(θ)
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return {
    x0: x0 - pad, y0: y0 - pad,
    x1: x1 + pad, y1: y1 + pad,
  };
}

function build() {
  const items = [];
  let x = 0;
  for (const key of ORDER) {
    const L = LETTERS[key];
    for (const d of L.paths) items.push({ d, tx: x });
    x += L.adv;
  }
  return { items, width: x };
}

function svgBlock(items, label) {
  const b = skewedBBox(items, 10);
  const inner = items.map(p =>
    `        <path class="wm-path" d="${p.d}"${p.tx ? ` transform="translate(${p.tx},0)"` : ''}></path>`
  ).join('\n');
  return `<svg class="wordmark" id="wordmark" viewBox="${b.x0.toFixed(1)} ${b.y0.toFixed(1)} ${(b.x1 - b.x0).toFixed(1)} ${(b.y1 - b.y0).toFixed(1)}" role="img" aria-label="${label}">
      <g transform="skewX(${SLANT})">
${inner}
      </g>
    </svg>`;
}

fs.mkdirSync('.workbuddy/tmp', { recursive: true });

const built = build();
const block = svgBlock(built.items, WORD);
fs.writeFileSync('.workbuddy/tmp/wordmark-block.html', block, 'utf8');

const SVG_ATTRS = 'fill="none" stroke="#467692" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"';

// 整词预览：按落地页实际显示宽度看一遍
let words = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f4f7f9;font:12px ui-monospace,monospace;color:#467692;
  display:flex;flex-direction:column;gap:18px;padding:24px}
svg{border:1px solid #dfe5eb;border-radius:12px;background:#fff}
</style></head><body>`;
words += `<div><div>当前字形（460px，与落地页一致）</div>${block.replace('class="wordmark"', `class="wordmark" ${SVG_ATTRS} style="width:460px"`)}</div>`;
words += `<div><div>当前字形（900px，看细节）</div>${block.replace('class="wordmark"', `class="wordmark" ${SVG_ATTRS} style="width:900px"`)}</div>`;
words += `</body></html>`;
fs.writeFileSync('.workbuddy/tmp/word-preview.html', words, 'utf8');

// 逐字审查
let audit = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f4f7f9;font:12px ui-monospace,monospace;color:#467692;
  display:flex;flex-wrap:wrap;gap:14px;padding:20px}
figure{margin:0;text-align:center;background:#fff;border:1px solid #dfe5eb;border-radius:14px;padding:10px}
svg{border:1px solid #eef2f6;border-radius:8px;background:#fbfcfd}
</style></head><body>`;
for (const key of ORDER) {
  const L = LETTERS[key];
  const items = L.paths.map(d => ({ d, tx: 0 }));
  const b = skewedBBox(items, 12);
  audit += `<figure><svg width="200" height="250" viewBox="${b.x0.toFixed(1)} ${b.y0.toFixed(1)} ${(b.x1 - b.x0).toFixed(1)} ${(b.y1 - b.y0).toFixed(1)}" fill="none" stroke="#467692" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round">`;
  audit += `<g transform="skewX(${SLANT})">`;
  for (const it of items) audit += `<path d="${it.d}"/>`;
  audit += `</g></svg><figcaption>${key === 's2' ? 's' : key}</figcaption></figure>`;
}
audit += `</body></html>`;
fs.writeFileSync('.workbuddy/tmp/letter-audit.html', audit, 'utf8');

console.log('viewBox:', block.match(/viewBox="([^"]+)"/)[1]);
console.log('word width:', built.width, '| paths:', built.items.length);
