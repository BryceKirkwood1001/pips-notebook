import { game } from './engine.js';
import { loadArt } from './art.js';
import { goTo, resume, setRun, state, type Screen } from './course/app.js';
import { frame, mount, Page, panel } from './course/page.js';
import { btn, el } from './course/ui.js';
import { UploadScene } from './course/Upload.js';
import { LearningScene } from './course/Learning.js';
import { ResultsScene } from './course/Results.js';
import { arena, Battle } from './course/battle.js';
import { SettingsScene } from './course/Settings.js';

mount();
const screens:Screen[]=['Title','Upload','Learning','Fight','Boss','Results','Settings'];
let page:Page;
for(const name of screens) game.scenes.register({name,enter(){
    const screen={Title:'title',Upload:'setup',Learning:'room',Fight:'room',Boss:'boss',Results:'report',Settings:'settings'}[name];
    frame(screen);arena(state.run,screen);
    if(name==='Title'){
        page=new Page();
        const id=new URLSearchParams(location.search).get('run');
        const heading=el('h1','','Teach',el('br'),el('em','','or'),' Perish');
        panel(page,el('div','',heading,el('p','','Your apprentice must face the dungeon alone. All Pip can carry is what you teach.'),
            btn(id?'Resume run':'Play →',()=>id?void resume(id):goTo('Upload')),
            id?btn('New lesson',()=>{setRun(null);goTo('Upload');},'alt'):null));
        if(id)void resume(id);
    }else {
        const next=name==='Upload'?new UploadScene():name==='Learning'?new LearningScene():name==='Results'?new ResultsScene():name==='Settings'?new SettingsScene():new Battle(name==='Boss');
        page=next;void next.create();
    }
},exit(){page?.close();}});
game.inspect.state(()=>({screen:state.run?.phase??'menu',room:state.run?.roomIndex}));
await loadArt();await game.start();goTo('Title');
