// 天空环境光照(IBL):用一段渐变天空烘成 PMREM 环境贴图。
//
// 无贴图阶段这是最便宜的"天光":scene.environment 会同时提供
//   间接漫反射(天空色的环境光)和间接镜面(光滑表面的天空倒影)。
// 水面(roughness≈0.16)、石头、一切 PBR 材质因此接住天空的颜色,
// 而不是只靠直射光 + 半球环境光 —— 这是"大型游戏感"里很关键的一层。
import * as THREE from 'three';

export function buildSkyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();

  const geometry = new THREE.SphereGeometry(40, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color('#3d8ad4') },
      uHorizon: { value: new THREE.Color('#cfeaf6') },
      uGround: { value: new THREE.Color('#5f87a8') },
      uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
      uSun: { value: new THREE.Color('#fff2d0') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, h));
        c = mix(uGround, c, smoothstep(-0.12, 0.06, h));
        // 一个很窄的高光太阳,给镜面反射一个明确的高光方向
        float sunAmt = pow(max(dot(d, uSunDir), 0.0), 500.0);
        c += uSun * sunAmt * 8.0;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(geometry, material));

  const target = pmrem.fromScene(scene, 0.04);
  const texture = target.texture;

  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  return texture;
}
