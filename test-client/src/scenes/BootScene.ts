import Phaser from 'phaser';
import { api, call, goTo, params, sceneForPhase, setRun, state } from '../app';

/** Resume: with ?run=<id> load the run and jump to the scene for its phase. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  async create() {
    const runId = params.get('run');
    if (!runId) return goTo('Upload');
    const run = await call(() => api.getRun(runId));
    if (!run) {
      setRun(null);
      return goTo('Upload');
    }
    setRun(run);
    state.results = run.results ?? null;
    goTo(sceneForPhase(run.phase));
  }
}
