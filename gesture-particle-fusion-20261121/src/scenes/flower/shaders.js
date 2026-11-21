/**
 * 粒子花的着色器 —— 只有两种状态：**成花** 与 **满屏散开**。
 *
 * `uDisperse` = 0：粒子聚成三层花瓣的花；= 1：粒子铺满整个视口。
 * 没有"花苞/张开度"这一维了（去掉后形态更干净，也不会在中间态糊成一团）。
 *
 * ## 花瓣层级怎么读出来
 *
 * 每层（`aLayer` 0/1/2）单独给：半径、抬升 z、方位错角、瓣宽系数、逐层亮度，
 * 加逐层错峰的扩散时序 —— 外圈先散、内圈后散，聚合时反过来。
 * 这样花瓣不是一个平面团，而是三圈能数得清的层次。
 *
 * ## 散射位置
 *
 * 用 `aSeed` 哈希直接铺满视口（`uScatterExtent` 由相机 FOV 反推），
 * 逐粒子阈值错峰（0..0.3），扩散/聚合是"一层层松开、一层层收回"，不是整体淡入淡出。
 */
export const FLOWER_VERT = /* glsl */ `
attribute vec3 aLocal;    // x=r 沿瓣长, y=lat 横向, z=cup 杯状深度
attribute float aDisperse; // 每颗粒子自己的扩散进度 0..1（JS 每帧平滑推进）
attribute vec4 aMeta;     // x=u 径向 0..1, y=v 横向 -1..1, z=rand, w=瓣宽归一
attribute float aPetal;   // 花瓣序号 0..petals-1
attribute float aLayer;   // 0/1/2 = 外/中/内层；-1 = 花蕊
attribute float aSeed;    // 0..1 每粒子唯一，用于散射分布

uniform float uDisperse;  // 扩散度（0 = 成花，1 = 满屏）
uniform float uScale;     // 整体缩放（手势"缩放"用）
uniform float uTime;
uniform float uSize;
uniform float uDpr;
uniform float uOpacity;
uniform float uPetals;
uniform vec2  uScatterExtent;
uniform vec2  uHand;
uniform float uHandActive;
uniform float uHandRadius;

varying float vU;
varying float vV;
varying float vWidth;
varying float vRand;
varying float vHand;
varying float vLayer;
varying float vRim;
varying float vFacing;
varying float vScatter;

const float PI  = 3.14159265;
const float TAU = 6.28318531;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  float u = aMeta.x;
  float rnd = aMeta.z;
  float isCore = step(aLayer, -0.5);
  float layer = max(aLayer, 0.0);

  // —— 花瓣局部坐标系（三层各自错开方位角）——
  float phi = (aPetal / uPetals) * TAU + layer * (PI / uPetals) * 0.5;
  vec3 e_r = vec3(cos(phi), sin(phi), 0.0);
  vec3 e_t = vec3(-sin(phi), cos(phi), 0.0);
  vec3 e_z = vec3(0.0, 0.0, 1.0);

  // —— 成花位置（局部坐标直接重建，层的差异都在 aLocal 里）——
  vec3 posFlower = vec3(aLocal.x * e_r + aLocal.y * e_t + aLocal.z * e_z) * uScale;
  if (isCore > 0.5) posFlower = vec3(aLocal) * uScale;

  // —— 散射位置：用种子哈希铺满视口 ——
  float h1 = hash11(aSeed * 113.0 + 1.7);
  float h2 = hash11(aSeed * 271.0 + 5.3);
  float h3 = hash11(aSeed * 419.0 + 9.1);
  vec3 posScatter = vec3(
    (h1 * 2.0 - 1.0) * uScatterExtent.x,
    (h2 * 2.0 - 1.0) * uScatterExtent.y,
    (h3 * 2.0 - 1.0) * 0.9
  );

  // —— 逐粒子扩散进度 ——
  // 这里不再由 uDisperse 统一算阈值（旧做法：粒子先等到自己的阈值再瞬间起步，
  // 看起来是一顿一顿的）。改成每颗粒子有独立的进度值 aDisperse，
  // 由 JS 每帧用不同的时间常数平滑推进（与圣诞树同一套做法），因此过渡是连续的。
  float dsp = clamp(aDisperse, 0.0, 1.0);

  vec3 pos = mix(posFlower, posScatter, dsp);

  // 扩散途中给一点外推力，读起来像"散开"而不是平移
  float burst = sin(PI * dsp);
  pos.xy += normalize(pos.xy + 1e-4) * 0.08 * burst;

  // —— 呼吸 ——
  float breathe = 1.0 + 0.012 * sin(uTime * 0.9 + rnd * 6.2831);
  pos *= breathe;

  // —— 手指视差 ——
  vec2 hand = uHand * 0.55;
  pos.xy += (hand - pos.xy * 0.3) * 0.12 * uHandActive;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  // 散开时点径要**变大**：粒子摊到整个画面后不再互相叠加，
  // 沿用成花时的小点径会细到看不见（这是"散开后太暗"的主因之一）
  float sizeBoost = mix(1.0, 1.22, dsp);
  gl_PointSize = uSize * uDpr * sizeBoost * (0.55 + 0.45 * rnd) * (2.2 / max(0.4, -mv.z));
  gl_PointSize *= mix(1.0, 1.25, isCore);
  gl_PointSize = clamp(gl_PointSize, 0.6, 72.0);

  vHand = uHandActive * smoothstep(uHandRadius, 0.0, distance(pos.xy, hand));
  vU = u;
  vV = aMeta.y;
  vWidth = aMeta.w;
  vRand = rnd;
  vLayer = layer / 2.0;
  vScatter = dsp;
  // 瓣缘高光只在成花时出现（散开时没有"瓣缘"）
  vRim = smoothstep(0.42, 1.0, abs(aMeta.y)) * smoothstep(0.5, 0.85, aMeta.w) * smoothstep(0.12, 0.7, u) * (1.0 - dsp);

  vec3 nView = normalize(normalMatrix * e_z);
  vec3 viewDir = normalize(-mv.xyz);
  vFacing = 0.72 + 0.28 * abs(dot(nView, viewDir));
}
`

export const FLOWER_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColCore;
uniform vec3  uColMid;
uniform vec3  uColTip;
uniform float uOpacity;
uniform vec3  uHandColor;
uniform vec3  uTint;

varying float vU;
varying float vV;
varying float vWidth;
varying float vRand;
varying float vHand;
varying float vLayer;
varying float vRim;
varying float vFacing;
varying float vScatter;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float d = length(pc);
  if (d > 0.5) discard;

  float core = smoothstep(0.5, 0.02, d);
  float halo = pow(core, 2.2);

  // 花蕊由 vWidth = -1 标记
  float isCore = step(vWidth, -0.5);
  float coreRadial = clamp(vV, 0.0, 1.0);
  float coreSoft = 1.0 - 0.9 * smoothstep(0.3, 1.0, coreRadial);

  // —— 配色：内层压暗一档，层级才分得开 ——
  vec3 col = mix(uColCore, uColMid, smoothstep(0.0, 0.5, vU));
  col = mix(col, uColTip, smoothstep(0.5, 1.0, vU));
  col *= 0.93 + 0.14 * hash11(vU * 31.0 + vRand * 17.0) * (0.5 + vRand);
  col *= mix(1.0, 0.72, vLayer);
  col = mix(col, uColCore, isCore);

  col *= 0.72 + 0.45 * smoothstep(0.55, 0.0, vU);
  col *= 1.0 + 0.28 * vRim;
  // 散开时提亮：花瓣态靠叠加出亮度，散开态只有单点，不提亮就灰
  col *= mix(1.0, 1.35, vScatter);

  col += uHandColor * vHand * 0.9;
  col *= 0.62 + 0.8 * halo;
  // 颜色选择器：整体乘色（保留内层压暗与逐粒子微扰）
  col *= uTint;

  float tipFade = 0.75 + 0.25 * smoothstep(1.0, 0.05, vU);
  float edgeFade = 0.84 + 0.16 * (1.0 - abs(vV));
  float narrowFade = 0.18 + 0.82 * smoothstep(0.0, 0.75, vWidth);
  // 花瓣基部全部挤在花心，三层叠六瓣，不压就会糊成一块过曝白 —— 这是"堆积感"的主因
  float centerThin = mix(0.34, 1.0, smoothstep(0.0, 0.42, vU));

  float alpha = core * (0.42 + 0.58 * halo) * uOpacity * tipFade * edgeFade * narrowFade * centerThin;
  alpha *= mix(0.2, 1.0, smoothstep(0.05, 0.45, vFacing));

  // 花蕊单独一条 alpha：它没有"瓣宽"，走 narrowFade 会被压成 0.18，花心就黑了
  float alphaCore = core * (0.5 + 0.5 * halo) * uOpacity * coreSoft * 0.62;
  alpha = mix(alpha, alphaCore, isCore);

  // —— 散开态单独一条 alpha ——
  // 花朵那套衰减（瓣宽窄处、瓣尖、花心减密）在散开后没有意义，还会把大多数粒子
  // 压到 0.2 亮度；而散开后粒子不再互相叠加，没有"叠加变亮"来兜底，于是整片发黑。
  // 所以散开时统一切到一条更亮、无位置衰减的 alpha。
  float alphaScatter = core * (0.58 + 0.42 * halo) * uOpacity;
  alpha = mix(alpha, alphaScatter, vScatter);

  gl_FragColor = vec4(col, alpha);
}
`
