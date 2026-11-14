import { buildSettingsView } from './settings-view.js';
import { apiOrigin, backFromSettings, mock, setApiOrigin } from './app.js';
import { Page, panel } from './page.js';

export class SettingsScene extends Page {
  create() {
    const view = buildSettingsView({ apiOrigin, onOriginChange: setApiOrigin, onBack: backFromSettings, practice: mock });
    this.onClose = view.stop;
    panel(this, view.el);
  }
}
