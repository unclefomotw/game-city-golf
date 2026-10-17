// ?debug: live tuning of feel parameters during playtests (ADR-006).
// "匯出設定" copies the current values as JSON so they can become the new defaults.

import GUI from 'lil-gui';
import type { Config } from '../config';
import { MATERIAL_LABELS, MATERIALS } from '../world/materials';

export function createTuningPanel(cfg: Config): void {
  const gui = new GUI({ title: '調參（debug）' });
  gui.close();

  const p = gui.addFolder('球的物理');
  p.add(cfg.physics, 'gravity', 2, 40, 0.5);
  p.add(cfg.physics, 'airDrag', 0, 1, 0.01);
  p.add(cfg.physics, 'magnusK', 0, 0.3, 0.005);
  p.add(cfg.physics, 'spinDecay', 0, 3, 0.05);
  p.add(cfg.physics, 'maxSpin', 0, 20, 0.5);
  p.add(cfg.physics, 'maxLaunchSpeed', 5, 100, 1);
  p.add(cfg.physics, 'contactSpinK', 0, 5, 0.1);
  p.add(cfg.physics, 'contactSpinRetain', 0, 1, 0.05);
  p.add(cfg.physics, 'rollingFriction', 0, 30, 0.5);
  p.add(cfg.physics, 'rollThreshold', 0, 10, 0.1);
  const rest = p.addFolder('反彈係數');
  for (const k of Object.keys(cfg.physics.restitution) as (keyof Config['physics']['restitution'])[]) {
    rest.add(cfg.physics.restitution, k, 0, 1, 0.01);
    rest.add(cfg.physics.bounceFriction, k, 0, 1, 0.01).name(`${k} friction`);
  }
  rest.close();

  const d = gui.addFolder('破壞');
  d.add(cfg.destruction, 'radiusPerSpeed', 0, 0.3, 0.005);
  d.add(cfg.destruction, 'maxRadius', 0.5, 6, 0.1);

  // DES-8, ADR-019: bounciness and fragility per building material.
  const mats = gui.addFolder('材質');
  for (const kind of MATERIALS) {
    const m = mats.addFolder(MATERIAL_LABELS[kind]);
    m.add(cfg.materials[kind], 'restitution', 0, 1, 0.01).name('反彈係數');
    m.add(cfg.materials[kind], 'bounceFriction', 0, 1, 0.01).name('反彈摩擦');
    m.add(cfg.materials[kind], 'minSpeed', 0, 45, 0.5).name('破壞門檻速度');
    m.add(cfg.materials[kind], 'radiusScale', 0, 3, 0.05).name('挖洞半徑倍率');
    m.add(cfg.materials[kind], 'speedKeptPerCell', 0.8, 1, 0.001).name('穿透每格保留速度');
    m.close();
  }
  mats.close();

  gui.add(cfg.preview, 'seconds', 0, 3, 0.05).name('預覽秒數');
  gui.add(cfg.preview, 'farOpacity', 0, 1, 0.05).name('預覽遠端透明度');
  gui.add(cfg.preview, 'depthFadeSpan', 1, 30, 0.5).name('預覽漸層距離');

  const a = gui.addFolder('方向搖桿');
  a.add(cfg.aim, 'azimuthRateDeg', 5, 360, 5).name('水平轉速 °/s');
  a.add(cfg.aim, 'elevationRateDeg', 5, 240, 5).name('仰角轉速 °/s');
  a.add(cfg.aim, 'stickDeadZone', 0, 0.5, 0.01).name('中心死區');
  a.add(cfg.aim, 'stickExponent', 1, 4, 0.1).name('反應曲線');
  a.add(cfg.aim, 'keyboardDeflection', 0.1, 1, 0.05).name('方向鍵力度');
  a.close();

  const c = gui.addFolder('相機');
  c.add(cfg.camera, 'freeSpeed', 2, 60, 1);
  c.add(cfg.camera, 'lookSensitivity', 0.001, 0.02, 0.0005);
  c.add(cfg.camera, 'levelBallScreenOffset', 0, 0.9, 0.01).name('平視時球的下移量');
  c.close();

  gui
    .add(
      {
        export: () => {
          const json = JSON.stringify(cfg, null, 2);
          navigator.clipboard?.writeText(json).catch(() => {});
          console.log(json);
          alert('設定已複製到剪貼簿（也印在 console）');
        },
      },
      'export',
    )
    .name('匯出設定');
}
