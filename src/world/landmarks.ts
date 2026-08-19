import * as THREE from 'three';
import { islandHeight } from './island';

// 沙滩沉船:远处可识别的大轮廓，同时暗示玩家为何来到岛上。
export function createShipwreck(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#75472d', flatShading: true, roughness: 0.9 });
  const edge = new THREE.MeshStandardMaterial({ color: '#4d3022', flatShading: true, roughness: 0.96 });
  const sail = new THREE.MeshStandardMaterial({
    color: '#d8c79e', side: THREE.DoubleSide, flatShading: true, roughness: 1,
  });
  const sailPatch = new THREE.MeshStandardMaterial({
    color: '#b85f48', side: THREE.DoubleSide, flatShading: true, roughness: 1,
  });

  // 船壳用交错木板构成破损弧线。
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.32, 4.8 - Math.abs(i) * 0.38), i % 2 ? wood : edge);
    plank.position.set(i * 0.43, 0.42 + Math.abs(i) * 0.06, 0);
    plank.rotation.z = i * 0.1; plank.castShadow = true; g.add(plank);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 5.2, 6), edge);
  mast.position.set(0.4, 2.5, -0.35); mast.rotation.z = -0.22; mast.castShadow = true; g.add(mast);
  const sailGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.35, 4.55, -0.3), new THREE.Vector3(0.15, 2.15, -0.25), new THREE.Vector3(-1.65, 2.35, -0.2),
  ]);
  sailGeo.setIndex([0, 1, 2]); sailGeo.computeVertexNormals();
  const tornSail = new THREE.Mesh(sailGeo, sail); tornSail.castShadow = true; g.add(tornSail);
  // 缝补布与缺口让帆不再是一块干净三角形，远景也能读出“受过风暴”。
  const patchGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.12, 3.72, -0.23), new THREE.Vector3(-0.34, 2.85, -0.23),
    new THREE.Vector3(-0.95, 3.02, -0.23), new THREE.Vector3(-0.7, 3.62, -0.23),
  ]);
  patchGeo.setIndex([0, 1, 2, 0, 2, 3]); patchGeo.computeVertexNormals();
  g.add(new THREE.Mesh(patchGeo, sailPatch));
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.38),
    new THREE.MeshBasicMaterial({ color: '#c95f46', side: THREE.DoubleSide }));
  flag.position.set(0.72, 4.7, -0.3); flag.rotation.y = -0.2; g.add(flag);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.7, 4),
    new THREE.MeshStandardMaterial({ color: '#d0b67d', roughness: 1 }));
  rope.position.set(-0.58, 3.25, -0.28); rope.rotation.z = -0.58; g.add(rope);

  for (let i = 0; i < 3; i++) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.72), wood);
    crate.position.set(-1.8 + i * 0.75, 0.3, 2.6 + (i % 2) * 0.45);
    crate.rotation.y = i * 0.48; crate.castShadow = true; g.add(crate);
  }
  // 半埋的桶、断裂肋骨和湿沙压痕组成一组中小形，避免地标只剩孤零零的桅杆。
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.72, 8), wood);
  barrel.position.set(2.25, 0.22, 1.7); barrel.rotation.set(0.22, 0.4, Math.PI / 2.2);
  barrel.castShadow = true; g.add(barrel);
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(1.15 - i * 0.08, 0.075, 5, 10, Math.PI * 0.72), edge);
    rib.position.set(-0.7 + i * 0.52, 0.48, -0.25);
    rib.rotation.set(Math.PI / 2, -0.18, -0.4);
    g.add(rib);
  }
  const wetPatch = new THREE.Mesh(
    new THREE.CircleGeometry(3.7, 28),
    new THREE.MeshBasicMaterial({ color: '#6d6b54', transparent: true, opacity: 0.14, depthWrite: false })
  );
  wetPatch.rotation.x = -Math.PI / 2; wetPatch.scale.set(1.25, 0.62, 1);
  wetPatch.position.y = 0.025; wetPatch.renderOrder = -1; g.add(wetPatch);
  const x = 15.5, z = -13.5;
  g.position.set(x, islandHeight(x, z), z);
  g.rotation.y = -0.72;
  g.rotation.z = -0.08;
  g.scale.setScalar(1.12);
  return g;
}
