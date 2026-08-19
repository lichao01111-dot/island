import * as THREE from 'three';
import { ISLAND_RADIUS, islandHeight } from './island';

// 野猪的活动范围必须跟着岛走。写死成 23 的话,岛一放大就变成一堵看不见的墙:
// 玩家跑到外圈,野猪追到某条圆弧上就再也过不来了
const ROAM_RADIUS = ISLAND_RADIUS - 4;

export interface Boar {
  group: THREE.Group;
  angle: number;
  attackCooldown: number;
  windup: number;
}

function mesh(): THREE.Group {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: '#5c4131', flatShading: true, roughness: 0.96 });
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), fur);
  body.scale.set(1.35, 0.8, 0.85); body.position.y = 0.85; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), fur);
  head.position.set(0, 0.85, 0.95); head.castShadow = true; g.add(head);
  const tuskMat = new THREE.MeshBasicMaterial({ color: '#f0dfbd' });
  for (const x of [-0.38, 0.38]) {
    const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 5), tuskMat);
    tusk.position.set(x, 0.62, 1.38); tusk.rotation.x = Math.PI / 2; g.add(tusk);
  }
  const dark = new THREE.MeshBasicMaterial({ color: '#1e1713' });
  for (const x of [-0.23, 0.23]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), dark);
    eye.position.set(x, 1.03, 1.42); g.add(eye);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 4), fur);
    ear.position.set(x * 1.45, 1.35, 1.0); ear.rotation.z = x > 0 ? -0.35 : 0.35; g.add(ear);
  }
  const legGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.6, 5);
  for (const x of [-0.48, 0.48]) for (const z of [-0.48, 0.48]) {
    const leg = new THREE.Mesh(legGeo, fur); leg.position.set(x, 0.35, z); g.add(leg);
  }
  return g;
}

export function createBoars(count = 3): Boar[] {
  return Array.from({ length: count }, (_, i) => {
    const group = mesh();
    const a = i / count * Math.PI * 2;
    group.position.set(Math.cos(a) * ROAM_RADIUS * 0.8, 0, Math.sin(a) * ROAM_RADIUS * 0.8);
    group.position.y = islandHeight(group.position.x, group.position.z);
    group.visible = false;
    return { group, angle: a, attackCooldown: 0, windup: -1 };
  });
}

export function updateBoar(
  boar: Boar, dt: number, player: THREE.Vector3, isNight: boolean,
  // 威慑源各有各的半径:篝火护住一个营地,灯塔护住半座岛
  repelSources: Array<{ x: number; z: number; repel: number }>
): boolean {
  boar.group.visible = isNight;
  if (!isNight) { boar.windup = -1; return false; }
  boar.attackCooldown = Math.max(0, boar.attackCooldown - dt);
  const p = boar.group.position;
  const playerDx = player.x - p.x, playerDz = player.z - p.z;
  const playerD = Math.hypot(playerDx, playerDz);
  let dx = playerDx, dz = playerDz;
  let speed = playerD < 14 ? 2.5 : 1.1;
  if (playerD >= 14) {
    boar.angle += dt * 0.28;
    dx = Math.cos(boar.angle); dz = Math.sin(boar.angle);
  }
  let fleeing = false;
  for (const source of repelSources) {
    const fd = Math.hypot(p.x - source.x, p.z - source.z);
    if (fd < source.repel) {
      dx = p.x - source.x; dz = p.z - source.z;
      speed = 5; fleeing = true; boar.windup = -1;
      break;
    }
  }
  if (!fleeing && boar.windup >= 0) {
    boar.windup -= dt;
    const pulse = 1 + Math.sin(Math.max(0, boar.windup) * 30) * 0.08;
    boar.group.scale.set(pulse, pulse, pulse);
    if (boar.windup <= 0) {
      boar.windup = -1; boar.attackCooldown = 1.5; boar.group.scale.setScalar(1);
      return playerD < 2.1;
    }
    return false;
  }
  const len = Math.hypot(dx, dz) || 1;
  p.x += dx / len * speed * dt; p.z += dz / len * speed * dt;
  const d = Math.hypot(p.x, p.z);
  if (d > ROAM_RADIUS) { p.x *= ROAM_RADIUS / d; p.z *= ROAM_RADIUS / d; }
  p.y = islandHeight(p.x, p.z);
  boar.group.rotation.y = Math.atan2(dx, dz);
  if (Math.hypot(player.x - p.x, player.z - p.z) < 1.5 && boar.attackCooldown <= 0) {
    boar.windup = 0.45;
  }
  return false;
}
