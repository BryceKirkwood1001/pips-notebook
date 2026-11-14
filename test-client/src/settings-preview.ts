/** Real game settings component, available even before the separate Phaser runtime is restored. */
import '../../teach-or-perish/game/media/game.css';
import background from '../../teach-or-perish/game/media/concept_room_background.png';
import { buildSettingsView } from '../../teach-or-perish/game/course/settings-view';

const params = new URLSearchParams(location.search);
let origin = params.get('api') || 'http://localhost:8787';
try { origin = params.get('api') || localStorage.getItem('top.apiOrigin') || origin; } catch { /* Optional browser preference. */ }
const stage = document.createElement('main'); stage.className = 'stage course-stage'; stage.dataset.screen = 'settings';
stage.style.backgroundImage = `linear-gradient(90deg,#190f1bd9,#21121d85),url(${background})`;
const header = document.createElement('header'); header.innerHTML = '<span>Teach or Perish</span><div class="nav-right">The Lantern Archive</div>';
const sheet = document.createElement('section'); sheet.className = 'sheet course-sheet';
const view = buildSettingsView({ apiOrigin: origin,
  onOriginChange(next) {
    try { localStorage.setItem('top.apiOrigin', next); } catch { /* No keys are stored in this browser. */ }
    const url = new URL(location.href); url.searchParams.set('api', next); history.replaceState(null, '', url);
  },
  onBack: () => { location.href = '/' + location.search; },
});
sheet.append(view.el); stage.append(header, sheet); document.body.append(stage);
const fit = () => { const scale = Math.min(innerWidth / 1280, innerHeight / 720); stage.style.transform = `translate(-50%,-50%) scale(${scale})`; };
addEventListener('resize', fit); fit();
addEventListener('pagehide', view.stop);
