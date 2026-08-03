/**
 * Endpoint settings panel (spec §2): desktop API URL + bearer token, RPC URL,
 * optional player pin. Persists to localStorage; saving reconnects the data
 * layer so the app can point at a remote node later without a rebuild.
 */

import { AppConfig, loadConfig, resetConfig, saveConfig } from '../config/endpoints';

const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

export class SettingsPanel {
  constructor(private onApply: (cfg: AppConfig) => void) {
    const panel = document.getElementById('settings')!;
    document.getElementById('settings-toggle')!.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) this.fill(loadConfig());
    });

    document.getElementById('cfg-save')!.addEventListener('click', () => {
      const cfg: AppConfig = {
        desktopApiUrl: input('cfg-api').value.trim() || '/desktop',
        desktopApiToken: input('cfg-token').value.trim(),
        rpcUrl: input('cfg-rpc').value.trim() || '/rpc',
        playerId: input('cfg-player').value.trim(),
      };
      saveConfig(cfg);
      panel.classList.remove('open');
      this.onApply(cfg);
    });

    document.getElementById('cfg-reset')!.addEventListener('click', () => {
      resetConfig();
      const cfg = loadConfig();
      this.fill(cfg);
      this.onApply(cfg);
    });
  }

  private fill(cfg: AppConfig): void {
    input('cfg-api').value = cfg.desktopApiUrl;
    input('cfg-token').value = cfg.desktopApiToken;
    input('cfg-rpc').value = cfg.rpcUrl;
    input('cfg-player').value = cfg.playerId;
  }
}
