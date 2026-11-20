// 手写体字形生成器：输出「persist」小写字形 path + 完整 <svg> 块。
//
// 这是落地页手写标题的**唯一事实源** —— 页面里的 <svg> 块由本脚本产出后
// 直接粘贴（手抄进 HTML 出过错：P 的路径和生成器对不上、viewBox 算错）。
//
// 用法：node scripts/wordmark.mjs
//   → .workbuddy/tmp/wordmark-block.html   粘贴用的 <svg> 块
//   → .workbuddy/tmp/letter-audit.html     逐字母放大审查页
//   → .workbuddy/tmp/word-preview.html     整词预览（含 r 的 4 个变体）
//
// 改完字形后必须：① 单独放大审查每个字母；② 按落地页实际显示宽度（460px）
// 再看整词 —— 单看正常、缩到整词就糊成一团的情况很常见。
// 坐标系：基线 y=0，x-height 顶 y=-100，ascender y=-150。向上为负。
//
// 关键：**倾斜直接烘焙进路径坐标**，不用 <g transform="skewX()">。
// 原因：skewX 是仿射变换，可以对控制点直接换算；而用 transform 时
// viewBox 必须额外补偿位移（t 的升部会被裁掉），且每帧多一次变换计算。
import fs from 'node:fs';

const SLANT = -11;                       // 度，负值 = 向右倾（italic）
const TAN = Math.tan(SLANT * Math.PI / 180);

const LETTERS = {
  // p：竖笔**下伸到基线以下** —— 小写 p 唯一可靠的识别特征。
  // 不下伸会读成大写 P（第一版就是这样）。
  p: { adv: 54, paths: [
    'M 1,36 C 2,6 3,-46 4,-99',
    'M 4,-98 C 24,-106 48,-98 48,-71 C 48,-43 25,-25 5,-31',
  ]},
  // e：横杠 + 从横杠右端绕顶绕底的弧（两笔）。
  // 底部收口必须张开（末端甩到右下），否则弧把横杠左端包住 → 读成 θ。
  e: { adv: 50, paths: [
    'M 0,-54 L 42,-54',
    'M 42,-54 C 42,-82 31,-101 17,-99 C 2,-97 -7,-76 0,-55 C 7,-30 28,-15 48,-30',
  ]},
  // r：修复版 —— 关键在于「肩部必须停在高处」，不能像 n 那样落到基线。
  // 旧版肩部接在竖笔顶端形成平滑拱形 → 读成 n。
  r: { adv: 36, paths: [
    'M 0,0 C 1,-30 2,-64 3,-98',
    'M 2,-98 C 10,-106 22,-105 28,-97 C 31,-93 29,-89 26,-92',
  ]},
  // s：下环**向左多甩一点**，尾巴收在上方 —— 否则整词缩到 460px 时
  // 上下两个环糊成一团，读成 y / g。
  s: { adv: 38, paths: [
    'M 30,-90 C 22,-103 0,-103 0,-85 C 0,-69 30,-72 31,-47 C 32,-27 12,-18 0,-30',
  ]},
  // i：竖笔 + 点（点做成一小段干净短划，不要像逗号）
  i: { adv: 22, paths: [
    'M 0,0 C 1,-30 2,-64 3,-100',
    'M 9,-123 C 12,-127 17,-127 19,-123',
  ]},
  // t：长竖 + 短尾 + 横画
  t: { adv: 42, paths: [
    'M 12,-142 C 8,-104 5,-56 5,-24 C 5,-8 20,-4 30,-16',
    'M -10,-96 C 8,-102 24,-100 38,-94',
  ]},
};

// r 的候选变体（放大审查用）
const R_VARIANTS = {
  rA: ['M 0,0 C 1,-30 2,-64 3,-98', 'M 2,-97 C 9,-107 23,-107 29,-99'],
  rB: ['M 0,0 C 1,-30 2,-64 3,-98', 'M 2,-98 C 12,-104 25,-98 27,-86'],
  rC: ['M 0,0 C 1,-30 2,-64 3,-98', 'M 1,-96 C 4,-108 12,-110 17,-102 C 19,-98 16,-95 13,-97 C 19,-104 26,-103 30,-97'],
  rD: ['M 0,0 C 1,-30 2,-64 3,-98', 'M 2,-98 C 10,-106 22,-105 28,-97 C 31,-93 29,-89 26,-92'],
};

const WORD = 'persist';

// 把一条 path 的所有坐标做仿射倾斜变换（skewX: x' = x + y*tan）。
// 注意：replace 的回调是**每个数字**触发一次，数字在 path 里交替出现
// x,y,x,y...，所以要按奇偶位分别输出变换后的 x′ 与未变的 y。
// 早先版本按「坐标对」输出，导致一半匹配拿到 undefined → SVG 解析中断 → 笔画断裂。
function skewPath(d){
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const coords = [];
  for (let i = 0; i < nums.length; i += 2){
    const x = nums[i], y = nums[i + 1];
    coords.push([(x + y * TAN).toFixed(2), y.toFixed(2)]);
  }
  let k = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, () => {
    const i = k++;
    return coords[Math.floor(i / 2)][i % 2];
  });
}

function build(letters){
  const paths = [];
  let x = 0;
  for (const ch of WORD){
    const L = letters[ch];
    for (const d of L.paths){
      paths.push({ d: skewPath(d), tx: x });
    }
    x += L.adv;
  }
  return { paths, width: x };
}

function bbox(paths){
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of paths){
    const nums = p.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    for (let i = 0; i < nums.length; i += 2){
      const px = nums[i] + p.tx, py = nums[i+1];
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  return { x0, x1, y0, y1 };
}

function svgBlock(paths, width, label){
  const pad = 10;
  const b = bbox(paths);
  const minX = Math.min(b.x0, 0) - pad;
  const maxX = Math.max(b.x1, width) + pad;
  const minY = b.y0 - pad;
  const maxY = b.y1 + pad;
  const inner = paths.map(p =>
    `        <path class="wm-path" d="${p.d}"${p.tx ? ` transform="translate(${p.tx},0)"` : ''}></path>`
  ).join('\n');
  return `<svg class="wordmark" id="wordmark" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX-minX).toFixed(1)} ${(maxY-minY).toFixed(1)}" role="img" aria-label="${label}">
${inner}
    </svg>`;
}

fs.mkdirSync('.workbuddy/tmp', { recursive: true });

const built = build(LETTERS);
const block = svgBlock(built.paths, built.width, 'persist');
fs.writeFileSync('.workbuddy/tmp/wordmark-block.html', block, 'utf8');

const SVG_ATTRS = 'fill="none" stroke="#467692" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"';

// 整词预览：当前 + 各 r 变体
let words = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f4f7f9;font:12px ui-monospace,monospace;color:#467692;
  display:flex;flex-direction:column;gap:18px;padding:24px}
svg{border:1px solid #dfe5eb;border-radius:12px;background:#fff}
</style></head><body>`;
words += `<div><div>当前字形（460px，与落地页一致）</div>${block.replace('class="wordmark"', `class="wordmark" ${SVG_ATTRS} style="width:460px"`)}</div>`;
words += `<div><div>当前字形（900px，看细节）</div>${block.replace('class="wordmark"', `class="wordmark" ${SVG_ATTRS} style="width:900px"`)}</div>`;
for (const [name, ps] of Object.entries(R_VARIANTS)){
  const L2 = { ...LETTERS, r: { adv: 36, paths: ps } };
  const b2 = build(L2);
  words += `<div><div>r = ${name}</div>${svgBlock(b2.paths, b2.width, 'persist').replace('class="wordmark"', `class="wordmark" ${SVG_ATTRS} style="width:460px"`)}</div>`;
}
words += `</body></html>`;
fs.writeFileSync('.workbuddy/tmp/word-preview.html', words, 'utf8');

// 逐字审查
let audit = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f4f7f9;font:12px ui-monospace,monospace;color:#467692;
  display:flex;flex-wrap:wrap;gap:14px;padding:20px}
figure{margin:0;text-align:center;background:#fff;border:1px solid #dfe5eb;border-radius:14px;padding:10px}
svg{border:1px solid #eef2f6;border-radius:8px;background:#fbfcfd}
</style></head><body>`;
for (const [ch, L] of Object.entries(LETTERS)){
  const sp = L.paths.map(d => skewPath(d));
  audit += `<figure><svg width="200" height="250" viewBox="-40 -180 130 250" fill="none" stroke="#467692" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">`;
  for (const d of sp) audit += `<path d="${d}"/>`;
  audit += `</svg><figcaption>${ch}</figcaption></figure>`;
}
audit += `</body></html>`;
fs.writeFileSync('.workbuddy/tmp/letter-audit.html', audit, 'utf8');

console.log('viewBox:', block.match(/viewBox="([^"]+)"/)[1]);
console.log('word width:', built.width, '| paths:', built.paths.length);
