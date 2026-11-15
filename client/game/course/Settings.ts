import { buildSettingsView } from './settings-view.js';
import { afterStorageSwitch, api, backFromSettings, mock } from './app.js';
import { Page, panel } from './page.js';

export class SettingsScene extends Page {
  create() {
    const view = buildSettingsView({ api, onStorageChange: afterStorageSwitch, onBack: backFromSettings, practice: mock });
    this.onClose = view.stop;
    panel(this, view.el);
  }
}
