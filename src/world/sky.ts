// 天空:渐变穹顶 + 太阳/月亮圆盘 + 飘动的低多边形云
// 纯色背景是"程序员美术"最明显的破绽,渐变+云能立刻把画面撑起来
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const skyVert = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 三段渐变:地平线暖亮 → 中段主色 → 天顶深色,比两色渐变更像真实天空
const skyFrag = /* glsl */`
  uniform vec3 horizonColor;
  uniform vec3 midColor;
  uniform vec3 zenithColor;
  varying vec3 vWorld;
  void main() {
    float h = normalize(vWorld).y;
    // 地平线附近压缩渐变,天顶方向拉长,视觉上更自然
    float t = clamp(h, 0.0, 1.0);
    vec3 c = mix(horizonColor, midColor, smoothstep(0.0, 0.22, t));
    c = mix(c, zenithColor, smoothstep(0.18, 0.75, t));
    // 地平线以下(俯视时可见)继续用地平线色,避免出现黑边
    c = mix(horizonColor, c, smoothstep(-0.08, 0.02, h));
    gl_FragColor = vec4(c, 1.0);
  }
`;

export interface Sky {
  group: THREE.Group;
  dome: THREE.Mesh;
  sunDisc: THREE.Mesh;
  moonDisc: THREE.Mesh;
  clouds: THREE.Group;
  setPalette(horizon: THREE.Color, mid: THREE.Color, zenith: THREE.Color): void;
}

// 云朵材质全局共享(昼夜变色时只改这一个),几何体在构造时合并成单个 mesh
// → 每朵云 1 次 draw call,而不是每个球一次
const cloudMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff', vertexColors: true, transparent: true, opacity: 0.9, fog: false,
});

function makeCloud(): THREE.Mesh {
  // 3-5 个球体堆成蓬松形状,低多边形保持卡通硬边
  const lumps = 3 + Math.floor(Math.random() * 3);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < lumps; i++) {
    const r = 3.2 + Math.random() * 2.6;
    const geo = new THREE.DodecahedronGeometry(r, 0);
    geo.scale(1, 0.62, 1);
    geo.translate((i - lumps / 2) * 3.4 + Math.random() * 1.4, Math.random() * 1.5, Math.random() * 2.4);
    parts.push(geo);
  }
  const merged = mergeGeometries(parts) ?? parts[0];
  for (const p of parts) if (p !== merged) p.dispose();
  // 云底压冷灰、云顶偏暖白。纯白 BasicMaterial 不受光，近看会像悬空石块；
  // 用顶点色先建立体积，再由昼夜统一乘色，成本仍然只是一张材质。
  const pos = merged.attributes.position as THREE.BufferAttribute;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
  }
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) - minY) / Math.max(0.001, maxY - minY)));
    colors[i * 3] = 0.68 + t * 0.32;
    colors[i * 3 + 1] = 0.73 + t * 0.27;
    colors[i * 3 + 2] = 0.78 + t * 0.22;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(merged, cloudMaterial);
}

export function buildSky(): Sky {
  const group = new THREE.Group();

  const uniforms = {
    horizonColor: { value: new THREE.Color('#cfeaf6') },
    midColor: { value: new THREE.Color('#7fc9ee') },
    zenithColor: { value: new THREE.Color('#3f8fd6') },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(230, 32, 20),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: skyVert, fragmentShader: skyFrag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
  );
  group.add(dome);

  // 太阳:实心盘 + 外圈光晕
  const sunDisc = new THREE.Group() as unknown as THREE.Mesh;
  const sunCore = new THREE.Mesh(
    new THREE.CircleGeometry(5.8, 24),
    new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, fog: false })
  );
  const sunGlow = new THREE.Mesh(
    new THREE.CircleGeometry(13.5, 24),
    new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.32, fog: false })
  );
  sunGlow.position.z = -0.5;
  (sunDisc as unknown as THREE.Group).add(sunGlow, sunCore);
  group.add(sunDisc);

  // 月亮:冷白盘
  const moonDisc = new THREE.Group() as unknown as THREE.Mesh;
  const moonCore = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 20),
    new THREE.MeshBasicMaterial({ color: '#eef4ff', transparent: true, fog: false })
  );
  const moonGlow = new THREE.Mesh(
    new THREE.CircleGeometry(9, 20),
    new THREE.MeshBasicMaterial({ color: '#c9dcff', transparent: true, opacity: 0.26, fog: false })
  );
  moonGlow.position.z = -0.5;
  (moonDisc as unknown as THREE.Group).add(moonGlow, moonCore);
  group.add(moonDisc);

  // 云带:环绕岛屿的一圈,缓慢飘动
  const clouds = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const c = makeCloud();
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
    const r = 95 + Math.random() * 55;
    c.position.set(Math.cos(a) * r, 42 + Math.random() * 26, Math.sin(a) * r);
    c.rotation.y = -a;
    c.userData.angle = a;
    c.userData.radius = r;
    c.userData.speed = 0.006 + Math.random() * 0.008;
    clouds.add(c);
  }
  // 低层薄云专门服务越肩视角：高云在俯视相机上方投入再多也不会进入画面。
  for (let i = 0; i < 6; i++) {
    const c = makeCloud();
    const a = (i / 6) * Math.PI * 2 + 0.35 + Math.random() * 0.35;
    const r = 66 + Math.random() * 46;
    const s = 0.42 + Math.random() * 0.22;
    c.scale.set(s * 1.45, s * 0.62, s);
    c.position.set(Math.cos(a) * r, 18 + Math.random() * 12, Math.sin(a) * r);
    c.rotation.y = -a;
    c.userData.angle = a;
    c.userData.radius = r;
    c.userData.speed = 0.01 + Math.random() * 0.008;
    clouds.add(c);
  }
  group.add(clouds);

  return {
    group, dome, sunDisc, moonDisc, clouds,
    setPalette(horizon, mid, zenith) {
      uniforms.horizonColor.value.copy(horizon);
      uniforms.midColor.value.copy(mid);
      uniforms.zenithColor.value.copy(zenith);
    },
  };
}

// 天空跟随相机(穹顶永远包住视点)、日月按光照方向摆位、云飘动
export function updateSky(
  sky: Sky, dt: number, camPos: THREE.Vector3,
  sunDir: THREE.Vector3, moonDir: THREE.Vector3, daylight: number, overcast = 0
): void {
  sky.group.position.set(camPos.x, 0, camPos.z);

  const place = (disc: THREE.Mesh, dir: THREE.Vector3, dist: number) => {
    disc.position.copy(camPos).addScaledVector(dir, dist);
    disc.position.y = Math.max(-40, disc.position.y);
    disc.lookAt(camPos);
  };
  place(sky.sunDisc, sunDir, 190);
  place(sky.moonDisc, moonDir, 190);
  // 白天见太阳、夜里见月亮,交替淡入淡出
  (sky.sunDisc as unknown as THREE.Group).children.forEach((m) => {
    const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.opacity = (mat.userData.base ?? (mat.userData.base = mat.opacity || 1))
      * Math.min(1, daylight * 2.2) * (1 - overcast * 0.82);
  });
  (sky.moonDisc as unknown as THREE.Group).children.forEach((m) => {
    const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.opacity = (mat.userData.base ?? (mat.userData.base = mat.opacity || 1)) * Math.min(1, (1 - daylight) * 1.8);
  });

  for (const c of sky.clouds.children) {
    c.userData.angle += c.userData.speed * dt;
    const r = c.userData.radius;
    c.position.x = Math.cos(c.userData.angle) * r;
    c.position.z = Math.sin(c.userData.angle) * r;
    c.rotation.y = -c.userData.angle;
  }
  // 夜里云压暗:材质全局共享,只改一次
  const shade = 0.34 + daylight * 0.66;
  const cloudR = THREE.MathUtils.lerp(shade, 0.47, overcast);
  const cloudG = THREE.MathUtils.lerp(shade * 0.99, 0.55, overcast);
  const cloudB = THREE.MathUtils.lerp(shade * 0.97, 0.58, overcast);
  cloudMaterial.color.setRGB(cloudR, cloudG, cloudB);
  cloudMaterial.opacity = THREE.MathUtils.lerp(0.92, 0.98, overcast);
}
