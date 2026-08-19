// 把当前的程序化道具导出成 GLB,放进 web/assets/reference/。
//
// 用途有两个,都很实际:
//   1. 证明"加载 glTF"这条链路真的通 —— 用真文件跑,而不是假设它能工作
//   2. 给美术一个基准文件。尺度、朝向、原点在哪,打开就看得见,
//      不用靠文档描述去猜"一米是多少""正面朝哪"
//
// 用法:node tools/export-reference-glb.mjs
import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

// three 的 GLTFExporter 假定自己跑在浏览器里。没有贴图时它不碰 DOM,
// 但二进制导出这条路会用 FileReader —— 而 Node 不把它放在全局。
// 缺了它 parse() 的回调永远不触发,表现为整个脚本静默挂住(不是报错),很难查。
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); });
    }
  };
}

const ENTRY = `
  export * as THREE from 'three';
  export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
  export { createResource } from './src/world/props.ts';
`;

const build = await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
});
const mod = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`
);
const { GLTFExporter, createResource } = mod;

const OUT_DIR = path.join(process.cwd(), 'web', 'assets', 'reference');
await fs.mkdir(OUT_DIR, { recursive: true });

const exporter = new GLTFExporter();
const targets = [
  ['palm', 'wood'],
  ['bush', 'fiber'],
  ['rock', 'stone'],
];

for (const [name, kind] of targets) {
  // visual 是可见部分(不含接地阴影那张贴片),正是要交给美术替换的那一层
  const { visual } = createResource(kind, 0, 0);
  visual.position.set(0, 0, 0);
  visual.rotation.set(0, 0, 0);
  visual.updateMatrixWorld(true);

  const buffer = await new Promise((resolve, reject) => {
    exporter.parse(visual, resolve, reject, { binary: true });
  });
  const file = path.join(OUT_DIR, `${name}.glb`);
  await fs.writeFile(file, Buffer.from(buffer));
  console.log(`导出 ${path.relative(process.cwd(), file)}  ${(buffer.byteLength / 1024).toFixed(1)} KB`);
}

console.log('\n这些文件是"当前程序化几何体"的快照,不是目标质量。');
console.log('美术请以它们为基准:同样的尺度、同样的朝向、原点落在模型底面中心。');
