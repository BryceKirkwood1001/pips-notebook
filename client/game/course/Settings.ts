import { buildSettingsView } from './settings-view.js';
import { afterStorageSwitch, apiOrigin, backFromSettings, mock, setApiOrigin } from './app.js';
import { Page, panel } from './page.js';

export class SettingsScene extends Page {
  create() {
    const view = buildSettingsView({ apiOrigin, onOriginChange: setApiOrigin, onStorageChange: afterStorageSwitch, onBack: backFromSettings, practice: mock });
    this.onClose = view.stop;
    panel(this, view.el);
  }
}
