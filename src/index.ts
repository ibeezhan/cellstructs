/** cellstructs bootstrap: data layer → living cell renderer + overlay UI. */

import { ActionPipeline } from './actions/dispatch';
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
  let manager: DataManager | null = null;

  // Action pipeline: panel button → structs_action on :8420 (desktop signs)
  // → tx_settled receipt from the event feed → organelle animation response.
  const pipeline = new ActionPipeline({
    submitAction: (action, args) => {
      if (!manager) return Promise.reject(new Error('data layer not started yet'));
      return manager.submitAction(action, args);
    },
  });
  pipeline.onEffect = (action, structId) => cellApp.actionEffect(action, structId);
  const detail = new DetailPanel(pipeline);

  cellApp.onHover = (pick, x, y) => (pick ? tooltip.show(pick, x, y) : tooltip.hide());
  cellApp.onSelect = (pick) => detail.show(pick);

  const start = (cfg = loadConfig()): void => {
    manager?.stop();
    detail.setSupportedActions(null);
    manager = new DataManager(cfg, {
      onSnapshot: (snap) => {
        cellApp.applySnapshot(snap);
        hud.update(snap);
        detail.refresh(snap);
      },
      onEvents: (events) => {
        cellApp.pushEvents(events);
        pipeline.handleEvents(events);
      },
    });
    manager.start();
    // Which actions the :8420 surface really exposes → disable the rest.
    void manager.getSupportedActions().then((set) => detail.setSupportedActions(set));
  };

  new SettingsPanel((cfg) => start(cfg));

  document.getElementById('menu-scan')!.addEventListener('click', () => {
    cellApp.scanPulse();
    void manager?.refreshNow();
  });
  document.getElementById('menu-view')!.addEventListener('click', () => cellApp.viewCell());

  start();

  // dev/debug hook (used by the headless verification harness)
  (window as unknown as { cellstructs: object }).cellstructs = { cellApp, detail, pipeline };
}

void main();
