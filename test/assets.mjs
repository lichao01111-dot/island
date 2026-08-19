// 资产管线测试。
// 覆盖两件事:导出的参考 GLB 是不是真的能被解析,以及导入修正对不对 ——
// "模型埋进地里一半"是接外部资产时最常见的问题,必须有测试兜着。
import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const build = await esbuild.build({
  stdin: {
    contents: `
      export * as THREE from 'three';
      export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
      export { applyAssetCorrections } from './src/world/assets.ts';
    `,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
});
const { THREE, GLTFLoader, applyAssetCorrections } = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`
);

function assert(condition, message) { if (!condition) throw new Error(message); }

// ---- 导入修正:原点在包围盒中心的模型必须被抬到底面贴地 ----
{
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial());
  const root = new THREE.Group();
  root.add(mesh);                       // 盒子中心在原点 → 一半在地下
  applyAssetCorrections(root, { url: '', groundPivot: true });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  assert(Math.abs(box.min.y) < 1e-6, `底面应贴到 y=0,实际 ${box.min.y}`);
  assert(Math.abs(box.max.y - 4) < 1e-6, `高度应保持 4,实际 ${box.max.y}`);
}

// groundPivot 关闭时不该乱动
{
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial());
  const root = new THREE.Group();
  root.add(mesh);
  applyAssetCorrections(root, { url: '', groundPivot: false });
  assert(root.position.y === 0, '关闭 groundPivot 时不应移动模型');
}

// 缩放要在贴地之前生效,否则抬升量会按错误的尺寸算
{
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial());
  const root = new THREE.Group();
  root.add(mesh);
  applyAssetCorrections(root, { url: '', scale: 0.5, groundPivot: true });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  assert(Math.abs(box.min.y) < 1e-6, '缩放后底面仍应贴地');
  assert(Math.abs(box.max.y - 2) < 1e-6, `缩放应先于贴地生效,期望高 2,实际 ${box.max.y}`);
}

// yaw 修正
{
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  applyAssetCorrections(root, { url: '', yaw: Math.PI / 2 });
  assert(Math.abs(root.rotation.y - Math.PI / 2) < 1e-6, 'yaw 应被应用');
}

// ---- 参考 GLB:必须是能解析的合法 glTF ----
// 这些文件由 tools/export-reference-glb.mjs 生成,是交给美术的尺度/朝向基准。
// 它们解析不了的话,美术拿到的基准就是错的。
const refDir = path.join(process.cwd(), 'web', 'assets', 'reference');
const loader = new GLTFLoader();
let checked = 0;
for (const name of ['palm', 'bush', 'rock']) {
  const file = path.join(refDir, `${name}.glb`);
  const buf = await fs.readFile(file).catch(() => null);
  assert(buf, `缺少参考文件 ${name}.glb —— 先跑 node tools/export-reference-glb.mjs`);
  // parseAsync 直接吃 ArrayBuffer,不走网络,所以能在 Node 里跑
  const gltf = await loader.parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ''
  );
  let verts = 0;
  let hasColor = false;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    verts += o.geometry.attributes.position.count;
    if (o.geometry.attributes.color) hasColor = true;
  });
  assert(verts > 100, `${name}.glb 顶点太少(${verts}),导出可能是空的`);
  assert(hasColor, `${name}.glb 应带顶点色 —— 现在的道具靠顶点色区分材质`);

  // 基准文件自身必须已经是"原点在底面"的,美术照着做才不会错
  const box = new THREE.Box3().setFromObject(gltf.scene);
  assert(box.min.y > -0.35, `${name}.glb 的原点应大致落在底面,实际最低点 ${box.min.y.toFixed(2)}`);
  checked++;
}
assert(checked === 3, '三件参考资产都应通过检查');

console.log('资产管线测试全部通过 ✔');
