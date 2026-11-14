import { game } from './engine.js';
import { loadArt, drawStage } from './art.js';
import { GameInterface } from './interface.js';
import { DungeonRun } from './run.js';

const run = new DungeonRun();
const ui = new GameInterface(document, run, refresh);
function refresh() {
    game.scenes.go(run.screen);
}
for (const name of ['title','setup','room','boss','report']) {
    game.scenes.register({ name, enter() {
        drawStage(run);
        ui.render();
        if (run.phase === 'question') game.after(1.3, () => {
            run.resolve();
            refresh();
        });
        if (run.screen === 'room' && run.phase === 'intro') game.after(2.6, () => {
            run.battle();
            refresh();
        });
    } });
}
game.inspect.state(() => ({screen:run.screen,phase:run.phase,health:run.health,energy:run.energy,room:run.index+1}));
await loadArt();
await game.start();
refresh();
