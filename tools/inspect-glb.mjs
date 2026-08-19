// 检查一个 GLB 是否符合 ASSETS.md 里的交付约定。
// 用法:node tools/inspect-glb.mjs web/assets/xxx.glb
//
// 接外部资产时最常见的三个问题都在这儿一次看清:
// 尺度对不对(1 单位 = 1 米)、原点在不在底面、动画片段叫什么名字。
import esbuild from 'esbuild';
import fs from 'node:fs/promises';

// GLTFLoader 假定自己在浏览器里(内部会碰 self)。Node 里补上即可
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const target = process.argv[2];
if (!target) {
  console.error('用法: node tools/inspect-glb.mjs <file.glb>');
  process.exit(1);
}

const build = await esbuild.build({
  stdin: {
    contents: `
      export * as THREE from 'three';
      export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
    `,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
});
const { THREE, GLTFLoader } = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`
);

const buf = await fs.readFile(target);
const gltf = await new GLTFLoader().parseAsync(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ''
);

const box = new THREE.Box3().setFromObject(gltf.scene);
let verts = 0;
let skinned = 0;
const materials = new Set();
const textures = new Set();
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  verts += o.geometry.attributes.position.count;
  if (o.isSkinnedMesh) skinned++;
  materials.add(o.material.name || o.material.type);
  if (o.material.map) textures.add(o.material.map.name || 'map');
});

console.log(JSON.stringify({
  文件: target,
  大小MB: +(buf.byteLength / 1024 / 1024).toFixed(2),
  尺寸_宽高深: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
    .map((v) => +v.toFixed(2)),
  底面y: +box.min.y.toFixed(3),
  顶点数: verts,
  蒙皮网格数: skinned,
  材质: [...materials],
  贴图: [...textures],
  动画数: gltf.animations.length,
  片段名: gltf.animations.map((a) => a.name),
}, null, 1));
