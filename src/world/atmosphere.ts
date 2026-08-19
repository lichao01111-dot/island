// 轻量环境层:海面碎光、远方岛影与鸟群。
// 只使用少量合并/实例化几何体,不依赖贴图或 DOM,移动端也能常驻。
import * as THREE from 'three';

export interface Atmosphere {
  group: THREE.Group;
  /** t 为累计秒数;daylight 为 0..1;下雨时会自动收敛高光与鸟群。 */
  update(t: number, daylight: number, raining: boolean): void;
}

const TAU = Math.PI * 2;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// 固定种子:分享/参观同一座岛时,氛围层不会每次刷新都换位置。
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

interface WaterLightLayer {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/**
 * 海面亮纹只有一张小网格、一个 draw call。
 * 外海是细长的暖色日光碎片,近岸是更宽、更冷的交叉焦散。
 */
function buildWaterLights(random: () => number): WaterLightLayer {
  const positions: number[] = [];
  const uvs: number[] = [];
  const phases: number[] = [];
  const kinds: number[] = [];
  const indices: number[] = [];

  const addPatch = (
    x: number, z: number, halfWidth: number, halfLength: number,
    rotation: number, kind: 0 | 1, phase: number
  ) => {
    const base = positions.length / 3;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const corners: Array<[number, number, number, number]> = [
      [-halfWidth, -halfLength, 0, 0],
      [halfWidth, -halfLength, 1, 0],
      [halfWidth, halfLength, 1, 1],
      [-halfWidth, halfLength, 0, 1],
    ];
    for (const [localX, localZ, u, v] of corners) {
      positions.push(
        x + localX * cos - localZ * sin,
        0.2,
        z + localX * sin + localZ * cos
      );
      uvs.push(u, v);
      phases.push(phase);
      kinds.push(kind);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // 日光碎片大致同向,让它们读成水面反光,而不是随机撒在海上的白纸屑。
  for (let i = 0; i < 34; i++) {
    const angle = random() * TAU;
    const radius = 31 + Math.pow(random(), 0.72) * 64;
    addPatch(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0.07 + random() * 0.12,
      0.65 + random() * 1.55,
      0.12 + (random() - 0.5) * 0.38,
      0,
      random() * TAU
    );
  }

  // 浅滩焦散:较少、较宽,陆地深度会自然遮掉越过海岸的部分。
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * TAU + (random() - 0.5) * 0.2;
    const radius = 28.2 + random() * 6.1;
    addPatch(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0.65 + random() * 0.65,
      0.5 + random() * 0.75,
      angle + random() * 1.2,
      1,
      random() * TAU
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    // ShaderMaterial 不会像内置材质那样自动附带雾参数；fog:true 时必须显式合并，
    // 否则 WebGLRenderer 在同步 fogColor/fogNear 时会读取到 undefined 并中断主循环。
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uVisibility: { value: 0 },
        uRain: { value: 0 },
      },
    ]),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: true,
    vertexShader: /* glsl */`
      attribute float aPhase;
      attribute float aKind;
      uniform float uTime;
      varying vec2 vPatchUv;
      varying float vPhase;
      varying float vKind;
      #include <fog_pars_vertex>

      void main() {
        vec3 transformed = position;
        float radius = length(transformed.xz);
        float shore = clamp((radius - 26.0) / 60.0, 0.0, 1.0);
        shore = shore * shore * (3.0 - 2.0 * shore);
        // 必须与 island.ts 的 GPU 海浪振幅一致，碎光才不会在肩后镜头里浮离水面。
        float amplitude = 0.055 + shore * 0.305;

        // 和主海面使用同一组三向波,亮纹因此会贴住浪峰而不是浮在空中。
        float wave = sin(transformed.x * 0.075 + uTime * 1.05) * amplitude;
        wave += sin(transformed.z * 0.058 - uTime * 0.78) * amplitude * 0.8;
        wave += sin((transformed.x + transformed.z) * 0.17 + uTime * 1.9) * amplitude * 0.28;
        transformed.y = wave + mix(0.075, 0.095, aKind);

        vPatchUv = uv;
        vPhase = aPhase;
        vKind = aKind;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uVisibility;
      uniform float uRain;
      varying vec2 vPatchUv;
      varying float vPhase;
      varying float vKind;
      #include <fog_pars_fragment>

      void main() {
        vec2 p = vPatchUv * 2.0 - 1.0;

        float across = pow(max(0.0, 1.0 - abs(p.x)), 5.0);
        float along = pow(max(0.0, 1.0 - abs(p.y)), 0.7);
        float sparkle = 0.18 + 0.82 * pow(
          0.5 + 0.5 * sin(uTime * 3.1 + vPhase), 3.0
        );
        float glint = across * along * sparkle;

        float edge = smoothstep(0.0, 0.17, vPatchUv.x)
          * smoothstep(0.0, 0.17, 1.0 - vPatchUv.x)
          * smoothstep(0.0, 0.17, vPatchUv.y)
          * smoothstep(0.0, 0.17, 1.0 - vPatchUv.y);
        float lineA = 1.0 - smoothstep(
          0.035, 0.18,
          abs(sin((vPatchUv.x * 1.7 + vPatchUv.y) * 6.283 + uTime * 0.62 + vPhase))
        );
        float lineB = 1.0 - smoothstep(
          0.035, 0.18,
          abs(sin((vPatchUv.x - vPatchUv.y * 1.35) * 6.283 - uTime * 0.47 + vPhase * 0.7))
        );
        float caustic = max(lineA, lineB) * edge
          * (0.58 + 0.42 * sin(uTime * 0.9 + vPhase));

        float isCaustic = step(0.5, vKind);
        float mask = mix(glint * 0.82, caustic * 0.24, isCaustic);
        vec3 sunny = mix(vec3(1.0, 0.88, 0.54), vec3(0.69, 0.96, 1.0), isCaustic);
        vec3 rainy = mix(vec3(0.70, 0.87, 0.91), vec3(0.58, 0.82, 0.87), isCaustic);
        vec3 color = mix(sunny, rainy, uRain);
        float alpha = mask * uVisibility;
        if (alpha < 0.004) discard;

        gl_FragColor = vec4(color, alpha);
        #include <fog_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water glints and caustics';
  mesh.renderOrder = 2.5; // 海面(1)、浅水(2)之后,海岸浪花(3)之前。
  mesh.frustumCulled = true;
  return { mesh, material };
}

interface IslandLayer {
  rocks: THREE.InstancedMesh;
  foliage: THREE.InstancedMesh;
  rockMaterial: THREE.MeshBasicMaterial;
  foliageMaterial: THREE.MeshBasicMaterial;
}

interface IslandSpec {
  angle: number;
  radius: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
}

function buildDistantIslands(random: () => number): IslandLayer {
  // 环绕一圈,保证俯视和任意朝向的越肩视角都至少能看到一组远景。
  const specs: IslandSpec[] = [
    { angle: -2.72, radius: 112, width: 20, depth: 13, height: 8, rotation: 0.3 },
    { angle: -1.63, radius: 139, width: 31, depth: 18, height: 14, rotation: -0.2 },
    { angle: -0.58, radius: 126, width: 18, depth: 12, height: 7, rotation: 0.7 },
    { angle: 0.46, radius: 157, width: 34, depth: 21, height: 15, rotation: -0.45 },
    { angle: 1.53, radius: 121, width: 19, depth: 13, height: 9, rotation: 0.1 },
    { angle: 2.48, radius: 148, width: 27, depth: 17, height: 12, rotation: 0.55 },
  ];

  const rockMaterial = new THREE.MeshBasicMaterial({ color: '#698a91', fog: true });
  const foliageMaterial = new THREE.MeshBasicMaterial({ color: '#315b57', fog: true });
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const foliageGeometry = new THREE.DodecahedronGeometry(1, 0);
  const lobeCount = specs.length * 3;
  const foliagePerIsland = 4;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, lobeCount);
  const foliage = new THREE.InstancedMesh(
    foliageGeometry,
    foliageMaterial,
    specs.length * foliagePerIsland
  );
  rocks.name = 'distant island silhouettes';
  foliage.name = 'distant island foliage';
  rocks.castShadow = rocks.receiveShadow = false;
  foliage.castShadow = foliage.receiveShadow = false;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let rockIndex = 0;
  let foliageIndex = 0;
  const lobeLayout: Array<[number, number, number]> = [
    [0, 0, 1],
    [-0.38, 0.08, 0.72],
    [0.36, -0.07, 0.65],
  ];

  for (const spec of specs) {
    const centerX = Math.cos(spec.angle) * spec.radius;
    const centerZ = Math.sin(spec.angle) * spec.radius;
    const cos = Math.cos(spec.rotation);
    const sin = Math.sin(spec.rotation);

    for (const [offset, depthOffset, size] of lobeLayout) {
      const localX = offset * spec.width;
      const localZ = depthOffset * spec.depth;
      const scaleY = spec.height * 0.52 * size;
      dummy.position.set(
        centerX + localX * cos - localZ * sin,
        -1.35 + scaleY * 0.56,
        centerZ + localX * sin + localZ * cos
      );
      dummy.rotation.set(
        (random() - 0.5) * 0.14,
        spec.rotation + (random() - 0.5) * 0.3,
        (random() - 0.5) * 0.09
      );
      dummy.scale.set(
        spec.width * 0.43 * size,
        scaleY,
        spec.depth * 0.44 * size
      );
      dummy.updateMatrix();
      rocks.setMatrixAt(rockIndex, dummy.matrix);
      // 远侧小块稍亮,雾中仍能读出叠层而不是一整块剪纸。
      tint.setScalar(0.82 + size * 0.17);
      rocks.setColorAt(rockIndex, tint);
      rockIndex++;
    }

    for (let i = 0; i < foliagePerIsland; i++) {
      const localX = (random() - 0.5) * spec.width * 0.56;
      const localZ = (random() - 0.5) * spec.depth * 0.38;
      const crown = 1.55 + random() * 1.35;
      dummy.position.set(
        centerX + localX * cos - localZ * sin,
        spec.height * (0.57 + random() * 0.12),
        centerZ + localX * sin + localZ * cos
      );
      dummy.rotation.set(0, random() * TAU, 0);
      dummy.scale.set(crown * 1.55, crown * 0.72, crown * 1.2);
      dummy.updateMatrix();
      foliage.setMatrixAt(foliageIndex, dummy.matrix);
      tint.setScalar(0.8 + random() * 0.2);
      foliage.setColorAt(foliageIndex, tint);
      foliageIndex++;
    }
  }

  rocks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  // 实例分布半径远大于原始几何体;关闭错误的小包围盒裁剪仍然只需两个 draw call。
  rocks.frustumCulled = false;
  foliage.frustumCulled = false;
  return { rocks, foliage, rockMaterial, foliageMaterial };
}

interface BirdLayer {
  wings: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  update(t: number): void;
}

function buildBirds(): BirdLayer {
  // 一只鸟用左右两片三角翼;七只鸟仍然只有一个实例化 draw call。
  const birdCount = 7;
  const wingGeometry = new THREE.BufferGeometry();
  wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0.04, 0.04,
    0.28, -0.035, 0.32,
  ], 3));
  wingGeometry.setIndex([0, 1, 2]);
  wingGeometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    color: '#263b47',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    fog: true,
  });
  const wings = new THREE.InstancedMesh(wingGeometry, material, birdCount * 2);
  wings.name = 'circling bird flock';
  wings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wings.frustumCulled = false;
  wings.renderOrder = 4;

  // V 字队形:back 为落后领鸟的距离,lateral 为左右偏移。
  const formation: Array<[number, number, number]> = [
    [0, 0, 0],
    [2.4, -2.4, 0.4], [2.4, 2.4, -0.1],
    [4.6, -4.8, 0.8], [4.6, 4.8, 0.25],
    [6.8, -7.0, 1.0], [6.8, 7.0, 0.55],
  ];
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const yawQuaternion = new THREE.Quaternion();
  const flapQuaternion = new THREE.Quaternion();
  const wingQuaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);

  return {
    wings,
    material,
    update(t: number) {
      const orbit = t * 0.085;
      // 高度低于俯视相机、又高过树冠;椭圆也避开俯视相机常驻的 +Z 位置。
      const leaderX = Math.cos(orbit) * 28;
      const leaderZ = Math.sin(orbit) * 19;
      let forwardX = -Math.sin(orbit) * 28;
      let forwardZ = Math.cos(orbit) * 19;
      const forwardLength = Math.hypot(forwardX, forwardZ) || 1;
      forwardX /= forwardLength;
      forwardZ /= forwardLength;
      const rightX = forwardZ;
      const rightZ = -forwardX;
      const yaw = Math.atan2(-forwardX, -forwardZ);
      yawQuaternion.setFromAxisAngle(yAxis, yaw);

      for (let i = 0; i < birdCount; i++) {
        const [back, lateral, lift] = formation[i];
        position.set(
          leaderX + rightX * lateral - forwardX * back,
          13.8 + lift + Math.sin(t * 0.54 + i * 1.17) * 0.72,
          leaderZ + rightZ * lateral - forwardZ * back
        );
        const flap = Math.sin(t * 5.7 + i * 0.83) * 0.58;
        const span = 0.9 + (i % 3) * 0.08;
        const chord = 0.82 + (i % 2) * 0.08;
        for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
          const side = sideIndex === 0 ? -1 : 1;
          flapQuaternion.setFromAxisAngle(zAxis, flap * side);
          wingQuaternion.copy(yawQuaternion).multiply(flapQuaternion);
          scale.set(span * side, 1, chord);
          matrix.compose(position, wingQuaternion, scale);
          wings.setMatrixAt(i * 2 + sideIndex, matrix);
        }
      }
      wings.instanceMatrix.needsUpdate = true;
    },
  };
}

export function buildAtmosphere(): Atmosphere {
  const random = seededRandom(0x15a1d5);
  const group = new THREE.Group();
  group.name = 'ambient atmosphere';

  const waterLights = buildWaterLights(random);
  const islands = buildDistantIslands(random);
  const birds = buildBirds();
  group.add(islands.rocks, islands.foliage, waterLights.mesh, birds.wings);

  const rockNight = new THREE.Color('#203347');
  const rockDay = new THREE.Color('#6d8e96');
  const rockRain = new THREE.Color('#596f76');
  const foliageNight = new THREE.Color('#172a38');
  const foliageDay = new THREE.Color('#315d58');
  const foliageRain = new THREE.Color('#3d5354');

  return {
    group,
    update(t: number, daylight: number, raining: boolean) {
      const day = clamp01(daylight);
      const rain = raining ? 1 : 0;
      const sunVisibility = Math.pow(clamp01((day - 0.08) / 0.92), 1.25)
        * (raining ? 0.09 : 1);
      waterLights.material.uniforms.uTime.value = t;
      waterLights.material.uniforms.uVisibility.value = sunVisibility;
      waterLights.material.uniforms.uRain.value = rain;
      waterLights.mesh.visible = sunVisibility > 0.004;

      // 远景跟随昼夜/天气调色,之后再交给场景 Fog 做真实的距离融合。
      islands.rockMaterial.color.copy(rockNight).lerp(rockDay, day);
      islands.foliageMaterial.color.copy(foliageNight).lerp(foliageDay, day);
      if (raining) {
        islands.rockMaterial.color.lerp(rockRain, 0.78);
        islands.foliageMaterial.color.lerp(foliageRain, 0.8);
      }

      const birdVisibility = Math.pow(clamp01((day - 0.12) / 0.7), 0.8)
        * (raining ? 0 : 1);
      birds.wings.visible = birdVisibility > 0.01;
      birds.material.opacity = birdVisibility * 0.82;
      if (birds.wings.visible) birds.update(t);
    },
  };
}
