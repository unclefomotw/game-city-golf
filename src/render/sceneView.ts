// Static scene setup: renderer, lights, ground, field box, goal, ball.

import * as THREE from 'three';
import type { Config } from '../config';
import { GROUND_PLAZA, GROUND_ROAD, type Level } from '../world/levelGen';

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly ball: THREE.Mesh;
  private readonly goalBeam: THREE.Mesh;
  private readonly goalRing: THREE.Mesh;

  constructor(
    readonly canvas: HTMLCanvasElement,
    level: Level,
    cfg: Config,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const { sizeX, sizeY, sizeZ } = level.grid;
    this.scene.background = new THREE.Color(0xbfdcf0);
    this.scene.fog = new THREE.Fog(0xbfdcf0, 90, 220);
    this.camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 0.1, 400);

    // Lights: one shadow-casting sun keeps mobile cost low.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(sizeX * 0.5 + 40, 80, sizeZ * 0.5 + 25);
    sun.target.position.set(sizeX / 2, 0, sizeZ / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = Math.max(sizeX, sizeZ) * 0.75;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 250 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);

    this.scene.add(this.createGround(level));
    // Land beyond the field so the view never shows a void past the edge.
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x8aa37a }));
    outside.rotation.x = -Math.PI / 2;
    outside.position.set(sizeX / 2, -0.02, sizeZ / 2);
    outside.receiveShadow = true;
    this.scene.add(outside);
    this.scene.add(this.createFieldBox(sizeX, sizeY, sizeZ));

    // FLD-2: a tall glowing beam makes the goal visible from anywhere.
    const { goal } = level;
    this.goalBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(goal.radius, goal.radius, sizeY, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.goalBeam.position.set(goal.x, sizeY / 2, goal.z);
    this.goalRing = new THREE.Mesh(
      new THREE.RingGeometry(goal.radius - 0.25, goal.radius, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd000, side: THREE.DoubleSide }),
    );
    this.goalRing.rotation.x = -Math.PI / 2;
    this.goalRing.position.set(goal.x, 0.03, goal.z);
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 4, 0.15), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    pole.position.y = 2;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.05), new THREE.MeshLambertMaterial({ color: 0xff3b30 }));
    cloth.position.set(0.7, 3.5, 0);
    flag.add(pole, cloth);
    flag.position.set(goal.x, 0, goal.z);
    flag.traverse((o) => (o.castShadow = true));
    this.scene.add(this.goalBeam, this.goalRing, flag);

    // Tee marker.
    const tee = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0x3a7bd5 }));
    tee.rotation.x = -Math.PI / 2;
    tee.position.set(level.start.x, 0.02, level.start.z);
    this.scene.add(tee);

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.physics.ballRadius, 20, 14),
      new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 }),
    );
    this.ball.castShadow = true;
    // X-ray copy drawn on top so the ball stays visible behind buildings.
    const xray = new THREE.Mesh(
      this.ball.geometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false }),
    );
    xray.renderOrder = 10;
    this.ball.add(xray);
    this.scene.add(this.ball);
  }

  private createGround(level: Level): THREE.Mesh {
    const { sizeX, sizeZ } = level.grid;
    const px = 4;
    const canvas = document.createElement('canvas');
    canvas.width = sizeX * px;
    canvas.height = sizeZ * px;
    const ctx = canvas.getContext('2d')!;
    for (let z = 0; z < sizeZ; z++)
      for (let x = 0; x < sizeX; x++) {
        const g = level.ground[x + z * sizeX];
        ctx.fillStyle = g === GROUND_ROAD ? '#6b7078' : g === GROUND_PLAZA ? '#8fcf7a' : '#c9c4b8';
        ctx.fillRect(x * px, z * px, px, px);
      }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(sizeX / 2, 0, sizeZ / 2);
    ground.receiveShadow = true;
    return ground;
  }

  /** FLD-1: the indestructible field box, drawn as edges so it never blocks the view. */
  private createFieldBox(sizeX: number, sizeY: number, sizeZ: number): THREE.LineSegments {
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(sizeX, sizeY, sizeZ)),
      new THREE.LineBasicMaterial({ color: 0x3355aa, transparent: true, opacity: 0.5 }),
    );
    box.position.set(sizeX / 2, sizeY / 2, sizeZ / 2);
    return box;
  }

  resize(size: number): void {
    this.renderer.setSize(size, size, true);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
  }

  animate(time: number): void {
    const pulse = 0.14 + 0.08 * Math.sin(time * 3);
    (this.goalBeam.material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
