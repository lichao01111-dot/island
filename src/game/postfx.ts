// 后期处理:环境光遮蔽 + HDR 辉光 + 昼夜 LUT 色彩分级 + 暗角。
//
// 顺序很重要:
//   GTAO      —— 在辉光之前压暗接触处,否则 AO 会反过来吃掉自发光物体的辉光;
//   辉光      —— 必须发生在色调映射之前的线性 HDR 空间里(见下);
//   OutputPass —— 统一做 ACES 色调映射 + sRGB;
//   分级      —— 调色作用于"sRGB 显示空间",这是 LUT 的通用做法;
//               日/夜两张 LUT 按 daylight 平滑混合,让整屏色调跟着太阳走;
//   暗角      —— 最后叠,只做构图收束。
//
// three 的一个关键行为:材质只在"直接渲染到画布"时才做色调映射
// (WebGLPrograms 里 toneMapping 取决于 currentRenderTarget === null)。
// 合成器渲染进 render target,所以材质会跳过色调映射,
// 由末尾的 OutputPass 统一处理 —— 中间的辉光因此拿到的是线性 HDR 值。
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildGradeLut, GRADE_PRESETS, GRADE_NIGHT, GRADE_DUSK, type GradeName } from './lut';

const LUT_SIZE = 32;

// 昼夜分级:采样日/黄昏/夜三张 3D LUT,按 uNight/uDusk 混合。
// 比单张 LUT 多两次 3D 采样,换来了"天色一变整屏跟着变"的昼夜氛围 —— 动森级画面的关键一层。
const TimeOfDayGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDayLut: { value: null as THREE.Texture | null },
    tDuskLut: { value: null as THREE.Texture | null },
    tNightLut: { value: null as THREE.Texture | null },
    uLutSize: { value: LUT_SIZE },
    uNight: { value: 0 },
    uDusk: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler3D tDayLut;
    uniform sampler3D tDuskLut;
    uniform sampler3D tNightLut;
    uniform float uLutSize;
    uniform float uNight;
    uniform float uDusk;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // 内缩半个像素,让采样从边缘像素中心开始
      float pw = 1.0 / uLutSize;
      float hpw = 0.5 / uLutSize;
      vec3 uvw = vec3(hpw) + c * (1.0 - pw);
      vec3 day = texture(tDayLut, uvw).rgb;
      vec3 dusk = texture(tDuskLut, uvw).rgb;
      vec3 night = texture(tNightLut, uvw).rgb;
      vec3 graded = mix(day, night, clamp(uNight, 0.0, 1.0));
      graded = mix(graded, dusk, clamp(uDusk, 0.0, 1.0));
      gl_FragColor = vec4(graded, 1.0);
    }
  `,
};

// 顶部暖光 + 暗角 + 极轻胶片颗粒。色相/对比/饱和/昼夜冷调都交给 LUT,
// 这里只保留构图上的两件事 + 抗色带的抖动(天空/海面渐变在 8bit 下容易 banding)。
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.2 },
    uTopGlow: { value: 0.1 },
    uGrain: { value: 0.02 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uTopGlow;
    uniform float uGrain;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // 顶部暖光:模拟画面外的天光溢进来
      c += uTopGlow * smoothstep(0.42, 1.0, vUv.y) * vec3(1.0, 0.94, 0.77);
      // 暗角:把注意力收到画面中心
      vec2 d = vUv - 0.5;
      float vig = 1.0 - uVignette * dot(d, d) * 2.4;
      c *= clamp(vig, 0.0, 1.0);
      // 固定粒度的抖动,专治平滑渐变 banding;幅度极小,不当成风格
      float n = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uGrain;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
};

export interface PostFxOptions {
  /** 是否启用环境光遮蔽。桌面默认开;?qa-noao=1 可关。 */
  ao?: boolean;
  /** 白天色彩分级预设。默认动森粉彩;?qa-grade=current 切回旧调子。 */
  grade?: GradeName;
  /** 角色描边。默认开;?qa-nooutline=1 可关。 */
  outline?: boolean;
  /** 要描边的对象(通常是主角 group) */
  outlineTargets?: THREE.Object3D[];
}

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
  /** 按光照状态更新后期:daylight=0..1(白昼量),dusk=0..1(日出日落权重)。
   *  夜里辉光更强、分级切向月光冷调;黄昏时整屏切向金色暖调。 */
  setTimeOfDay(daylight: number, dusk: number): void;
  setAoEnabled(on: boolean): void;
  /** 环境光遮蔽强度(0..1+,默认 0.85),实时可调 */
  setAoStrength(value: number): void;
  /** 辉光基础强度(默认 0.62),实时可调 */
  setBloomStrength(value: number): void;
  setGrade(name: GradeName): void;
  /** 角色描边开关,实时可调 */
  setOutlineEnabled(on: boolean): void;
  readonly enabled: boolean;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: PostFxOptions = {}
): PostFx {
  const size = renderer.getSize(new THREE.Vector2());

  // HalfFloat:辉光要读到 1.0 以上的值,普通 8 位缓冲会把它们直接截断
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,          // MSAA:低多边形全是硬边,锯齿在这套画面里特别显眼
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  // GTAO:给"物与物、物与地"之间补上接触遮蔽。低多边形+平涂色没有 AO 会显得发飘。
  // blendIntensity 是遮蔽强度;半分辨率计算,近无损、省一半填充。
  const ao = new GTAOPass(scene, camera, size.x, size.y);
  ao.blendIntensity = 0.72;
  ao.enabled = options.ao !== false;
  composer.addPass(ao);
  const halfW = Math.max(1, Math.floor(size.x / 2));
  const halfH = Math.max(1, Math.floor(size.y / 2));
  ao.setSize(halfW, halfH);

  // 辉光在半分辨率上算:视觉上看不出差别,填充成本减到四分之一
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(halfW, halfH),
    0.62,   // strength
    0.7,    // radius
    1.0     // threshold:只有超过 1 的地方才发光,也就是真正的自发光体
  );
  composer.addPass(bloom);
  bloom.setSize(halfW, halfH);

  // OutputPass 负责色调映射(读 renderer.toneMapping)与色彩空间转换
  composer.addPass(new OutputPass());

  // 昼夜分级,作用于 sRGB 显示空间
  const grade = new ShaderPass(TimeOfDayGradeShader);
  grade.uniforms.tDayLut.value = buildGradeLut(GRADE_PRESETS[options.grade ?? 'ac']);
  grade.uniforms.tDuskLut.value = buildGradeLut(GRADE_DUSK);
  grade.uniforms.tNightLut.value = buildGradeLut(GRADE_NIGHT);
  composer.addPass(grade);

  const vignette = new ShaderPass(VignetteShader);
  composer.addPass(vignette);

  // 角色描边:让主角在茂密植被里"跳出来"。只圈 selectedObjects,不碰场景其它物体。
  // 用暗暖棕、低强度 —— 是"更清晰的剪影"而不是硬黑描边,别做成三渲二。
  const outline = new OutlinePass(new THREE.Vector2(size.x, size.y), scene, camera);
  outline.selectedObjects = options.outlineTargets ?? [];
  outline.visibleEdgeColor.set('#4a3a2e');
  outline.hiddenEdgeColor.set('#1a1208');
  outline.edgeStrength = 2.2;
  outline.edgeThickness = 1.2;
  outline.enabled = options.outline !== false && (options.outlineTargets?.length ?? 0) > 0;
  composer.addPass(outline);

  let baseStrength = 0.62;
  let nightAmount = 0;
  return {
    enabled: true,
    render() { composer.render(); },
    setSize(width: number, height: number) {
      composer.setSize(width, height);
      const hw = Math.max(1, Math.floor(width / 2));
      const hh = Math.max(1, Math.floor(height / 2));
      bloom.setSize(hw, hh);
      ao.setSize(hw, hh);
    },
    setTimeOfDay(daylight: number, dusk: number) {
      nightAmount = Math.max(0, Math.min(1, 1 - daylight * 2.2));
      bloom.strength = baseStrength + nightAmount * 0.5;
      grade.uniforms.uNight.value = nightAmount;
      grade.uniforms.uDusk.value = Math.max(0, Math.min(1, dusk));
    },
    setAoEnabled(on: boolean) { ao.enabled = on; },
    setAoStrength(value: number) { ao.blendIntensity = value; },
    setBloomStrength(value: number) {
      baseStrength = value;
      bloom.strength = value + nightAmount * 0.5;
    },
    setGrade(name: GradeName) { grade.uniforms.tDayLut.value = buildGradeLut(GRADE_PRESETS[name]); },
    setOutlineEnabled(on: boolean) { outline.enabled = on; },
  };
}
