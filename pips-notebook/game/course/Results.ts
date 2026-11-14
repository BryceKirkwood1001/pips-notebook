import { Page, panel, title } from './page.js';
import type { PublicRun, Results } from './api-client.js';
import { api, call, goTo, setRun, state } from './app.js';
import { btn, el, inline } from './ui.js';
import { reportBook } from './report.js';
import { travel } from './transition.js';
import { setArrival } from '../art.js';

export class ResultsScene extends Page {
  /** What to do next: replay the same course and rooms, read the full report, or go back to My archive. */
  private actions(run: PublicRun, report: HTMLDetailsElement) {
    return el('div', 'menu-actions results-actions',
      btn('Play this course again →', () => void this.again(run)),
      btn('Expedition report', () => { report.open = true; report.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 'alt'),
      btn('My archive', () => { setRun(null); state.results = null; goTo('Upload'); }, 'alt'));
  }

  /** A fresh expedition on the same course, rooms and target, with an empty notebook. */
  private async again(run: PublicRun) {
    await travel({ kicker: 'New expedition', title: run.courseTitle, detail: 'Pip starts over with an empty notebook. Teach one topic at a time.' }, async () => {
      const next = await call(() => api.createRun({ courseId: run.courseId, targetGrade: run.targetGrade, scope: { roomIds: run.rooms.map(r => r.id) } }));
      if (!next) return false;
      setRun(next); state.results = null; setArrival('study'); goTo('Learning');
      return true;
    });
  }

  constructor() {
    super();
  }

  async create() {
    const run = state.run;
    if (!run) return goTo('Upload');
    title(this, 'Results');
    let results: Results | null | undefined = state.results ?? run.results ?? null;
    if (!results) results = await call(() => api.getResults(run.id));
    if (!results) { panel(this, btn('Reload results', () => goTo('Results'))); return; }
    state.results = results;
    panel(this, this.render(results));
  }

  private render(r: Results): HTMLElement {
    const run = state.run!;
    const report = el('details', 'menu-report', el('summary', '', 'Expedition report'), reportBook(run));
    const root = el('div', 'results-sheet');
    root.append(
      el('h2', '', `Predicted grade: ${r.letter} (${r.predictedGradePct.toFixed(1)}%)`),
      el('div', r.metTarget ? 'ok' : 'bad', `Target ${r.target}: ${r.metTarget ? 'met' : 'not met'}`),
      el('p', 'dim', 'Your grade is the health Pip kept through the final exam. Where next?'),
      this.actions(run, report),
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
          el('b', '', `${m.conceptTitle}: `, inline(m.description)),
          el('div', 'dim', `Origin: ${m.origin}. Belief: `, inline(m.beliefStatement)),
          el('div', 'dim', 'Question: ', inline(m.questionPrompt)),
          el('div', 'ok', 'Correction: ', inline(m.correction)),
          el('div', '', `Material: ${ref.fileName}, page ${ref.page}, ${ref.sectionPath.join(' > ')}`),
          el('div', 'dim', `"${ref.quote}"`),
        ),
      );
    }
    root.append(report, this.actions(run, report));
    return root;
  }
}


