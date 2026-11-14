import { cards } from './lesson.js';
import type { Strategy } from './lesson.js';
import { DungeonRun } from './run.js';

function esc(value: string) {
    return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
const mark = '<i class="book-mark" aria-hidden="true"><b></b><b></b></i>';
const button = (action: string, label: string, secondary = false) => '<button data-action="'+action+'" class="'+(secondary?'ghost':'gold')+'">'+label+'</button>';
const gauge = (name:string, hp:number, max:number, type:string) => '<div class="gauge '+type+'"><span>'+name+'</span><strong>'+hp+' / '+max+'</strong><progress aria-label="'+name+'" max="'+max+'" value="'+hp+'"></progress></div>';
const icons = { example:'▤', analogy:'≈', question:'?', counter:'⇄' };

export class GameInterface {
    private root: HTMLElement;
    private notebookOpen = false;
    private busy = false;
    private draft = '';
    constructor(private host: Document, private run: DungeonRun, private update: () => void) {
        const style = host.createElement('link'); style.rel='stylesheet'; style.href='media/game.css'; host.head.append(style);
        host.title = "Pip's Notebook"; host.documentElement.lang = 'en';
        this.root = host.createElement('main'); this.root.className='stage'; host.body.append(this.root);
        const fit = () => {
            const scale = Math.min(host.documentElement.clientWidth / 1280,host.documentElement.clientHeight / 720);
            this.root.style.transform = 'translate(-50%, -50%) scale('+scale+')';
        };
        new ResizeObserver(fit).observe(host.documentElement); fit();
        this.root.addEventListener('click', event => {
            const target = event.target;
            if (target instanceof Element) {
                const btn = target.closest<HTMLButtonElement>('button[data-action]');
                if (btn && !btn.disabled) void this.click(btn.dataset.action!);
            }
        });
        this.root.addEventListener('input',event => {
            const field = event.target;
            if (field instanceof HTMLInputElement && field.id === 'target') {
                this.run.target=field.valueAsNumber;
                this.root.querySelector('output')!.textContent=field.value+'%';
            }
            if (field instanceof HTMLInputElement && field.id === 'words') this.draft=field.value;
        });
        this.root.addEventListener('change',event => {
            const field=event.target;
            if (field instanceof HTMLInputElement && field.type==='file') {
                for (const f of Array.from(field.files ?? [])) {
                    if (!this.run.files.some(item=>item.name===f.name && item.size===f.size)) this.run.files.push({name:f.name,size:f.size,type:f.type});
                }
                this.render();
            }
        });
        this.root.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Escape' && this.notebookOpen) void this.click('notes'); });
        this.root.addEventListener('keyup',e=>e.stopPropagation());
    }
    private async click(action:string) {
        const r=this.run;
        if(this.busy) return;
        if(action==='notes') { this.notebookOpen=!this.notebookOpen; this.render(); this.root.querySelector<HTMLElement>(this.notebookOpen?'[data-action="notes"].ghost':'[data-action="notes"]')?.focus(); return; }
        if(action==='setup') r.screen='setup';
        if(action.startsWith('remove:')) {r.files.splice(Number(action.slice(7)),1);this.render();return;}
        if(action==='start' || action==='retryLesson') {this.busy=true;try{await r.start();}finally{this.busy=false;}}
        if(action==='menu') Object.assign(r,new DungeonRun());
        if(action.startsWith('teach:')) r.teach(action.slice(6) as Strategy,this.draft.trim());
        if(action==='battle') r.battle();
        if(action==='continue') r.advance();
        if(action==='next') r.next();
        if(action==='retry') r.retry();
        if(action==='report') r.screen='report';
        this.draft='';this.notebookOpen=false;this.update();
    }
    private nav(right:string) {
        return '<header>'+mark+'<span>Pip&#39;s Notebook</span><div class="nav-right">'+right+'</div></header>';
    }
    render() {
        const r=this.run;
        this.root.dataset.screen=r.screen;
        if(r.screen==='title') {
            this.root.innerHTML=this.nav('The Lantern Archive')+'<section class="cover"><div class="eyebrow"><i></i> THE LANTERN ARCHIVE</div><h1>Pip&#39;s<br>Notebook</h1><p>Your apprentice must face the dungeon alone.<br>Train Pip to conquer the dungeon.</p>'+button('setup','Play <span>→</span>')+'</section><footer>✦ &nbsp; A dungeon for two minds</footer>';
        } else if(r.screen==='setup') {
            this.root.innerHTML=this.nav('Lesson preparation')+'<section class="sheet setup"><div class="eyebrow">LESSON PREPARATION</div><h2>Pack your lesson</h2><p>The demo explores light, shadows, and mirrors. Selected files are listed locally and are not analyzed.</p><label class="upload">＋ &nbsp; Choose study materials<input type="file" multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md,.rtf,.odt,.odp"></label><div class="files">'+r.files.map((f,i)=>'<div>'+esc(f.name)+'<button aria-label="Remove '+esc(f.name)+'" data-action="remove:'+i+'">×</button></div>').join('')+'</div><label class="target" for="target">Target score <output>'+r.target+'%</output></label><input id="target" type="range" min="0" max="100" value="'+r.target+'"><div class="ends"><span>0</span><span>100</span></div><div class="actions">'+button('start','Begin Lesson →')+button('menu','Back',true)+'</div></section>';
        } else if(r.screen==='report') this.report();
        else this.room();
        if(this.notebookOpen) this.notebook();
    }
    private room() {
        const r=this.run,boss=r.isBoss,teach=r.phase==='teach';
        const name=boss?'The Archive Keeper':r.concept.monster;
        const label=boss?'FINAL BOSS':'ROOM '+String(r.index+1).padStart(2,'0')+' / '+String(r.lesson.concepts.length).padStart(2,'0');
        let content='';
        if(teach) {
            const list=(Object.keys(cards) as Strategy[]).map(s=>{
                const c=cards[s];return '<button class="card" data-action="teach:'+s+'" '+(r.energy<c.cost?'disabled':'')+'><span class="cardtop"><b>'+icons[c.icon as keyof typeof icons]+'</b><small>◆ '+c.cost+'</small></span><strong>'+s+'</strong><span>'+c.detail+'</span></button>';
            }).join('');
            content='<div class="paneltop"><div class="eyebrow">PIP · APPRENTICE</div><b class="energy" aria-label="'+r.energy+' energy">'+('◆ '.repeat(r.energy))+('<i>◇ </i>'.repeat(3-r.energy))+' ENERGY</b></div><h3>'+esc(r.dialogue)+'</h3><div class="write"><label for="words">Teaching note</label><input id="words" maxlength="360" value="'+esc(this.draft)+'" placeholder="Write an explanation (optional)"><span>Demo: cards determine learning.</span></div><div class="cards">'+list+'</div><div class="actions right">'+button('battle','Begin Battle →',true)+'</div>';
        } else if(r.phase==='intro') {
            content='<div class="eyebrow">'+(boss?'THE FINAL EXAM':'TEACHING COMPLETE')+'</div><h2>'+name+'</h2><p>'+(boss?'Three lessons. One notebook. Pip must connect everything you taught without another hint.':esc(r.dialogue))+'</p>'+button('battle',boss?'Face the Keeper →':'Face the monster →');
        } else if(r.phase==='question' || r.phase==='answer') {
            const answered=r.phase==='answer', a=r.history[r.history.length-1];
            const q=answered?a!.question:r.currentQuestion;
            content='<div class="eyebrow">'+name.toUpperCase()+' · QUESTION '+(answered?r.rounds:r.rounds+1)+'</div><h3>'+esc(q.prompt)+'</h3>'+(answered?'<div class="response"><b>Pip</b> “'+esc(a!.words)+'”</div><div class="resolution"><strong class="'+(a!.correct?'good':'bad')+'">'+(a!.correct?'Correct':'Incorrect')+' · −'+a!.damage+' HP '+(a!.correct?'to '+name:'to Pip')+'</strong>'+button('continue','Continue →')+'</div>':'<p class="thinking">Pip is consulting the notebook…</p>');
        } else {
            const won=r.phase==='won';
            content='<div class="eyebrow">'+(won?'VICTORY':'DEFEAT')+'</div><h2>'+(won?(boss?'The archive is yours.':'Room cleared.'):'Pip fell in battle.')+'</h2><p>'+(boss?'“I figured it out with what you taught me!”':won?'Continue with '+r.health+' health, or teach this room again.':'Try another teaching strategy, or review this run.')+'</p><div class="actions">'+(won?button('next',boss?'View report →':r.index+1===r.lesson.concepts.length?'Enter Final Boss →':'Next Room →'):'')+(!boss?button('retry','Retry Room',won):'')+(!won?button('report','End Run',true):'')+'</div>';
        }
        this.root.innerHTML=this.nav('<button class="navbutton" data-action="notes">▤ &nbsp; Notebook</button>')+'<div class="roomname"><div class="eyebrow">'+label+' · '+(teach?'TEACHING':'COMBAT')+'</div><h2>'+(boss?'The final examination':esc(r.concept.title))+'</h2></div><div class="hud">'+gauge('Pip · Health',r.health,100,'pip')+(!teach?gauge(name,r.monster,r.maxMonster,'foe'):'')+'</div><section aria-live="polite" class="console '+(teach?'teaching':'battle')+'">'+content+'</section>';
    }
    private notebook() {
        const r=this.run;
        const view=this.host.createElement('div');view.className='veil';
        view.innerHTML='<section role="dialog" aria-modal="true" aria-label="Apprentice notebook" class="sheet journal"><div class="paneltop"><h2>Pip’s notebook</h2>'+button('notes','Close ×',true)+'</div>'+Object.values(r.notebook).map(e=>'<article><h3>'+esc(e.title)+'</h3><small>Understanding '+e.understanding+' · Reasoning '+e.reasoning+'</small>'+(e.notes.length?e.notes.map(n=>'<p><b>'+n.strategy+'</b> '+(n.words?'“'+esc(n.words)+'” · ':'')+esc(n.change)+'</p>').join(''):'<p>A fresh page.</p>')+'</article>').join('')+'</section>';
        for(const el of Array.from(this.root.children)) if(el instanceof HTMLElement) el.inert=true;
        this.root.append(view);
    }
    private report() {
        const r=this.run, correct=r.history.filter(a=>a.correct).length;
        const rows=Object.entries(r.notebook).map(([key,e])=>{
            const events=r.history.filter(a=>a.question.needs.includes(Number(key)));
            const mistakes=r.history.filter(a=>a.boss && a.cause && e.notes.some(n=>n.change==='Inferred: '+a.cause));
            return '<article><div class="paneltop"><b>'+esc(e.title)+'</b><small>'+events.filter(a=>a.correct).length+' / '+events.length+' correct</small></div>'+e.notes.filter(n=>n.change.startsWith('Inferred:') || n.change.startsWith('Corrected:')).map(n=>'<p>'+esc(n.change)+(n.words?' · “'+esc(n.words)+'”':'')+'</p>').join('')+(mistakes.length?'<p class="bad">This belief affected '+mistakes.length+' boss answer(s).</p>':'')+'</article>';
        }).join('');
        const result=r.victory?(r.health>=r.target?'Target achieved':'Below target'):'Defeat';
        this.root.innerHTML=this.nav('Expedition report')+'<section class="sheet report"><div class="eyebrow">LESSON REPORT</div><h2>'+result+'</h2><p>Final health is your game score, not a validated academic grade.</p><div class="numbers"><div><strong>'+r.health+'%</strong>Final health</div><div><strong>'+r.target+'%</strong>Target</div><div><strong>'+r.completed+'/'+r.lesson.concepts.length+'</strong>Rooms cleared</div></div><h3>'+correct+' correct · '+(r.history.length-correct)+' incorrect</h3><div class="results">'+rows+'</div><div class="actions">'+button('retryLesson','Retry Lesson ↻')+button('menu','Main Menu',true)+'</div></section>';
    }
}
