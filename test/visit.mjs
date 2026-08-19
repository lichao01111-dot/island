// 参观模式依赖"同一个岛屿种子长出同一座岛"。这里守住这条不变式。
import esbuild from 'esbuild';

async function load(entry) {
  const build = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false,
    format: 'esm', platform: 'node', target: 'es2020',
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const { scatterResources } = await load('src/world/props.ts');
const { rng } = await load('src/world/rng.ts');

function assert(condition, message) { if (!condition) throw new Error(message); }

const layout = (list) => list.map((r) => `${r.kind}:${r.x.toFixed(3)},${r.z.toFixed(3)}`).join('|');

// 同种子 → 同布局。岛主和访客各自本地生成,必须长得一样
const a = scatterResources(12345);
const b = scatterResources(12345);
assert(a.length === b.length && a.length > 0, '同种子应生成同样数量的资源');
assert(layout(a) === layout(b), '同种子应生成完全相同的资源布局');

// 不同种子 → 不同布局,否则种子就是摆设
assert(layout(scatterResources(99)) !== layout(a), '不同种子应生成不同的资源布局');

// 三种资源都要出现,别因为改了随机源把某一类挤没了
const kinds = new Set(a.map((r) => r.kind));
assert(kinds.has('wood') && kinds.has('fiber') && kinds.has('stone'),
  '木材/纤维/石料三种资源都应被放置');

// 种子随机数本身:同种子同序列、不同种子不同序列、值域在 [0,1)
const seq = (seed) => Array.from({ length: 8 }, rng(seed));
assert(JSON.stringify(seq(7)) === JSON.stringify(seq(7)), '同种子应产生同一串随机数');
assert(JSON.stringify(seq(7)) !== JSON.stringify(seq(8)), '不同种子应产生不同的随机数');
assert(seq(7).every((n) => n >= 0 && n < 1), '随机数应落在 [0,1)');

console.log('岛屿种子与参观一致性测试全部通过 ✔');
