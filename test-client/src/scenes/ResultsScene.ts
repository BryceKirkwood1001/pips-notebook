import Phaser from 'phaser';
import type { Results } from '@top/shared/api-client';
import { api, call, goTo, setRun, state } from '../app';
import { btn, el, panel, title } from '../ui';

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('Results');
  }

  async create() {
    const run = state.run;
    if (!run) return goTo('Upload');
    title(this, `${run.studentEmoji}  Results`);
    let results: Results | null | undefined = state.results ?? run.results ?? null;
    if (!results) results = await call(() => api.getResults(run.id));
    if (!results) return;
    state.results = results;
    panel(this, 20, 56, 1060, 650, this.render(results));
  }

  private render(r: Results): HTMLElement {
    const root = el('div');
    root.append(
      el('h2', '', `Predicted grade: ${r.letter} (${r.predictedGradePct.toFixed(1)}%)`),
      el('div', r.metTarget ? 'ok' : 'bad', `Target ${r.target}: ${r.metTarget ? 'MET' : 'not met'}`),
      el('h3', '', 'Accuracy per concept'),
    );
    for (const c of r.conceptAccuracy) {
      const bar = el('span', 'bar');
      bar.style.width = `${Math.round(c.accuracy * 200)}px`;
      root.append(el('div', '', `${c.title}: ${c.correct}/${c.total} (${Math.round(c.accuracy * 100)}%) `, bar));
    }
    const h = r.helpMe;
    root.append(
      el('h3', '', '"Help me!" stats'),
      el('div', '', `Offered ${h.offered}, correct ${h.correct}, wrong ${h.wrong}, late ${h.late}, average solve time ${h.avgSolveTimeSec === null ? 'n/a' : `${h.avgSolveTimeSec}s`}`),
      el('h3', '', `Costly misconceptions (${r.costlyMisconceptions.length})`),
    );
    if (!r.costlyMisconceptions.length) root.append(el('div', 'dim', 'None.'));
    for (const m of r.costlyMisconceptions) {
      const ref = m.materialRef;
      root.append(
        el(
          'div', 'box',
          el('b', '', `${m.conceptTitle}: ${m.description}`),
          el('div', 'dim', `Origin: ${m.origin}. Belief: ${m.beliefStatement}`),
          el('div', 'dim', `Question: ${m.questionPrompt}`),
          el('div', 'ok', `Correction: ${m.correction}`),
          el('div', '', `Material: ${ref.fileName}, page ${ref.page}, ${ref.sectionPath.join(' > ')}`),
          el('div', 'dim', `"${ref.quote}"`),
        ),
      );
    }
    root.append(btn('Start over', () => {
      setRun(null);
      state.results = null;
      goTo('Upload');
    }));
    return root;
  }
}
