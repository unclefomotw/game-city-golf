// ?debug: live tuning of feel parameters during playtests (ADR-006).
// "匯出設定" copies the current values as JSON so they can become the new defaults.

import GUI from 'lil-gui';
import type { Config } from '../config';

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
  d.add(cfg.destruction, 'minSpeed', 0, 40, 0.5);
  d.add(cfg.destruction, 'radiusPerSpeed', 0, 0.3, 0.005);
  d.add(cfg.destruction, 'maxRadius', 0.5, 6, 0.1);
  d.add(cfg.destruction, 'speedKeptPerCell', 0.9, 1, 0.001);

  gui.add(cfg.preview, 'seconds', 0, 3, 0.05).name('預覽秒數');

  const c = gui.addFolder('相機');
  c.add(cfg.camera, 'freeSpeed', 2, 60, 1);
  c.add(cfg.camera, 'lookSensitivity', 0.001, 0.02, 0.0005);
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
