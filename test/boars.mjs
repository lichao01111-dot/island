import esbuild from 'esbuild';

const build = await esbuild.build({
  entryPoints: ['src/world/boars.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node', target: 'es2020',
});
const source = build.outputFiles[0].text;
const { createBoars, updateBoar } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function assert(condition, message) { if (!condition) throw new Error(message); }

const boar = createBoars(1)[0];
const player = { x: boar.group.position.x, y: 0, z: boar.group.position.z };
assert(updateBoar(boar, 0.016, player, false, []) === false && !boar.group.visible,
  '野猪白天应隐藏且不攻击');

assert(updateBoar(boar, 0.016, player, true, []) === false && boar.windup > 0,
  '近身后应先进入攻击前摇');
assert(updateBoar(boar, 0.5, player, true, []) === true,
  '攻击前摇结束且玩家仍在范围内时才造成伤害');

boar.group.position.set(0.5, 0, 0);
const before = Math.hypot(boar.group.position.x, boar.group.position.z);
updateBoar(boar, 0.5, { x: 0, y: 0, z: 0 }, true, [{ x: 0, z: 0, repel: 9 }]);
const after = Math.hypot(boar.group.position.x, boar.group.position.z);
assert(after > before, '燃烧篝火应驱赶野猪');

// 威慑半径逐个生效:野猪站在篝火半径外、灯塔半径内时,仍然要被赶走
boar.group.position.set(12, 0, 0);
updateBoar(boar, 0.5, { x: 12, y: 0, z: 0 }, true, [{ x: 0, z: 0, repel: 9 }]);
assert(Math.abs(Math.hypot(boar.group.position.x, boar.group.position.z) - 12) < 1.5,
  '篝火(半径 9)不该影响 12 米外的野猪');
boar.group.position.set(12, 0, 0);
updateBoar(boar, 0.5, { x: 12, y: 0, z: 0 }, true, [{ x: 0, z: 0, repel: 15 }]);
assert(Math.hypot(boar.group.position.x, boar.group.position.z) > 12,
  '灯塔(半径 15)应把 12 米外的野猪也赶开');

console.log('野猪行为测试全部通过 ✔');
