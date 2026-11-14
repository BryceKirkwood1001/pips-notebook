import { api, call, goTo, sceneForPhase, setRun, state } from './app.js';
import type { Answer, HelpMeTurn, PublicRun, TurnResult } from './api-client.js';
import { buildHelp } from './help.js';
import { Page, panel, RoomView, stage, title } from './page.js';
import { btn, el, mdToEl } from './ui.js';
import { turnCard } from './battle-feedback.js';
import { drawStage, playAttack } from '../art.js';
import { game } from '../engine.js';

export class Battle extends Page {
    private summary?: Extract<TurnResult,{kind:'room_end'}>;
    private stopHelp=()=>{};
    constructor(private boss:boolean) { super();this.onClose=()=>this.stopHelp(); }
    create() {
        const run=state.run!;
        const fight=this.boss?run.boss:run.room;
        if(!fight) {goTo(sceneForPhase(run.phase));return;}
        const stats=this.boss?'Health '+Number(run.boss!.health.toFixed(1))+'/100':'Hearts '+run.room!.hearts+'/'+run.room!.maxHearts+' · Attempt '+run.room!.attempt;
        title(this,this.boss?'Final examination':run.currentRoom?.title ?? 'Room battle');
        const view = new RoomView();
        view.root.append(el('div','battle-status',stats));
        const log=el('div','turns');
        for(const event of fight.log) {
            if(event.kind==='student_answer' || event.kind==='help_result') {
                log.prepend(turnCard(event));
            }
        }
        log.querySelector('details')?.setAttribute('open','');
        const step=btn(run.phase==='room_result'||run.phase==='results'?'Show result':'Next turn',()=>void this.step());
        const actions=view.actions;
        actions.append(step);
        const summary=this.summary;
        if(summary) {
            actions.replaceChildren(el('b','',summary.passed?'Room cleared!':'Room failed'),btn(summary.passed?'Continue':'Retry room',async()=>{
                const next=await call(()=>summary.passed?api.continueRun(run.id):api.retry(run.id));
                if(next) {setRun(next);goTo(sceneForPhase(next.phase));}
            }));
        }
        view.inventory.append(view.entry('Notebook', 'Pip’s notebook', mdToEl(run.notebookMd)));
        if (log.childElementCount) view.inventory.append(view.entry('Battle log', 'Battle chronicle', log));
        if (!summary) actions.prepend(el('span', 'turn-count', 'Answered ' + Math.min(fight.turn, fight.totalTurns) + ' of ' + fight.totalTurns));
        panel(this, view.root);
        if(run.pendingHelpMe) this.helpModal(run.pendingHelpMe);
    }
    private helpModal(event:HelpMeTurn) {
        const submit=async(answer:Answer)=>{
            const result=await call(()=>api.help(state.run!.id,event.eventId,answer));
            if(!this.active) return;
            this.stopHelp();
            if(result) await this.handle(result);
            else {panel(this,btn('Refresh help request',()=>void this.sync()));}
        };
        const content=stage.querySelector<HTMLElement>('section')!;
        const built=buildHelp(event,a=>void submit(a));
        const modal=el('div','veil',el('section','folio help-folio',built.el));
        modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Help your student');
        content.inert=true;stage.append(modal);
        const header=stage.querySelector('header')!;
        header.inert=true;
        modal.querySelector<HTMLElement>('input,button')?.focus();
        this.stopHelp=()=>{built.stop();modal.remove();content.inert=false;header.inert=false;};
    }
    private async sync(){
        const run=await call(()=>api.getRun(state.run!.id));
        if(run){setRun(run);goTo(sceneForPhase(run.phase));}
    }
    private async step() {
        const result=await call(()=>api.turn(state.run!.id));
        if(result && this.active) await this.handle(result);
    }
    private async handle(event:TurnResult) {
        const run=state.run!;
        switch(event.kind){
            case 'boss_end':
                state.results=event.results;setRun({...run,phase:'results'});goTo('Results');return;
            case 'room_end':
                this.summary=event;
                if(run.room){run.room.hearts=event.hearts;run.room.passed=event.passed;}
                this.create();return;
            case 'help_me':
                run.pendingHelpMe=event;this.helpModal(event);return;
            case 'student_answer':
            case 'help_result': {
                const snapshot=await call(()=>api.getRun(run.id));
                if(!this.active)return;
                if(snapshot) setRun(snapshot);
                else {
                    delete run.pendingHelpMe;
                    const fight=this.boss?run.boss!:run.room!;
                    fight.log.push(event);fight.turn++;
                    if(event.hearts!==undefined && run.room) run.room.hearts=event.hearts;
                    if(event.health!==undefined && run.boss) run.boss.health=event.health;
                    run.phase=event.phaseAfter;
                }
                this.create();
                animateAnswer(event.correct);
                const cue = el('div', 'battle-cue ' + (event.correct ? 'hit' : 'miss'),
                    event.correct ? 'Pip answered correctly!' : 'The slime lands a hit!');
                cue.setAttribute('role','status');
                stage.querySelector('.room-view')?.append(cue);
                game.after(2.6, () => cue.remove());
            }
        }
    }
}
export function arena(run:PublicRun|null,screen:string) {
    drawStage({screen,isBoss:screen==='boss',index:run?.roomIndex??0,victory:screen==='report',
        phase:run?.phase==='learning'?'teach':run?.room?.passed && screen==='room'?'won':'intro'});
}
function animateAnswer(correct:boolean) {
    playAttack(correct);
    const attacker=game.roster.tagged(correct?'student':'monster')[Symbol.iterator]().next().value;
    const victim=game.roster.tagged(correct?'monster':'student')[Symbol.iterator]().next().value;
    if(attacker)game.tween.to(attacker,{x:attacker.x+(correct?100:-100)},{duration:.14,yoyo:true});
    if(victim)game.tween.from(victim,{alpha:.15},{duration:.4});
}

