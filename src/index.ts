/** cellstructs bootstrap: data layer → living cell renderer + overlay UI. */

import { loadConfig } from './config/endpoints';
import { DataManager } from './data/dataManager';
import { CellApp } from './render/cellApp';
import { DetailPanel } from './ui/detailPanel';
import { Hud } from './ui/hud';
import { SettingsPanel } from './ui/settingsPanel';
import { Tooltip } from './ui/tooltip';

async function main(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const cellApp = new CellApp();
  await cellApp.mount(stage);

  const hud = new Hud();
  const tooltip = new Tooltip();
  const detail = new DetailPanel();
  let manager: DataManager | null = null;

  cellApp.onHover = (pick, x, y) => (pick ? tooltip.show(pick, x, y) : tooltip.hide());
  cellApp.onSelect = (pick) => detail.show(pick);

  const start = (cfg = loadConfig()): void => {
    manager?.stop();
    manager = new DataManager(cfg, {
      onSnapshot: (snap) => {
        cellApp.applySnapshot(snap);
        hud.update(snap);
        detail.refresh(snap);
      },
      onEvents: (events) => cellApp.pushEvents(events),
    });
    manager.start();
  };

  new SettingsPanel((cfg) => start(cfg));

  document.getElementById('menu-scan')!.addEventListener('click', () => {
    cellApp.scanPulse();
    void manager?.refreshNow();
  });
  document.getElementById('menu-view')!.addEventListener('click', () => cellApp.viewCell());

  start();

  // dev/debug hook (used by the headless verification harness)
  (window as unknown as { cellstructs: object }).cellstructs = { cellApp };
}

void main();
