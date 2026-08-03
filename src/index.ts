/** cellstructs Phase 1 bootstrap: data layer → living cell renderer + HUD. */

import { loadConfig } from './config/endpoints';
import { DataManager } from './data/dataManager';
import { CellApp } from './render/cellApp';
import { Hud } from './ui/hud';
import { SettingsPanel } from './ui/settingsPanel';

async function main(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const cellApp = new CellApp();
  await cellApp.mount(stage);

  const hud = new Hud();
  let manager: DataManager | null = null;

  const start = (cfg = loadConfig()): void => {
    manager?.stop();
    manager = new DataManager(cfg, {
      onSnapshot: (snap) => {
        cellApp.applySnapshot(snap);
        hud.update(snap);
      },
      onEvents: (events) => cellApp.pushEvents(events),
    });
    manager.start();
  };

  new SettingsPanel((cfg) => start(cfg));
  start();
}

void main();
