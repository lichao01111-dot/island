// 玩家:Q 版卡通小人 + 两段式四肢走路动画。贴合地形高度行走
// 设计取向:相机离得远,所以放大头部与五官(可辨识度优先),
// 走路靠"肩胯反向扭转 + 膝肘弯曲 + 落步下沉"三件套撑出生动感。
import * as THREE from 'three';
import { ISLAND_RADIUS, islandHeight } from '../world/island';

const MAT = {
  skin: new THREE.MeshStandardMaterial({ color: '#f3bd91', flatShading: true, roughness: 0.78 }),
  shirt: new THREE.MeshStandardMaterial({ color: '#3479cf', flatShading: true, roughness: 0.92 }),
  pants: new THREE.MeshStandardMaterial({ color: '#30435d', flatShading: true, roughness: 0.96 }),
  hair: new THREE.MeshStandardMaterial({ color: '#5b3925', flatShading: true, roughness: 0.94 }),
  straw: new THREE.MeshStandardMaterial({ color: '#e2bd70', flatShading: true, roughness: 0.98 }),
  strawDark: new THREE.MeshStandardMaterial({ color: '#a9773f', flatShading: true, roughness: 0.98 }),
  shoe: new THREE.MeshStandardMaterial({ color: '#5a4632', flatShading: true, roughness: 0.9 }),
  pack: new THREE.MeshStandardMaterial({ color: '#a96338', flatShading: true, roughness: 0.92 }),
  wood: new THREE.MeshStandardMaterial({ color: '#765035', flatShading: true, roughness: 0.9 }),
  stoneHead: new THREE.MeshStandardMaterial({ color: '#8d8b86', flatShading: true, roughness: 0.86 }),
  eyeWhite: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  eyeDark: new THREE.MeshBasicMaterial({ color: '#26201c' }),
  mouth: new THREE.MeshBasicMaterial({ color: '#8d4f42' }),
};

// 关节:把几何体上端对齐到旋转轴,便于绕肩/髋旋转
function limbSegment(
  rTop: number, rBottom: number, length: number, mat: THREE.Material
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, length, 6);
  geo.translate(0, -length / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

export class Player {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();   // 整体朝向 + 上下起伏
  private readonly hips = new THREE.Group();   // 胯:与肩反向扭转
  private readonly chest = new THREE.Group();  // 胸:承载手臂与头
  private readonly headPivot = new THREE.Group();
  private readonly thighL: THREE.Mesh;
  private readonly thighR: THREE.Mesh;
  private readonly shinL: THREE.Mesh;
  private readonly shinR: THREE.Mesh;
  private readonly upperArmL: THREE.Mesh;
  private readonly upperArmR: THREE.Mesh;
  private readonly foreArmL: THREE.Mesh;
  private readonly foreArmR: THREE.Mesh;
  private walkT = 0;
  private facing = 0;
  private swingT = -1; // 采集挥动动画,-1 表示未挥
  private hurtT = -1;
  private idleT = 0;
  private lean = 0;    // 移动时前倾,平滑过渡
  speed = 7.2;
  private heightAt: (x: number, z: number) => number = islandHeight;
  private terrainCenterX = 0;
  private terrainCenterZ = 0;
  private terrainRadius = ISLAND_RADIUS - 2.2;

  private static readonly HIP_Y = 0.86;

  constructor() {
    const hipY = Player.HIP_Y;

    // ---- 躯干 ----
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.86, 0.5), MAT.shirt);
    torso.position.y = 0.43;
    torso.castShadow = true;
    this.chest.add(torso);
    // 领口一圈,分开头与身体
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.42), MAT.shirt);
    collar.position.y = 0.9;
    this.chest.add(collar);

    // ---- 头(Q 版:比躯干略宽) ----
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.8, 0.78), MAT.skin);
    head.position.y = 0.4;
    head.castShadow = true;
    this.headPivot.add(head);

    // 眼睛:深色小眼 + 一点高光。远景下"大白眼白"会显得呆滞,深色实心更耐看
    for (const x of [-0.2, 0.2]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.04), MAT.eyeDark);
      eye.position.set(x, 0.42, 0.4);
      const spark = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.02), MAT.eyeWhite);
      spark.position.set(x - 0.028, 0.47, 0.425);
      this.headPivot.add(eye, spark);
    }
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.07), MAT.skin);
    nose.position.set(0, 0.29, 0.41);
    this.headPivot.add(nose);
    // 微笑:中段一条 + 两侧微微上翘
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.03), MAT.mouth);
    mouth.position.set(0, 0.17, 0.4);
    this.headPivot.add(mouth);
    for (const x of [-0.1, 0.1]) {
      const corner = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.03), MAT.mouth);
      corner.position.set(x * 1.7, 0.195, 0.4);
      this.headPivot.add(corner);
    }

    // 鬓角(草帽会盖住头顶,所以只在两侧露头发)
    for (const x of [-0.4, 0.4]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.72), MAT.hair);
      side.position.set(x, 0.42, -0.02);
      this.headPivot.add(side);
    }
    // 后脑勺拆成错落发束。肩后镜头会长期看到这里，整块深色盒子会像贴图丢失。
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.17;
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.34 + (i % 2) * 0.08, 0.1), MAT.hair);
      lock.position.set(x, 0.43 - (i % 2) * 0.025, -0.385);
      lock.rotation.z = (i - 2) * 0.045;
      this.headPivot.add(lock);
    }

    // ---- 草帽:提供辨识剪影,但帽檐必须小于头宽 ----
    // 帽檐一旦比肩还宽,俯视镜头下会盖住整张脸,角色变成"一顶会走的帽子"
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.06, 8), MAT.straw);
    brim.position.set(0, 0.78, -0.04);
    brim.castShadow = true;
    this.headPivot.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.37, 0.26, 8), MAT.straw);
    crown.position.set(0, 0.9, -0.04);
    crown.castShadow = true;
    this.headPivot.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 8), MAT.strawDark);
    band.position.set(0, 0.81, -0.04);
    this.headPivot.add(band);

    this.headPivot.position.y = 0.86;
    this.chest.add(this.headPivot);

    // ---- 手臂:上臂 + 前臂,肘部可弯 ----
    const makeArm = (side: -1 | 1) => {
      const upper = limbSegment(0.15, 0.13, 0.42, MAT.shirt);
      upper.position.set(side * 0.47, 0.78, 0);
      upper.rotation.z = side * 0.09; // 微微外展,不贴着身体

      const fore = limbSegment(0.11, 0.1, 0.4, MAT.skin);
      fore.position.y = -0.42;
      upper.add(fore);
      // 手掌
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.16, 0.17), MAT.skin);
      hand.position.y = -0.44;
      fore.add(hand);
      this.chest.add(upper);
      return { upper, fore };
    };
    const armL = makeArm(-1);
    const armR = makeArm(1);
    this.upperArmL = armL.upper; this.foreArmL = armL.fore;
    this.upperArmR = armR.upper; this.foreArmR = armR.fore;

    // 石斧握在右手前臂上
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.95, 5), MAT.wood);
    handle.position.set(0, -0.62, 0.06);
    handle.rotation.x = 0.16;
    this.foreArmR.add(handle);
    const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.3), MAT.stoneHead);
    axeHead.position.set(0, -0.44, 0.06);
    handle.add(axeHead);

    // ---- 背包 ----
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.26), MAT.pack);
    pack.position.set(0, 0.46, -0.36);
    pack.castShadow = true;
    this.chest.add(pack);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.54), MAT.strawDark);
    strap.position.set(0, 0.6, -0.06);
    this.chest.add(strap);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.055), MAT.strawDark);
    flap.position.set(0, 0.59, -0.505);
    flap.rotation.x = -0.08;
    this.chest.add(flap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.035), MAT.stoneHead);
    buckle.position.set(0, 0.55, -0.54);
    this.chest.add(buckle);

    // ---- 腿:大腿 + 小腿 + 脚 ----
    const makeLeg = (side: -1 | 1) => {
      const thigh = limbSegment(0.15, 0.135, 0.44, MAT.pants);
      thigh.position.set(side * 0.2, 0, 0);
      const shin = limbSegment(0.125, 0.115, 0.42, MAT.pants);
      shin.position.y = -0.44;
      thigh.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.13, 0.36), MAT.shoe);
      foot.position.set(0, -0.48, 0.07);
      foot.castShadow = true;
      shin.add(foot);
      this.hips.add(thigh);
      return { thigh, shin };
    };
    const legL = makeLeg(-1);
    const legR = makeLeg(1);
    this.thighL = legL.thigh; this.shinL = legL.shin;
    this.thighR = legR.thigh; this.shinR = legR.shin;

    this.hips.position.y = hipY;
    this.chest.position.y = hipY;
    this.body.add(this.hips, this.chest);
    this.group.add(this.body);
    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 20),
      new THREE.MeshBasicMaterial({ color: '#173522', transparent: true, opacity: 0.12, depthWrite: false })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.scale.y = 0.62;
    contact.position.y = 0.025;
    this.group.add(contact);
    // 俯视镜头里角色原先只有十几个像素高，略放大能恢复主角层级，又不会改变碰撞半径。
    this.group.scale.setScalar(1.1);
    this.group.position.set(0, islandHeight(0, 0), 0);
  }

  get position(): THREE.Vector3 { return this.group.position; }
  /** 当前朝向弧度(与 atan2(dirX, dirZ) 同一约定),方向向量 = (sin, cos) */
  get facingAngle(): number { return this.facing; }

  startSwing(): void { this.swingT = 0; if (this.mixer) this.playClip('chop', true); }
  startHurt(): void { this.hurtT = 0; if (this.mixer) this.playClip('hurt', true); }

  // ---- 外部骨骼模型(可选) ----
  // 有资产就用资产 + 骨骼动画,没有就继续用上面那套程序化四肢。
  // 两套并存而不是二选一:资产是异步加载的,而角色在启动时就得能走能砍。
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private currentClip = '';
  private action: THREE.AnimationAction | null = null;

  /**
   * 换成外部骨骼模型。
   * clipNames 把游戏状态映射到资产里的片段名 —— 不同资产包的命名千奇百怪
   * (KayKit 里砍击叫 `1H_Melee_Attack_Chop`),映射放在调用方,这里不猜。
   * 可重复调用做"换装":会先摘掉上一次的模型再挂新的。
   */
  useModel(object: THREE.Object3D, animations: THREE.AnimationClip[],
    clipNames: { idle: string; walk: string; chop: string; hurt: string }): void {
    // 摘掉上一次的模型。只 remove 不 dispose:cloneSkinned 出来的几何/材质和原型共享,
    // dispose 会破坏后续 instantiate,残留一点 GPU 资源对两三个角色的选择器来说无所谓
    if (this.model) {
      this.body.remove(this.model);
      this.model = null;
      this.mixer = null;
      this.action = null;
      this.currentClip = '';
      this.clips.clear();
    }
    // 藏起程序化肢体,但 body 本身要留着 —— 朝向和落步起伏都挂在它上面
    for (const child of this.body.children) child.visible = false;
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
    this.body.add(object);
    this.model = object;
    this.mixer = new THREE.AnimationMixer(object);
    for (const [state, name] of Object.entries(clipNames)) {
      const clip = animations.find((a) => a.name === name);
      if (clip) this.clips.set(state, clip);
    }
    this.playClip('idle', false);
  }

  private playClip(state: string, once: boolean): void {
    const clip = this.clips.get(state);
    if (!this.mixer || !clip || (this.currentClip === state && !once)) return;
    const next = this.mixer.clipAction(clip);
    next.reset();
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    // 交叉淡入:直接切会在两个姿势之间跳一下
    if (this.action && this.action !== next) next.crossFadeFrom(this.action, once ? 0.08 : 0.18, false);
    next.play();
    this.action = next;
    this.currentClip = state;
  }
  get swinging(): boolean { return this.swingT >= 0; }

  /** 远征时切换到另一座小岛的高度场与活动边界；回家时再切回主岛。 */
  setTerrain(
    heightAt: (x: number, z: number) => number,
    centerX = 0,
    centerZ = 0,
    radius = ISLAND_RADIUS - 2.2
  ): void {
    this.heightAt = heightAt;
    this.terrainCenterX = centerX;
    this.terrainCenterZ = centerZ;
    this.terrainRadius = radius;
    this.group.position.y = heightAt(this.group.position.x, this.group.position.z);
  }

  // dir 为已归一化的世界方向(x,z),长度 0 表示不动
  update(dt: number, dirX: number, dirZ: number): void {
    const len = Math.hypot(dirX, dirZ);
    const moving = len > 0.01;

    if (moving) {
      this.idleT = 0;
      const nx = dirX / len;
      const nz = dirZ / len;
      let x = this.group.position.x + nx * this.speed * dt;
      let z = this.group.position.z + nz * this.speed * dt;
      // 限制在岛上(留一点沙滩边界)
      const dx = x - this.terrainCenterX;
      const dz = z - this.terrainCenterZ;
      const d = Math.hypot(dx, dz);
      if (d > this.terrainRadius) {
        x = this.terrainCenterX + (dx / d) * this.terrainRadius;
        z = this.terrainCenterZ + (dz / d) * this.terrainRadius;
      }
      this.group.position.x = x;
      this.group.position.z = z;
      this.facing = Math.atan2(nx, nz);
      this.walkT += dt * 8.4;
    } else {
      this.idleT += dt;
      this.walkT += dt * 1.9; // 待机轻微呼吸
    }
    this.group.position.y = this.heightAt(this.group.position.x, this.group.position.z);

    // 平滑转向
    let diff = this.facing - this.body.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.body.rotation.y += diff * Math.min(1, dt * 14);

    // 有骨骼模型时,姿态完全交给动画,下面那套程序化摆肢全部跳过
    if (this.mixer) {
      this.mixer.update(dt);
      // 一次性动作(挥砍、受击)播完之前不让走/站抢走控制权
      const busy = this.swingT >= 0 || this.hurtT >= 0;
      if (this.swingT >= 0) { this.swingT += dt * 3.4; if (this.swingT >= 1) this.swingT = -1; }
      if (this.hurtT >= 0) { this.hurtT += dt; if (this.hurtT > 0.42) this.hurtT = -1; }
      if (!busy) this.playClip(moving ? 'walk' : 'idle', false);
      this.body.position.y = 0;   // 落步起伏由动画负责,别再叠一层
      return;
    }

    const cycle = Math.sin(this.walkT);
    const amp = moving ? 1 : 0.09;

    // 腿:大腿摆动 + 小腿在后摆时弯曲(没有膝弯的走路会像僵尸)
    this.thighL.rotation.x = cycle * 0.72 * amp;
    this.thighR.rotation.x = -cycle * 0.72 * amp;
    this.shinL.rotation.x = Math.max(0, -cycle) * 0.95 * amp;
    this.shinR.rotation.x = Math.max(0, cycle) * 0.95 * amp;

    // 肩胯反向扭转:让走路有"拧"的动势
    this.hips.rotation.y = cycle * 0.13 * amp;
    this.chest.rotation.y = -cycle * 0.17 * amp;

    // 落步下沉 + 前倾
    const bob = moving ? Math.abs(Math.sin(this.walkT)) * 0.085 : Math.sin(this.walkT) * 0.012;
    this.body.position.y = bob;
    const leanTarget = moving ? 0.1 : 0;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 8);
    this.chest.rotation.x = this.lean;
    // 头部保持水平视线(抵消前倾),待机时偶尔转头张望
    this.headPivot.rotation.x = -this.lean * 0.7;
    this.headPivot.rotation.y = moving
      ? cycle * 0.06
      : Math.sin(this.idleT * 0.8) * Math.min(0.3, this.idleT * 0.05);
    this.body.rotation.z = !moving && this.idleT > 4 ? Math.sin(this.idleT * 1.7) * 0.022 : 0;

    if (this.hurtT >= 0) {
      this.hurtT += dt;
      const p = Math.sin(Math.min(1, this.hurtT * 2.4) * Math.PI);
      this.chest.rotation.x = this.lean - p * 0.4;
      this.body.position.y = bob + p * 0.18;
      if (this.hurtT > 0.42) this.hurtT = -1;
    }

    // 采集挥斧优先于走路摆手
    if (this.swingT >= 0) {
      this.swingT += dt * 3.4;
      const p = Math.sin(Math.min(1, this.swingT) * Math.PI);
      this.upperArmR.rotation.x = -p * 2.5;
      this.foreArmR.rotation.x = -p * 0.7;          // 抬手时收肘,落下时伸展
      this.upperArmL.rotation.x = -cycle * 0.3 * amp;
      this.foreArmL.rotation.x = -0.25;
      this.chest.rotation.y = -p * 0.32;             // 挥砍带上身发力
      if (this.swingT >= 1) this.swingT = -1;
    } else {
      this.upperArmL.rotation.x = -cycle * 0.62 * amp;
      this.upperArmR.rotation.x = cycle * 0.62 * amp;
      // 肘部常态微屈,手臂不会像木棍
      this.foreArmL.rotation.x = -0.3 - Math.max(0, -cycle) * 0.35 * amp;
      this.foreArmR.rotation.x = -0.3 - Math.max(0, cycle) * 0.35 * amp;
    }
  }
}
