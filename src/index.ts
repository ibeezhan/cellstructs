/** cellstructs bootstrap: data layer → living cell renderer + overlay UI. */

import { ActionPipeline } from './actions/dispatch';
import { READ_ONLY, loadConfig } from './config/endpoints';
import { DataManager } from './data/dataManager';
import { CellApp } from './render/cellApp';
import { DetailPanel } from './ui/detailPanel';
import { Hud } from './ui/hud';
import { PortalDialog } from './ui/portalDialog';
import { ScanPopup } from './ui/scanPopup';
import { SettingsPanel } from './ui/settingsPanel';
import { Tooltip } from './ui/tooltip';

async function main(): Promise<void> {
  // Hosted read-only build: swaps the endpoint fields and flags the mode.
  if (READ_ONLY) document.body.classList.add('hosted');

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
  const detail = new DetailPanel(pipeline, READ_ONLY);

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
        // Own-player events shouldn't animate someone else's cell while the
        // portal is showing a remote planet; receipts always flow through.
        if (!manager?.isRemoteView()) cellApp.pushEvents(events);
        pipeline.handleEvents(events);
      },
    });
    manager.start();
    // Which actions the :8420 surface really exposes → disable the rest.
    void manager.getSupportedActions().then((set) => detail.setSupportedActions(set));
  };

  new SettingsPanel((cfg) => start(cfg));

  const portal = new PortalDialog(
    async (query) => {
      if (!manager) throw new Error('data layer not started yet');
      const hit = await manager.portalTo(query);
      cellApp.scanPulse();
      return hit;
    },
    async () => {
      if (!manager) throw new Error('data layer not started yet');
      await manager.portalHome();
    },
    () => cellApp.viewCell(),
  );

  const scan = new ScanPopup(
    async (query, filters) => {
      if (!manager) throw new Error('data layer not started yet');
      cellApp.scanPulse();
      return manager.scanUniverse(query, filters);
    },
    (planetId) => void portal.go(planetId),
  );

  document.getElementById('menu-scan')!.addEventListener('click', () => scan.toggle());
  document.getElementById('menu-view')!.addEventListener('click', () => portal.toggle());
  document.getElementById('menu-recenter')!.addEventListener('click', () => cellApp.viewCell());

  start();

  // dev/debug hook (used by the headless verification harness)
  (window as unknown as { cellstructs: object }).cellstructs = { cellApp, detail, pipeline, portal, scan };
}

void main();
