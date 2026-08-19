// 野兽的场景表现。逻辑在 beasts.ts,这里只管看得见的部分。
import * as THREE from 'three';
import { BEAST_DEFS, SHELL_ARC, type Beast } from './beasts';

export interface BeastView {
  group: THREE.Group;
  /** 壳。蓄力时鼓一下,被挡下时闪一下白 */
  shell: THREE.Mesh;
  legs: THREE.Group;
  blockFlash: number;
  hurtFlash: number;
  walkPhase: number;
}

const SHELL_COLOR = '#b4553d';
const SHELL_HURT = '#ffd9c6';

/** 礁蟹。宽、扁、贴地 —— 一眼看出它跑不快,但正面不好惹 */
function crabMesh(): { group: THREE.Group; shell: THREE.Mesh; legs: THREE.Group } {
  const group = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: SHELL_COLOR, flatShading: true, roughness: 0.62 });
  const limbMat = new THREE.MeshStandardMaterial({ color: '#8c3f2e', flatShading: true, roughness: 0.8 });
  const dark = new THREE.MeshBasicMaterial({ color: '#1d1512' });

  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.62, 7, 5), shellMat);
  shell.scale.set(1.32, 0.52, 1.0);
  shell.position.y = 0.44;
  shell.castShadow = true;
  group.add(shell);

  // 眼柄:朝向靠它读出来。没有这个,俯视角下根本看不出蟹面朝哪边
  for (const x of [-0.2, 0.2]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.28, 5), limbMat);
    stalk.position.set(x, 0.66, 0.42);
    group.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 5), dark);
    eye.position.set(x, 0.82, 0.42);
    group.add(eye);
  }

  // 一对大螯朝前:正面的"这里有壳、别硬来"就是靠它俩说的
  for (const x of [-0.66, 0.66]) {
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.46), limbMat);
    claw.position.set(x, 0.36, 0.5);
    claw.rotation.y = x > 0 ? -0.4 : 0.4;
    claw.castShadow = true;
    group.add(claw);
    const pincer = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 4), limbMat);
    pincer.position.set(x * 1.14, 0.36, 0.78);
    pincer.rotation.x = Math.PI / 2;
    group.add(pincer);
  }

  const legs = new THREE.Group();
  const legGeo = new THREE.BoxGeometry(0.09, 0.09, 0.52);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(legGeo, limbMat);
      leg.position.set(side * 0.62, 0.2, -0.34 + i * 0.3);
      leg.rotation.y = side * (0.9 + i * 0.16);
      legs.add(leg);
    }
  }
  group.add(legs);
  return { group, shell, legs };
}

export function createBeastView(beast: Beast): BeastView {
  const { group, shell, legs } = crabMesh();
  group.userData.beastKind = beast.kind;
  return { group, shell, legs, blockFlash: 0, hurtFlash: 0, walkPhase: Math.random() * Math.PI * 2 };
}

/**
 * 把野兽摆到该在的地方,并演出它此刻的状态。
 * 三种反馈各自对应一件玩家必须看懂的事:
 *   蓄力 → 鼓起来        "再不走就要挨打了"
 *   被挡 → 壳闪白 + 不掉血 "别从正面砍"
 *   受伤 → 整只后仰       "这下打进去了"
 */
export function updateBeastView(
  view: BeastView, beast: Beast, dt: number, groundY: number
): void {
  if (beast.hp <= 0) { view.group.visible = false; return; }
  view.group.visible = true;
  view.group.position.set(beast.x, groundY, beast.z);
  view.group.rotation.y = beast.facing;

  view.blockFlash = Math.max(0, view.blockFlash - dt * 3);
  view.hurtFlash = Math.max(0, view.hurtFlash - dt * 3);

  const mat = view.shell.material as THREE.MeshStandardMaterial;
  mat.color.set(SHELL_COLOR).lerp(new THREE.Color(SHELL_HURT), Math.max(view.blockFlash, view.hurtFlash));

  // 蓄力:整只鼓起来 + 微微前倾。和野猪用的是同一种语言(脉冲缩放),
  // 玩家在主岛上已经学过这个信号了
  if (beast.windup >= 0) {
    const p = 1 + Math.sin(Math.max(0, beast.windup) * 26) * 0.11;
    view.group.scale.set(p, p, p);
    view.group.position.z += 0;
  } else {
    view.group.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 8));
    // 走动时腿左右摆一下。不摆的话它像块滑行的石头
    view.walkPhase += dt * 7;
    view.legs.rotation.z = Math.sin(view.walkPhase) * 0.12;
  }
  // 受伤后仰
  view.group.rotation.x = -view.hurtFlash * 0.3;
}

/** 打在壳上:闪白但不掉血 */
export function flashBlocked(view: BeastView): void { view.blockFlash = 1; }
export function flashHurt(view: BeastView): void { view.hurtFlash = 1; }

/** 调试/校准用:壳的保护角有多大 */
export const SHELL_ARC_DEG = Math.round((SHELL_ARC * 180) / Math.PI);

/** 野兽死了以后留在原地的一小堆战利品提示用不到网格,直接复用 effects —— 这里只提供定义 */
export function beastName(beast: Beast): string { return BEAST_DEFS[beast.kind].name; }
