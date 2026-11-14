import { game } from './engine.js';
import { loadArt } from './art.js';
import { goTo, openCoursePicker, openSettings, resume, state, type Screen } from './course/app.js';
import { frame, mount, musicButton, Page, panel } from './course/page.js';
import { btn, el } from './course/ui.js';
import { UploadScene } from './course/Upload.js';
import { LearningScene } from './course/Learning.js';
import { ResultsScene } from './course/Results.js';
import { arena, Battle } from './course/battle.js';
import { SettingsScene } from './course/Settings.js';
import { MenuScene } from './course/Menu.js';
import { playSceneMusic } from './course/soundtrack.js';

mount();
const screens:Screen[]=['Title','Upload','Learning','Fight','Boss','Results','Settings','Menu'];
let page:Page;
for(const name of screens) game.scenes.register({name,enter(){
    playSceneMusic(name);
    const screen={Title:'title',Upload:'setup',Learning:'room',Fight:'room',Boss:'boss',Results:'report',Settings:'settings',Menu:'menu'}[name];
    frame(screen);arena(state.run,screen);
    if(name==='Title'){
        page=new Page();
        const id=new URLSearchParams(location.search).get('run');
        const heading=el('h1', '', "Pip's", el('br'), 'Notebook');
        const menu=el('nav','title-actions',
            btn('Play',()=>id?void resume(id):openCoursePicker('Create New Dungeon')),
            btn('My archive',()=>openCoursePicker('Library'),'alt'),
            btn('Settings',openSettings,'alt'),musicButton());
        menu.setAttribute('aria-label','Main menu');
        panel(page,el('div','title-menu',heading,
            el('p','','Train Pip to conquer the dungeon.'),menu));
        if(id)void resume(id);
    }else {
        const next=name==='Upload'?new UploadScene():name==='Learning'?new LearningScene():name==='Results'?new ResultsScene():name==='Settings'?new SettingsScene():name==='Menu'?new MenuScene():new Battle(name==='Boss');
        page=next;void next.create();
    }
},exit(){page?.close();}});
game.inspect.state(()=>({screen:state.run?.phase??'menu',room:state.run?.roomIndex}));
await loadArt();await game.start();goTo('Title');
