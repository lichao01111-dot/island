import * as THREE from 'three';
import type { ResourceKind } from '../world/props';
import { islandHeight } from '../world/island';

interface Particle { mesh: THREE.Mesh; life: number; maxLife: number; velocity: THREE.Vector3; target?: THREE.Vector3 }
interface FadeObject { object: THREE.Object3D; life: number; maxLife: number; grow?: number }

export class VisualEffects {
  private particles: Particle[] = [];
  private fades: FadeObject[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  harvest(kind: ResourceKind, from: THREE.Vector3, player: THREE.Vector3): void {
    const colors: Record<ResourceKind, string> = { wood: '#c1814e', fiber: '#70c956', stone: '#a5aaa7' };
    for (let i = 0; i < 7; i++) {
      const mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.08 + Math.random() * 0.08, 0),
        new THREE.MeshBasicMaterial({ color: colors[kind], transparent: true })
      );
      mesh.position.copy(from).add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.8 + Math.random(), (Math.random() - 0.5) * 0.7));
      this.scene.add(mesh);
      this.particles.push({
        mesh, life: 0.75 + Math.random() * 0.25, maxLife: 1,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2.4, 2 + Math.random() * 2, (Math.random() - 0.5) * 2.4),
        target: player.clone().add(new THREE.Vector3(0, 1.2, 0)),
      });
    }
  }

  footprint(position: THREE.Vector3, angle: number, side: number): void {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.48),
      new THREE.MeshBasicMaterial({ color: '#315f35', transparent: true, opacity: 0.28, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = -angle;
    mesh.position.set(position.x + Math.cos(angle) * side * 0.18, islandHeight(position.x, position.z) + 0.025,
      position.z - Math.sin(angle) * side * 0.18);
    this.scene.add(mesh); this.fades.push({ object: mesh, life: 5, maxLife: 5 });
  }

  ripple(x: number, z: number, y = 0.2): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.16, 20),
      new THREE.MeshBasicMaterial({ color: '#d7f3e8', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y, z);
    this.scene.add(ring); this.fades.push({ object: ring, life: 1.1, maxLife: 1.1, grow: 2.5 });
  }

  build(group: THREE.Group): void {
    group.scale.set(0.08, 0.08, 0.08);
    this.fades.push({ object: group, life: 0.65, maxLife: 0.65, grow: -1 });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      p.velocity.y -= dt * 5.5; p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.target && p.life < 0.45) p.mesh.position.lerp(p.target, 1 - Math.exp(-dt * 9));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); this.particles.splice(i, 1); }
    }
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i]; f.life -= dt;
      const progress = 1 - Math.max(0, f.life / f.maxLife);
      if (f.grow === -1) {
        const s = 1 - Math.pow(1 - progress, 3);
        f.object.scale.setScalar(0.08 + s * 0.92);
      } else {
        if (f.grow) f.object.scale.setScalar(1 + progress * f.grow);
        const mesh = f.object as THREE.Mesh;
        if (mesh.material) (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.life / f.maxLife) * 0.5;
      }
      if (f.life <= 0) {
        if (f.grow !== -1) { this.scene.remove(f.object); const m = f.object as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); }
        else f.object.scale.setScalar(1);
        this.fades.splice(i, 1);
      }
    }
  }
}
