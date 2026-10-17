// Entry point: wires the pure game logic to rendering, input and the panel.

import * as THREE from 'three';
import { config } from './config';
import { parseSeed, randomSeed } from './core/rng';
import { Game, type Phase } from './game/game';
import { ViewInput } from './input/viewInput';
import { previewPath, type ShotInput } from './physics/ballSim';
import { AimVisuals } from './render/aimVisuals';
import { CameraRig } from './render/cameraRig';
import { Debris } from './render/debris';
import { SceneView } from './render/sceneView';
import { VoxelMesh } from './render/voxelMesh';
import { HoldButton, Joystick, SpinPad } from './ui/widgets';
import { DEFAULT_LEVEL_OPTIONS, generateLevel } from './world/levelGen';
import { findTestScene, TEST_SCENES } from './world/testScenes';
import { PreviewOverlay } from './world/voxelGrid';

const DEG = Math.PI / 180;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// --- Level (LVL-2: the map code lives in the URL) ---------------------------
const params = new URLSearchParams(location.search);
const levelOptions = { ...DEFAULT_LEVEL_OPTIONS, ballRadius: config.physics.ballRadius };
// ADR-010: ?scene=<id> loads a developer test scene, in dev builds only.
const testScene = import.meta.env.DEV ? findTestScene(params.get('scene')) : null;
let seed = parseSeed(params.get('seed'));
if (seed === null && !testScene) {
  seed = randomSeed();
  params.set('seed', String(seed));
  history.replaceState(null, '', `?${params}`);
}
const level = testScene ? testScene.build(levelOptions) : generateLevel(seed ?? 0, levelOptions);
const game = new Game(level, config);

// --- Scene ---------------------------------------------------------------------
const viewEl = $('view');
const canvas = $<HTMLCanvasElement>('canvas');
const view = new SceneView(canvas, level, config);
const voxels = new VoxelMesh(level.grid, level.buildings);
const debris = new Debris(config);
const aimVisuals = new AimVisuals();
view.scene.add(voxels.mesh, debris.mesh, aimVisuals.group);
const { sizeX, sizeY, sizeZ } = level.grid;
const rig = new CameraRig(view.camera, config, new THREE.Vector3(sizeX, sizeY, sizeZ), (p) =>
  level.grid.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
);

// --- Shot settings (PLAY-2) ------------------------------------------------------
const toGoal = Math.atan2(level.goal.x - level.start.x, -(level.goal.z - level.start.z));
const shot: ShotInput = {
  azimuth: toGoal,
  elevation: config.aim.defaultElevationDeg * DEG,
  power: 0.5,
  sideSpin: 0,
  topSpin: 0,
};
rig.lookAlong(game.ball.pos, toGoal);

// --- Panel ---------------------------------------------------------------------------
const powerInput = $<HTMLInputElement>('power');
const elevInput = $<HTMLInputElement>('elev');
elevInput.min = String(config.aim.minElevationDeg);
elevInput.max = String(config.aim.maxElevationDeg);
const spinPad = new SpinPad($<HTMLCanvasElement>('spin-pad'), () => {
  shot.sideSpin = spinPad.side;
  shot.topSpin = spinPad.top;
});
const joystick = new Joystick($('joystick'));
const flyUp = new HoldButton($('fly-up'));
const flyDown = new HoldButton($('fly-down'));
const azStep = 1 * DEG;
const azLeft = new HoldButton($('az-left'), () => (shot.azimuth -= azStep));
const azRight = new HoldButton($('az-right'), () => (shot.azimuth += azStep));
let azHoldTime = 0;

powerInput.addEventListener('input', () => (shot.power = Number(powerInput.value) / 100));
elevInput.addEventListener('input', () => (shot.elevation = Number(elevInput.value) * DEG));
$('spin-reset').addEventListener('click', () => spinPad.reset());

$('fire').addEventListener('click', () => {
  if (game.phase !== 'aiming' || rig.mode !== 'orbit' || shot.power < 0.01) return;
  game.fire({ ...shot });
});
$('penalty').addEventListener('click', () => {
  game.penalty();
  toast('罰桿 +1');
});
$('ghost').addEventListener('click', () => {
  if (rig.mode === 'orbit') rig.enterFree();
  else rig.returnToBall();
});
const newMap = () => {
  params.delete('scene');
  params.set('seed', String(randomSeed()));
  location.search = `?${params}`;
};
$('new-map').addEventListener('click', newMap);
$('win-new').addEventListener('click', newMap);
$('replay').addEventListener('click', () => location.reload());
$('seed').textContent = testScene ? testScene.label : String(seed);
if (import.meta.env.DEV) addScenePicker();

/** ADR-010: dev-only picker; choosing a scene reloads with ?scene=<id>. */
function addScenePicker(): void {
  const picker = document.createElement('select');
  picker.id = 'scene-picker';
  picker.add(new Option('測試場景：無（隨機城市）', ''));
  for (const s of TEST_SCENES) picker.add(new Option(`測試場景：${s.label}`, s.id));
  picker.value = testScene?.id ?? '';
  picker.addEventListener('change', () => {
    params.delete('seed');
    if (picker.value) params.set('scene', picker.value);
    else params.delete('scene');
    location.search = `?${params}`;
  });
  $('panel').append(picker);
}

let toastTimer = 0;
function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1200);
}

function syncPanel(phase: Phase): void {
  const free = rig.mode === 'free';
  $('aim-controls').hidden = free;
  $('free-controls').hidden = !free;
  // Firing is impossible in free mode, so hide the button there to save panel space.
  $('fire').hidden = free;
  $<HTMLButtonElement>('fire').disabled = phase !== 'aiming';
  $<HTMLButtonElement>('penalty').disabled = phase === 'finished' || game.strokes === 0;
  $('ghost').textContent = free ? '回到球' : '靈魂出竅';
  $('strokes').textContent = String(game.strokes);
  $('score').textContent = String(game.destructionScore);
  if (document.activeElement !== powerInput) powerInput.value = String(Math.round(shot.power * 100));
  if (document.activeElement !== elevInput) elevInput.value = String(Math.round(shot.elevation / DEG));
  $('power-val').textContent = `${Math.round(shot.power * 100)}%`;
  $('elev-val').textContent = `${Math.round(shot.elevation / DEG)}°`;
  const rel = THREE.MathUtils.euclideanModulo(shot.azimuth - toGoal + Math.PI, Math.PI * 2) - Math.PI;
  $('az-val').textContent = `${rel >= 0 ? '右' : '左'} ${Math.abs(Math.round(rel / DEG))}°`;
  $('az-val').title = '相對於終點方向';
  const spinText = (v: number, pos: string, neg: string) =>
    Math.abs(v) < 0.05 ? '' : `${v > 0 ? pos : neg}${Math.round(Math.abs(v) * 100)}%`;
  $('spin-val').textContent =
    [spinText(shot.sideSpin, '右旋', '左旋'), spinText(shot.topSpin, '上旋', '下旋')].filter(Boolean).join(' ') || '無';
  $('hint').textContent = free
    ? '靈魂出竅：WASD 移動（往視線方向前進）、Q/E 下降／上升、Shift 加速，拖曳畫面轉視角；手機用搖桿移動、雙指捏合前進後退。'
    : phase === 'flying'
      ? '球飛行中…'
      : '從球往反方向拖曳（彈弓式）設定方向與力道，仰角與旋轉在上方調整，再按「擊球」。拖曳空白處旋轉視角，滾輪／雙指縮放。';
}

// --- Input on the square view -------------------------------------------------------
const ballScreen = new THREE.Vector3();
// Bound to the canvas, not #view, so overlays (e.g. the win card) keep their own clicks.
const input = new ViewInput(canvas, {
  aimAnchor: () => {
    if (game.phase !== 'aiming' || rig.mode !== 'orbit') return null;
    ballScreen.copy(game.ball.pos).project(view.camera);
    const w = canvas.clientWidth;
    return { x: ((ballScreen.x + 1) / 2) * w, y: ((1 - ballScreen.y) / 2) * w };
  },
  // Slingshot (ADR-007 / SHOT-2): pull away from the ball; the ball launches the opposite way.
  onAim: (dx, dy) => {
    const len = Math.hypot(dx, dy);
    shot.power = Math.min(1, len / (config.aim.fullPowerDrag * canvas.clientWidth));
    if (len > 8) shot.azimuth = rig.facingAzimuth() + Math.atan2(-dx, dy);
  },
  onAimEnd: () => {},
  rotate: (dx, dy) => rig.rotate(dx, dy),
  zoom: (f) => rig.zoom(f),
  grabRadius: () => config.aim.grabRadius * canvas.clientWidth,
});

// --- Layout (UI-1/UI-2): largest square that leaves room for the panel ---------------
function layout(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const landscape = w >= h;
  const size = Math.floor(landscape ? Math.min(h, w - 280) : Math.min(w, h - 240));
  viewEl.style.width = viewEl.style.height = `${size}px`;
  view.resize(size);
  spinPad.draw();
}
window.addEventListener('resize', layout);
layout();

if (params.has('debug')) import('./debug/tuning').then((m) => m.createTuningPanel(config));

// --- Main loop ----------------------------------------------------------------------------
let last = performance.now();
let lastPhase: Phase = game.phase;
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  for (const e of game.update(dt)) {
    if (e.type !== 'destroy') continue;
    debris.spawn(e.cells, e.impact, e.speed, level.buildings);
    rig.shake(Math.min(1, e.cells.length / 25));
    toast(`破壞 +${e.cells.length}`);
  }
  if (game.phase === 'finished' && lastPhase !== 'finished') {
    $('win-text').textContent = `${game.strokes} 桿 · 破壞分數 ${game.destructionScore}`;
    $('win').hidden = false;
  }
  lastPhase = game.phase;

  // Hold-to-repeat direction buttons: tap = 1°, hold = continuous turn.
  if (azLeft.held || azRight.held) {
    azHoldTime += dt;
    if (azHoldTime > 0.35) shot.azimuth += (azRight.held ? 1 : -1) * 40 * DEG * dt;
  } else azHoldTime = 0;

  const km = input.keyboardMove();
  rig.update(dt, game.ball.pos, {
    forward: THREE.MathUtils.clamp(km.forward - joystick.y, -1, 1),
    right: THREE.MathUtils.clamp(km.right + joystick.x, -1, 1),
    up: THREE.MathUtils.clamp(km.up + (flyUp.held ? 1 : 0) - (flyDown.held ? 1 : 0), -1, 1),
    fast: km.fast,
  });

  voxels.update();
  debris.update(dt);
  view.ball.position.copy(game.ball.pos);

  const aiming = game.phase === 'aiming';
  aimVisuals.visible = aiming;
  if (aiming) {
    const preview = previewPath(game.ball.pos, shot, new PreviewOverlay(level.grid), config, config.preview.seconds);
    aimVisuals.update(game.ball.pos, shot, preview);
  }

  syncPanel(game.phase);
  view.animate(now / 1000);
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
