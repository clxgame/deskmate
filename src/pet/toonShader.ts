import * as THREE from "three";

/**
 * 卡通着色 —— 依据《鸣潮》UE4 工程的原始着色器源码移植。
 *
 * 参考实现（只读源码，未复制任何美术资产）：
 *   Engine/Shaders/Private/KuroLightingInclude.ush
 *     - GetToonMainLighting()  四象限二分阴影模型
 *     - GetRimLighting()       边缘光强度调制
 *   Engine/Shaders/Private/ToonCommon.ush
 *     - DualSpecularGGX_Toon() 双叶 GGX 卡通高光
 *   Content/.../M_CharacterOutline 的材质参数语义：
 *     UseVertexGreen_OutlineWidth / UseVertexColorB_InnerOutline /
 *     UseCurvature+CurvatureMin/Max/Strength / MaxOutlineWidth / OutlineHoldDistance
 *
 * 与原版的差异（无法获取的部分）：
 *   - 原版边缘光是屏幕空间深度描边，这里用 Fresnel 近似其形状，但沿用其亮度调制公式
 *   - View.KuroCharacter* 系列全局光照 uniform 由关卡环境提供，这里改为可调参数
 */

/**
 * 逐槽位参数 —— 菲比材质实例的真实数值。
 * 来源：MI_HYtuanzi_feibiFace / Hair / Item 及其 _OL 描边实例。
 * 二次来源交叉验证：初版由二进制 uasset FPropertyTag 解析（战役 2），
 * 后经 UE 编辑器 Python `MaterialEditingLibrary` 继承链解算全量 dump 复核并修正
 * （见 docs/ue-uasset-extraction.md 战役 5：Hair SpecularPower 20→5、Face ToonRimWidth
 * 0.04(插值估计)→0.05(真值)、Item SpecStrength 0.15→0.10）。
 * 颜色为线性空间原值；outlineColor = OutlineColor × OutlineColorTint。
 */
interface SlotParams {
  /** ShadowProcess：二分阴影分界位置 */
  shadowProcess: number;
  /** SolidShadowSaturation：暗部饱和度倍增（卡通暗部保持鲜艳的关键） */
  shadowSaturation: number;
  /** SpecStrength / SpecularPower */
  specStrength: number;
  specPower: number;
  /** ToonRimWidth（引擎为屏幕空间宽度，这里作为 Fresnel 强度基准） */
  rimWidth: number;
  /** SubsurfaceColor / SkinSubsurfaceColor（线性） */
  sss: readonly [number, number, number];
  /** OutlineWidth 相对 Face(0.11) 的比例 */
  outlineWidthFactor: number;
  /** OutlineColor × OutlineColorTint（线性） */
  outlineColor: readonly [number, number, number];
  /** _OL 描边实例的 UseCurvature StaticSwitch 真值：仅 Hair 为 true，Face/Item 均为 false */
  useCurvature: boolean;
}

const SLOT_PARAMS: Record<"face" | "hair" | "item", SlotParams> = {
  face: {
    shadowProcess: 0.3,
    shadowSaturation: 1.0,
    specStrength: 0.1,
    specPower: 20,
    // ToonRimWidth 真值 0.05（与 Hair 相同，非此前插值估计的 0.04）
    rimWidth: 0.05,
    sss: [0.93869, 0.60383, 0.40724],
    outlineWidthFactor: 1.0,
    outlineColor: [0.0708, 0.0196, 0.0179],
    useCurvature: false,
  },
  hair: {
    shadowProcess: 0.7,
    shadowSaturation: 1.4,
    specStrength: 0.2,
    // SpecularPower 真值 5.0（此前二进制解析记录的 20 有误，经继承链解算复核修正）
    specPower: 5,
    rimWidth: 0.05,
    sss: [0.878, 0.78199, 0.27481],
    outlineWidthFactor: 0.12 / 0.11,
    outlineColor: [0.005, 0.00487, 0.00487],
    useCurvature: true,
  },
  item: {
    shadowProcess: 0.5,
    shadowSaturation: 1.4,
    // SpecStrength 真值 0.10（此前记录的 0.15 有误）
    specStrength: 0.1,
    specPower: 15,
    rimWidth: 0.03,
    sss: [0.743, 0.743, 0.743],
    outlineWidthFactor: 0.1 / 0.11,
    outlineColor: [0.00729, 0.00471, 0.00432],
    useCurvature: false,
  },
};

function slotKeyOf(materialName: string): "face" | "hair" | "item" {
  const lower = materialName.toLowerCase();
  if (lower.includes("face")) return "face";
  if (lower.includes("hair")) return "hair";
  return "item";
}

export interface ToonOptions {
  /** 主光颜色（对应 View.KuroCharacterMainLightColor） */
  mainLightColor: THREE.Color;
  /** 环境/天光颜色（对应 View.KuroCharacterAmbientColor） */
  ambientColor: THREE.Color;
  /** 二分阴影分界位置 */
  shadowThreshold: number;
  /** 分界过渡宽度，越小越硬 */
  shadowSoftness: number;
  /** 次表面散射强度（View.KuroCharacterSSSIntensity） */
  sssIntensity: number;
  /** 主光水平角（度），对应材质参数 FaceLightYaw。0 = 正面打光 */
  lightYaw: number;
  /** 主光俯仰角（度） */
  lightPitch: number;
  /** 边缘光颜色（View.KuroCharacterRimColor） */
  rimColor: THREE.Color;
  /** 对应材质参数 ToonRimWidth */
  rimWidth: number;
  rimIntensity: number;
  /** 卡通高光强度 */
  specularIntensity: number;
  /** 材质参数 OutlineWidth */
  outlineWidth: number;
  /** 材质参数 OutlineColorTint */
  outlineColor: THREE.Color;
  /** 材质参数 CurvatureMin / CurvatureMax / CurvatureStrength */
  curvatureMin: number;
  curvatureMax: number;
  curvatureStrength: number;
  /** 材质参数 InnerOutlineMulti，配合顶点色 B 通道 */
  innerOutlineMulti: number;
}

export const DEFAULT_TOON_OPTIONS: ToonOptions = {
  // C_CharacterShadowCurve 真值：暗部/亮部比约 0.85→0.6，
  // 即环境光约为主光的 0.6~0.85 倍——远比典型三渲二亮，暗部只轻微压暗
  mainLightColor: new THREE.Color(1.0, 0.98, 0.95),
  ambientColor: new THREE.Color(0.72, 0.72, 0.78),
  shadowThreshold: 0.5,
  // ShadowWidth 材质真值 0.03（三槽一致）：过渡带极窄，接近硬切
  shadowSoftness: 0.03,
  sssIntensity: 0.5,
  lightYaw: 40,
  lightPitch: 30,
  rimColor: new THREE.Color(0xfff2f8),
  rimWidth: 0.4,
  rimIntensity: 1.0,
  specularIntensity: 0.5,
  outlineWidth: 0.0073,
  outlineColor: new THREE.Color(0x2b2028),
  curvatureMin: 0.0,
  curvatureMax: 1.0,
  // CurvatureStrength 真值 0.2（三槽一致，此前默认值 1.0 过强）
  curvatureStrength: 0.2,
  innerOutlineMulti: 1.0,
};

interface ToonUniforms {
  uMainLightColor: THREE.IUniform<THREE.Color>;
  uAmbientColor: THREE.IUniform<THREE.Color>;
  uShadowThreshold: THREE.IUniform<number>;
  uShadowSoftness: THREE.IUniform<number>;
  uSSSIntensity: THREE.IUniform<number>;
  uSSSColor: THREE.IUniform<THREE.Color>;
  uShadowSaturation: THREE.IUniform<number>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
  uRimColor: THREE.IUniform<THREE.Color>;
  uRimWidth: THREE.IUniform<number>;
  uRimIntensity: THREE.IUniform<number>;
  uSpecIntensity: THREE.IUniform<number>;
  uSpecPower: THREE.IUniform<number>;
  uShadowProcess: THREE.IUniform<number>;
  uAtlasScale: THREE.IUniform<number>;
  uAtlasOffset: THREE.IUniform<THREE.Vector2>;
}

interface OutlineUniforms {
  uOutlineWidth: THREE.IUniform<number>;
  uOutlineColor: THREE.IUniform<THREE.Color>;
  uCurvature: THREE.IUniform<THREE.Vector3>;
  uInnerMulti: THREE.IUniform<number>;
}

interface ToonSlot {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material | THREE.Material[];
  toonMaterial: THREE.MeshStandardMaterial;
  uniforms: ToonUniforms;
  isFace: boolean;
  slotKey: "face" | "hair" | "item";
}

const VERTEX_HEAD = /* glsl */ `
#ifdef HAS_COLOR1
attribute vec4 color_1;
#endif
varying float vInnerShade;
varying vec2 vToonUv;
uniform float uAtlasScale;
uniform vec2 uAtlasOffset;
`;

const VERTEX_BODY = /* glsl */ `
#ifdef HAS_COLOR1
  // COLOR_1.b 对应材质参数 UseVertexColorB_InnerOutline（内描边/暗部权重）
  vInnerShade = color_1.b;
#else
  vInnerShade = 0.0;
#endif
// 表情 atlas：把 [0,1] UV 压进 3x3 中的一格
vToonUv = uv * uAtlasScale + uAtlasOffset;
`;

const FRAGMENT_HEAD = /* glsl */ `
varying float vInnerShade;
varying vec2 vToonUv;
uniform vec3 uMainLightColor;
uniform vec3 uAmbientColor;
uniform float uShadowThreshold;
uniform float uShadowSoftness;
uniform float uSSSIntensity;
uniform vec3 uSSSColor;
uniform float uShadowSaturation;
uniform vec3 uLightDir;
uniform vec3 uRimColor;
uniform float uRimWidth;
uniform float uRimIntensity;
uniform float uSpecIntensity;
uniform float uSpecPower;
uniform float uShadowProcess;
// 脸部五官遮罩：在 map_fragment 阶段由贴图 alpha 反推得出（1=五官镂空区，0=皮肤），
// 在 FRAGMENT_BODY 末尾用于让五官绕过光照直出贴图原色。非 Face 槽位恒为 0。
float vFaceFeatureMask = 0.0;
`;

/**
 * KuroLightingInclude.ush : GetToonMainLighting() 的四象限模型。
 *
 * 原式核心：
 *   MainFrontDiffuse    = BaseColor * MainLight * lerp(BaseColor,1,AO)  // 阴影外亮面
 *   MainBackDiffuse     = Ambient + Subsurface                          // 阴影外暗面
 *   ShadowmapBaseColor  = lerp(Ambient, MainFrontDiffuse, 0.4)          // 阴影内亮面
 *   ShadowmapShadowColor= Ambient                                        // 阴影内暗面
 *   NonShadow = lerp(Back, Front, ShadowBlendFactor)
 *   Shadow    = lerp(ShadowShadow, ShadowBase, ShadowBlendFactor) + SSS
 *   Final     = lerp(Shadow, NonShadow, Shadowmap)
 *
 * 本实现无投影阴影图（Shadowmap），故取 Shadowmap = 1（恒在阴影外），
 * 保留 ShadowBlendFactor 驱动的亮/暗面二分，这是观感的主要来源。
 */
const FRAGMENT_BODY = /* glsl */ `
vec3 toonOutgoingLight;
{
  vec3 nrm = normalize( vNormal );
  vec3 viewDir = normalize( vViewPosition );

  // 主光方向：由 Yaw/Pitch 在视图空间构造（对应材质参数 FaceLightYaw）。
  // 不复用场景方向光，卡通着色需要独立可控的主光角度。
  vec3 lightDir = normalize( uLightDir );

  vec3 baseCol = diffuseColor.rgb;

  // --- ShadowBlendFactor：二分阴影的亮暗分界 ---
  // 原式由 Shadowmap 与 GToonShadowBlendFactor 共同决定；本实现无阴影图，
  // 改由 NdL 驱动。uShadowProcess 为该槽位材质实例的 ShadowProcess 真值
  //（Face=0.3 / Hair=0.7 / Item=0.5），uShadowThreshold 是全局微调偏移。
  float rawNdL = dot( nrm, lightDir );
  float ndl01 = rawNdL * 0.5 + 0.5;
  // 原式 ShadowProcess 语义：NdL 高于该值为亮面。ShadowWidth=0.03 为过渡带宽
  float pivot = clamp( uShadowProcess + ( uShadowThreshold - 0.5 ), 0.02, 0.98 );
  float shadowBlendFactor = smoothstep(
    pivot - uShadowSoftness,
    pivot + uShadowSoftness,
    ndl01 );
  // 顶点色 B 通道压暗（UseVertexColorB_InnerOutline）
  shadowBlendFactor *= mix( 1.0, 0.72, clamp( vInnerShade, 0.0, 1.0 ) );

  // --- 次表面散射（原式 SubsurfaceColor；颜色为材质实例真值） ---
  // GetToonMainLighting: SSSMainLightColor = lerp(Ambient*0.2, MainLight*0.5, Shadowmap)
  vec3 sssMainLight = uMainLightColor * 0.5;
  vec3 subsurface   = uSSSIntensity * sssMainLight * baseCol * uSSSColor;

  // --- 四象限（GetToonMainLighting 原式） ---
  // AmbientColor = BaseColor * KuroCharacterAmbientColor，并按 SolidShadowMask 压至 0.7~1
  vec3 ambient = baseCol * uAmbientColor;
  ambient *= mix( 0.7, 1.0, smoothstep( 0.0, 0.5, shadowBlendFactor ) );
  // 暗部饱和度提升（SolidShadowSaturation：Hair/Item=1.4，Face=1.0）——卡通暗部保持鲜艳的关键
  vec3 ambientGray = vec3( dot( ambient, vec3( 0.299, 0.587, 0.114 ) ) );
  ambient = mix( ambientGray, ambient, uShadowSaturation );

  vec3 mainFrontDiffuse = baseCol * uMainLightColor;             // 阴影外亮面
  vec3 mainBackDiffuse  = ambient + subsurface;                  // 阴影外暗面
  vec3 nonShadowColor   = mix( mainBackDiffuse, mainFrontDiffuse, shadowBlendFactor );

  vec3 toonColor = nonShadowColor;

  // --- 卡通高光（Blinn-Phong 阶梯化；SpecularPower/SpecStrength 为材质真值） ---
  vec3 halfDir = normalize( lightDir + viewDir );
  float NoH = clamp( dot( nrm, halfDir ), 0.0, 1.0 );
  float NoV = clamp( dot( nrm, viewDir ), 0.0, 1.0 );
  float NoL = clamp( rawNdL, 0.0, 1.0 );
  float spec = pow( NoH, uSpecPower );
  // 阶梯化：卡通高光是块状而非连续渐变
  spec = smoothstep( 0.35, 0.6, spec ) * uSpecIntensity * shadowBlendFactor;
  toonColor += spec * uMainLightColor;

  // --- 边缘光（GetRimLighting 的强度调制式） ---
  // rimDiffuse = (rawNdL+1)/2 ；NDL = smoothstep(-0.2,0,rawNdL)
  float rimDiffuse = ndl01;
  float NDL = smoothstep( -0.2, 0.0, rawNdL );
  float VdL = dot( lightDir, viewDir );
  // fresnelOffset=0.2, fresnelStrength=1.2
  float baseFresnel = 1.0 - NoV;
  float fresnelFactor = 1.2 * clamp( baseFresnel - 0.2, 0.0, 1.0 ) / 0.8;
  // shadowWidth=0.5：暗部边缘光更窄
  float widthAtten = ( smoothstep( 0.5, 1.0, -VdL ) + 1.0 )
                   * ( rimDiffuse * 0.5 + 0.5 );
  // shadowIntensity=0.2
  float intensityAtten = 0.4 * ( -VdL + 1.0 ) * ( NDL * 0.8 + 0.2 );
  float rimMask = pow( fresnelFactor, mix( 8.0, 1.2, clamp( uRimWidth, 0.0, 1.0 ) ) );
  rimMask *= widthAtten * intensityAtten;
  // NewRimColor: lightColorRamp * 0.1 * (14*smoothstep(1,0,BaseColor*1.2)+1) * BaseColor
  vec3 rimBoost = 14.0 * smoothstep( vec3( 1.0 ), vec3( 0.0 ), baseCol * 1.2 ) + 1.0;
  toonColor += uRimColor * 0.35 * rimBoost * baseCol * rimMask * clamp( uRimWidth * 2.0, 0.0, 2.0 ) * uRimIntensity;

  // --- 五官（眼睛/嘴巴）直出 ---
  // 团子的五官区域（贴图 alpha 镂空标记，见 map_fragment 注释）画的是真实瞳孔/眼白
  // 图案（贴图 RGB 本身就有细节，不是要替换掉的垃圾色）。这里只是让它绕过卡通光照
  // 管线——动漫渲染惯例是瞳孔/线稿不受光照影响，若让 baseCol 参与上面的二分阴影、
  // 高光、边缘光计算，色彩会被主光冲淡、和暗部阴影混在一起，糊成一片。
  // 直接用贴图原始颜色 baseCol（sRGB→linear 后的真实色，见 map_fragment 里已经
  // 乘进 diffuseColor 的 faceTex.rgb）覆盖，保留美术画的瞳孔颜色/高光。
  toonColor = mix( toonColor, baseCol, clamp( vFaceFeatureMask, 0.0, 1.0 ) );

  toonOutgoingLight = toonColor;
}
`;

function isStandard(m: THREE.Material): m is THREE.MeshStandardMaterial {
  return m instanceof THREE.MeshStandardMaterial;
}

/** 3x3 atlas：编号 0..8 行优先，左上为 0。 */
export function atlasOffset(tag: number): THREE.Vector2 {
  const index = Math.min(Math.max(Math.trunc(tag), 0), 8);
  return new THREE.Vector2((index % 3) / 3, Math.trunc(index / 3) / 3);
}

/** 由 Yaw/Pitch（度）构造视图空间主光方向。Yaw 0 = 正对相机。 */
function yawPitchToDir(yawDeg: number, pitchDeg: number): THREE.Vector3 {
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  ).normalize();
}

export class ToonShading {
  private readonly slots: ToonSlot[] = [];
  private readonly outlines: THREE.Mesh[] = [];
  private readonly outlineUniforms: OutlineUniforms[] = [];
  private readonly outlineMaterials: THREE.ShaderMaterial[] = [];
  private options: ToonOptions;
  private enabled = false;
  private expressionTag = 0;

  constructor(options: Partial<ToonOptions> = {}) {
    this.options = { ...DEFAULT_TOON_OPTIONS, ...options };
  }

  static isSupported(root: THREE.Object3D): boolean {
    let ok = false;
    root.traverse((node) => {
      const raw = (node as Partial<THREE.Mesh>).material;
      const list = Array.isArray(raw) ? raw : raw instanceof THREE.Material ? [raw] : [];
      for (const item of list) if (isStandard(item)) ok = true;
    });
    return ok;
  }

  attach(root: THREE.Object3D): void {
    this.detachInternal();

    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const raw = node.material;
      const base = Array.isArray(raw) ? raw[0] : raw;
      if (base === undefined || !isStandard(base)) return;

      const isFace = base.name.toLowerCase().includes("face");
      const slotKey = slotKeyOf(base.name);
      const sp = SLOT_PARAMS[slotKey];
      const toonMaterial = base.clone();
      toonMaterial.name = `${base.name}__toon`;
      // 卡通颜色是手工调校的最终输出，不做 ACES 色调映射
      //（原版走引擎自己的 Kuro tonemap LUT，ACES 会压亮度并去饱和）
      toonMaterial.toneMapped = false;

      const o = this.options;
      const uniforms: ToonUniforms = {
        uMainLightColor: { value: o.mainLightColor.clone() },
        uAmbientColor: { value: o.ambientColor.clone() },
        uShadowThreshold: { value: o.shadowThreshold },
        uShadowSoftness: { value: o.shadowSoftness },
        uSSSIntensity: { value: o.sssIntensity },
        uSSSColor: { value: new THREE.Color(...sp.sss) },
        uShadowSaturation: { value: sp.shadowSaturation },
        uLightDir: { value: yawPitchToDir(o.lightYaw, o.lightPitch) },
        uRimColor: { value: o.rimColor.clone() },
        // 该槽位 ToonRimWidth 真值（Face 0.05/Hair 0.05/Item 0.03）为屏幕空间宽度，
        // 这里以 Face/Hair 共享基准 0.05 折算成 Fresnel 强度比例，再乘全局 rimWidth
        uRimWidth: { value: o.rimWidth * (sp.rimWidth / 0.05) },
        uRimIntensity: { value: o.rimIntensity },
        uSpecIntensity: { value: o.specularIntensity * (sp.specStrength / 0.1) },
        uSpecPower: { value: sp.specPower },
        uShadowProcess: { value: sp.shadowProcess },
        uAtlasScale: { value: isFace ? 1 / 3 : 1 },
        uAtlasOffset: { value: isFace ? atlasOffset(this.expressionTag) : new THREE.Vector2(0, 0) },
      };

      const hasColor1 = node.geometry.getAttribute("color_1") !== undefined;

      toonMaterial.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        const guard = hasColor1 ? "#define HAS_COLOR1\n" : "";

        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\n${guard}${VERTEX_HEAD}`)
          .replace("#include <uv_vertex>", `#include <uv_vertex>\n${VERTEX_BODY}`);

        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
          // 直接替换 outgoingLight 的声明式：在同一作用域内先算卡通颜色再赋值。
          // 不能注入到 <opaque_fragment> 之前——gl_FragColor 在那里已写入。
          .replace(
            "vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;",
            `${FRAGMENT_BODY}\n\tvec3 outgoingLight = toonOutgoingLight;`,
          );

        if (isFace) {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            /* glsl */ `
            #ifdef USE_MAP
              vec4 faceTex = texture2D( map, vToonUv );
              // 团子脸部贴图用 alpha 通道标记"皮肤(alpha≈1) / 眼睛嘴巴镂空区(alpha≈0)"，
              // 但镂空区的 RGB 并不是垃圾底色——实测里面画着完整的瞳孔/眼白渐变
              //（例如左眼中心采样到 (100,116,166) 蓝紫、(255,170,204) 粉白高光，
              // 是美术画好的真实眼睛图案，只是被标记成了透明）。9 格 atlas 每格
              // 都是同一套五官画法配合不同的镂空形状（大眼/闭眼/X_X 等）表现表情。
              // 早期实现误把镂空区当"无意义脏色"，用单一纯色覆盖，结果丢光了瞳孔
              // 细节、变成一团死黑——这里改回直接用贴图 RGB，只用 alpha 记录
              // "这是五官区域"这一件事，供 FRAGMENT_BODY 末尾决定要不要跳过光照。
              vFaceFeatureMask = 1.0 - faceTex.a;
              diffuseColor.rgb *= faceTex.rgb;
            #endif
            `,
          );
        }
      };
      toonMaterial.customProgramCacheKey = () =>
        `toon-${isFace ? "face" : "body"}-${hasColor1 ? "c1" : "n"}`;

      this.slots.push({ mesh: node, originalMaterial: raw, toonMaterial, uniforms, isFace, slotKey });
    });
  }

  get available(): boolean {
    return this.slots.length > 0;
  }

  get hasFace(): boolean {
    return this.slots.some((s) => s.isFace);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    for (const slot of this.slots) {
      slot.mesh.material = enabled ? slot.toonMaterial : slot.originalMaterial;
    }
    if (enabled) this.buildOutlines();
    else this.clearOutlines();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setExpression(tag: number): void {
    this.expressionTag = Math.min(Math.max(Math.trunc(tag), 0), 8);
    const offset = atlasOffset(this.expressionTag);
    for (const slot of this.slots) {
      if (slot.isFace) slot.uniforms.uAtlasOffset.value.copy(offset);
    }
  }

  getExpression(): number {
    return this.expressionTag;
  }

  setOutlineWidth(width: number): void {
    this.options = { ...this.options, outlineWidth: width };
    // outlineUniforms 与 slots 同序创建，按槽位真值比例分别应用
    this.outlineUniforms.forEach((u, i) => {
      const slot = this.slots[i];
      const factor = slot === undefined ? 1 : SLOT_PARAMS[slot.slotKey].outlineWidthFactor;
      u.uOutlineWidth.value = width * factor;
    });
  }

  /** 运行时调整光照参数（对应原版由关卡环境提供的全局 uniform）。 */
  setLighting(patch: Partial<Pick<ToonOptions,
    "mainLightColor" | "ambientColor" | "shadowThreshold" | "shadowSoftness" |
    "rimColor" | "rimWidth" | "rimIntensity" | "specularIntensity" | "sssIntensity" |
    "lightYaw" | "lightPitch">>): void {
    this.options = { ...this.options, ...patch };
    const o = this.options;
    const dir = yawPitchToDir(o.lightYaw, o.lightPitch);
    for (const slot of this.slots) {
      const u = slot.uniforms;
      const sp = SLOT_PARAMS[slot.slotKey];
      u.uMainLightColor.value.copy(o.mainLightColor);
      u.uAmbientColor.value.copy(o.ambientColor);
      u.uShadowThreshold.value = o.shadowThreshold;
      u.uShadowSoftness.value = o.shadowSoftness;
      u.uSSSIntensity.value = o.sssIntensity;
      u.uLightDir.value.copy(dir);
      u.uRimColor.value.copy(o.rimColor);
      u.uRimWidth.value = o.rimWidth * (sp.rimWidth / 0.05);
      u.uRimIntensity.value = o.rimIntensity;
      u.uSpecIntensity.value = o.specularIntensity * (sp.specStrength / 0.1);
    }
  }

  getOptions(): ToonOptions {
    return { ...this.options };
  }

  /**
   * 外部贴图（如叠塔模式 LOD 重载）更新后，把原始材质的贴图引用同步到 toon 克隆材质。
   * toonMaterial 是 attach 时 clone 出来的，其 map/normalMap 与原始材质共享同一 Texture
   * 对象；当原始材质被替换成新的贴图对象后，克隆材质仍指向旧对象，需手动同步。
   */
  syncTextures(): void {
    for (const slot of this.slots) {
      const base = Array.isArray(slot.originalMaterial) ? slot.originalMaterial[0] : slot.originalMaterial;
      if (!(base instanceof THREE.MeshStandardMaterial)) continue;
      slot.toonMaterial.map = base.map;
      slot.toonMaterial.normalMap = base.normalMap;
      slot.toonMaterial.needsUpdate = true;
    }
  }

  /**
   * 反向法线外壳描边。移植自 M_CharacterOutline 的参数语义：
   *   - UseVertexGreen_OutlineWidth : COLOR_1.g 调制宽度
   *   - UseCurvature + CurvatureMin/Max/Strength : 曲率调制（用平滑法线与面法线夹角近似）
   *   - UseVertexColorB_InnerOutline + InnerOutlineMulti : 内描边加粗
   *   - MaxOutlineWidth : 宽度上限
   *   - TEXCOORD_1 存打包平滑法线（MF_DecodeOutlineNormal），硬边模型靠它挤出连续轮廓
   */
  private buildOutlines(): void {
    this.clearOutlines();
    const o = this.options;

    for (const slot of this.slots) {
      const geometry = slot.mesh.geometry;
      const hasWidth = geometry.getAttribute("color_1") !== undefined;
      const hasSmoothNormal = geometry.getAttribute("uv1") !== undefined;
      const sp = SLOT_PARAMS[slot.slotKey];

      const uniforms: OutlineUniforms = {
        // 各槽位 OutlineWidth 真值比例：Face 0.11 / Hair 0.12 / Item 0.10
        uOutlineWidth: { value: o.outlineWidth * sp.outlineWidthFactor },
        // OutlineColor × OutlineColorTint（材质实例真值，线性空间）
        uOutlineColor: { value: new THREE.Color(...sp.outlineColor) },
        // UseCurvature StaticSwitch 真值仅 Hair 为 true：Face/Item 强制 Strength=0 关闭曲率调制
        uCurvature: {
          value: new THREE.Vector3(o.curvatureMin, o.curvatureMax, sp.useCurvature ? o.curvatureStrength : 0),
        },
        uInnerMulti: { value: o.innerOutlineMulti },
      };

      const material = new THREE.ShaderMaterial({
        uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
        vertexShader: /* glsl */ `
          #include <common>
          #include <skinning_pars_vertex>
          ${hasWidth ? "attribute vec4 color_1;" : ""}
          ${hasSmoothNormal ? "attribute vec2 uv1;" : ""}
          uniform float uOutlineWidth;
          uniform vec3 uCurvature;
          uniform float uInnerMulti;

          void main() {
            #include <beginnormal_vertex>
            #include <skinbase_vertex>
            #include <skinnormal_vertex>
            #include <begin_vertex>
            #include <skinning_vertex>
            #include <project_vertex>

            vec3 extrudeNormal = objectNormal;

            ${hasSmoothNormal ? /* glsl */ `
            // MF_DecodeOutlineNormal: TEXCOORD_1 存 [-1,1] 的平滑法线 XY，Z 由单位长度还原
            vec2 packed = uv1;
            float zz = 1.0 - clamp( dot( packed, packed ), 0.0, 1.0 );
            vec3 smoothN = normalize( vec3( packed, sqrt( zz ) ) );
            // 曲率：平滑法线与面法线的偏离度，越大说明该处越尖锐
            float curvature = 1.0 - clamp( dot( smoothN, normalize( objectNormal ) ), 0.0, 1.0 );
            extrudeNormal = normalize( mix( objectNormal, smoothN, 0.85 ) );
            ` : `
            float curvature = 0.0;
            `}

            vec3 viewNormal = normalize( normalMatrix * extrudeNormal );

            float width = uOutlineWidth;
            ${hasWidth ? /* glsl */ `
            // UseVertexGreen_OutlineWidth
            width *= color_1.g;
            // UseVertexColorB_InnerOutline + InnerOutlineMulti
            width *= mix( 1.0, uInnerMulti, clamp( color_1.b, 0.0, 1.0 ) );
            ` : ""}

            // UseCurvature: 在 [CurvatureMin, CurvatureMax] 区间按 Strength 加宽
            float curveMask = smoothstep( uCurvature.x, max( uCurvature.y, uCurvature.x + 1e-4 ), curvature );
            width *= mix( 1.0, 1.0 + uCurvature.z, curveMask );

            // 按裁剪空间 w 缩放，保证屏幕上粗细不随距离变化
            gl_Position.xy += viewNormal.xy * width * gl_Position.w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uOutlineColor;
          void main() {
            gl_FragColor = vec4( uOutlineColor, 1.0 );
          }
        `,
        side: THREE.BackSide,
      });

      const outline =
        slot.mesh instanceof THREE.SkinnedMesh
          ? new THREE.SkinnedMesh(geometry, material)
          : new THREE.Mesh(geometry, material);

      if (outline instanceof THREE.SkinnedMesh && slot.mesh instanceof THREE.SkinnedMesh) {
        outline.bind(slot.mesh.skeleton, slot.mesh.bindMatrix);
        outline.bindMode = slot.mesh.bindMode;
      }
      outline.renderOrder = -1;
      outline.frustumCulled = false;
      outline.name = `${slot.mesh.name}__outline`;
      outline.matrixAutoUpdate = false;
      slot.mesh.add(outline);
      outline.matrix.identity();

      this.outlines.push(outline);
      this.outlineMaterials.push(material);
      this.outlineUniforms.push(uniforms);
    }
  }

  private clearOutlines(): void {
    for (const outline of this.outlines) outline.removeFromParent();
    this.outlines.length = 0;
    for (const material of this.outlineMaterials) material.dispose();
    this.outlineMaterials.length = 0;
    this.outlineUniforms.length = 0;
  }

  private detachInternal(): void {
    this.clearOutlines();
    for (const slot of this.slots) {
      slot.mesh.material = slot.originalMaterial;
      slot.toonMaterial.dispose();
    }
    this.slots.length = 0;
    this.enabled = false;
  }

  dispose(): void {
    this.detachInternal();
  }
}
