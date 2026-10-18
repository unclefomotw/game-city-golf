// Entry point: wires the pure game logic to rendering, input and the panel.

import * as THREE from 'three';
import { cueGain, SoundDirector, type SoundEvent } from './audio/soundCues';
import { SoundPlayer } from './audio/soundPlayer';
import { config } from './config';
import { parseSeed, randomSeed } from './core/rng';
import { Game, type Phase } from './game/game';
import { scoreForDestruction } from './game/scoring';
import { stepAim } from './input/aimStick';
import { type InputKind, trackInputKind } from './input/inputKind';
import { ViewInput } from './input/viewInput';
import { previewPath, type ShotInput } from './physics/ballSim';
import { AimVisuals } from './render/aimVisuals';
import { CameraRig } from './render/cameraRig';
import { Cutaway } from './render/cutaway';
import { Debris } from './render/debris';
import { SceneView } from './render/sceneView';
import { VoxelMesh } from './render/voxelMesh';
import { HoldButton, Joystick, SpinPad } from './ui/widgets';
import { DEFAULT_LEVEL_OPTIONS, generateLevel } from './world/levelGen';
import { materialLookup } from './world/materials';
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
const materialOf = materialLookup(level.buildings);
/** SHOT-5: the preview digs into a scratch overlay so the real grid stays untouched. */
const previewWorld = () => ({ solids: new PreviewOverlay(level.grid), materialOf });

// --- Scene ---------------------------------------------------------------------
const viewEl = $('view');
const canvas = $<HTMLCanvasElement>('canvas');
const view = new SceneView(canvas, level, config);
const cutaway = new Cutaway();
const voxels = new VoxelMesh(level.grid, level.buildings, cutaway);
const debris = new Debris(config);
const aimVisuals = new AimVisuals();
view.scene.add(voxels.group, debris.mesh, aimVisuals.group);
const { sizeX, sizeY, sizeZ } = level.grid;
const rig = new CameraRig(view.camera, config, new THREE.Vector3(sizeX, sizeY, sizeZ), (p) =>
  level.grid.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
);
// ADR-022: compile the dithered building shaders up front so the first cutaway doesn't stall.
voxels.useCutaway(true);
view.renderer.compile(view.scene, view.camera);
voxels.useCutaway(false);

// --- Sound (AUD-1 ~ AUD-9, ADR-021) -----------------------------------------------
const sound = new SoundPlayer(config);
const soundDirector = new SoundDirector(config);
/** Sounds triggered by the panel (the shot), played on the next frame with the physics events. */
const pendingSounds: SoundEvent[] = [];
// Browsers only allow audio after a user gesture; any input unlocks it (and resumes it after interruptions).
for (const type of ['pointerdown', 'pointerup', 'keydown', 'touchend'])
  window.addEventListener(type, () => sound.unlock(), { capture: true, passive: true });

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
const spinPad = new SpinPad($<HTMLCanvasElement>('spin-pad'), () => {
  shot.sideSpin = spinPad.side;
  shot.topSpin = spinPad.top;
});
// ADR-013: direction stick (shot aim) and free-camera stick are separate widgets;
// only one of them is visible at a time.
const aimStick = new Joystick($('aim-stick'));
const joystick = new Joystick($('joystick'));
const flyUp = new HoldButton($('fly-up'));
const flyDown = new HoldButton($('fly-down'));

powerInput.addEventListener('input', () => (shot.power = Number(powerInput.value) / 100));
// Drop focus after a pointer drag so the arrow keys go back to aiming (ADR-013).
powerInput.addEventListener('pointerup', () => powerInput.blur());
$('spin-reset').addEventListener('click', () => spinPad.reset());

$('fire').addEventListener('click', () => {
  if (game.phase !== 'aiming' || rig.mode !== 'orbit' || shot.power < 0.01) return;
  game.fire({ ...shot });
  pendingSounds.push({ type: 'shot', power: shot.power });
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
$('mute').addEventListener('click', () => sound.setMuted(!sound.muted));
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

// PLT-3 / ADR-012: hints describe only the input the player is using.
const inputKind = trackInputKind();
const HINTS: Record<InputKind, { free: string; aim: string }> = {
  mouse: {
    free: '靈魂出竅：WASD 移動（往視線方向前進）、Q/E 下降／上升、Shift 加速，拖曳畫面轉視角，滾輪拉近／拉遠。',
    aim: '方向鍵或拖曳方向搖桿調整擊球方向：左右轉水平方向、上下調仰角，推越遠轉越快。設定力道與旋球後按「擊球」。拖曳畫面旋轉視角，滾輪拉近／拉遠。',
  },
  touch: {
    free: '靈魂出竅：用搖桿移動（往視線方向前進）、升降按鈕上下，單指拖曳畫面轉視角，雙指捏合拉近／拉遠。',
    aim: '推方向搖桿調整擊球方向：左右轉水平方向、上下調仰角，推越遠轉越快，放開就停住。設定力道與旋球後按「擊球」。單指拖曳畫面旋轉視角，雙指捏合拉近／拉遠。',
  },
};

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
  $('mute').classList.toggle('muted', sound.muted);
  $('mute').title = sound.muted ? '開啟音效' : '靜音';
  $('strokes').textContent = String(game.strokes);
  $('score').textContent = String(game.destructionScore);
  if (document.activeElement !== powerInput) powerInput.value = String(Math.round(shot.power * 100));
  $('power-val').textContent = `${Math.round(shot.power * 100)}%`;
  $('elev-val').textContent = `${Math.round(shot.elevation / DEG)}°`;
  const hints = HINTS[inputKind()];
  $('hint').textContent = free ? hints.free : phase === 'flying' ? '球飛行中…' : hints.aim;
}

// --- Input on the square view -------------------------------------------------------
// ADR-013: dragging the scene only moves the camera; aiming is done with the panel stick.
// Bound to the canvas, not #view, so overlays (e.g. the win card) keep their own clicks.
const input = new ViewInput(canvas, {
  rotate: (dx, dy) => rig.rotate(dx, dy),
  zoom: (f) => rig.zoom(f),
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

  const simEvents = game.update(dt);
  const soundEvents: SoundEvent[] = [...pendingSounds.splice(0), ...simEvents];
  for (const e of simEvents) {
    if (e.type !== 'destroy') continue;
    debris.spawn(e.cells, e.impact, e.speed, level.buildings);
    rig.shake(Math.min(1, e.cells.length / 25));
    toast(`破壞 +${scoreForDestruction(e)}`);
  }
  if (game.phase === 'finished' && lastPhase !== 'finished') {
    $('win-text').textContent = `${game.strokes} 桿 · 破壞分數 ${game.destructionScore}`;
    $('win').hidden = false;
    soundEvents.push({ type: 'goal' });
  }
  lastPhase = game.phase;

  // ADR-013 (SHOT-1): the direction stick and arrow keys rate-control azimuth and elevation.
  if (rig.mode === 'orbit') {
    const ka = input.keyboardAim();
    const kd = config.aim.keyboardDeflection;
    stepAim(
      shot,
      {
        // Screen y grows downward, so pushing the stick up (y < 0) raises the elevation.
        right: THREE.MathUtils.clamp(aimStick.x + ka.right * kd, -1, 1),
        up: THREE.MathUtils.clamp(-aimStick.y + ka.up * kd, -1, 1),
      },
      dt,
      config.aim,
    );
  }

  const km = input.keyboardMove();
  rig.update(dt, game.ball.pos, {
    forward: THREE.MathUtils.clamp(km.forward - joystick.y, -1, 1),
    right: THREE.MathUtils.clamp(km.right + joystick.x, -1, 1),
    up: THREE.MathUtils.clamp(km.up + (flyUp.held ? 1 : 0) - (flyDown.held ? 1 : 0), -1, 1),
    fast: km.fast,
  });

  // AUD-4: volume follows how far the camera is from the ball, where every sound happens.
  const listenDistance = view.camera.position.distanceTo(game.ball.pos);
  for (const cue of soundDirector.cues(soundEvents, now / 1000))
    sound.play(cue, cueGain(cue, listenDistance, config.audio));

  voxels.update();
  // CAM-3: thin out the buildings between the camera and the ball when no angle can see it.
  voxels.useCutaway(cutaway.update(dt, rig.occluded, view.camera.position, game.ball.pos, config.cutaway));
  debris.update(dt);
  view.ball.position.copy(game.ball.pos);

  const aiming = game.phase === 'aiming';
  aimVisuals.visible = aiming;
  if (aiming) {
    const preview = previewPath(game.ball.pos, shot, previewWorld(), config, config.preview.seconds);
    aimVisuals.update(game.ball.pos, shot, preview, view.camera.position, config.preview);
  }

  syncPanel(game.phase);
  view.animate(now / 1000);
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
