import { api, call, goTo, sceneForPhase, setRun, state } from './app.js';
import type { Answer, HelpMeTurn, PublicRun, TurnResult } from './api-client.js';
import { buildHelp } from './help.js';
import { Page, panel, stage, title } from './page.js';
import { btn, el, mdToEl, questionEl } from './ui.js';
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
        const stats=this.boss?'Health '+run.boss!.health+'/100':'Hearts '+run.room!.hearts+'/'+run.room!.maxHearts+' · Attempt '+run.room!.attempt;
        title(this,(this.boss?'Final examination':run.currentRoom?.title ?? 'Room battle')+' · '+stats);
        const journal=el('details','',el('summary','','Student notebook'),mdToEl(run.notebookMd));
        const log=el('div','turns');
        for(const event of fight.log) {
            if(event.kind==='student_answer' || event.kind==='help_result') {
                const item=el('details','box',el('summary','',event.question.prompt+' · '+(event.correct?'Correct':'Incorrect')),questionEl(event.question));
                if(event.kind==='student_answer') item.append(el('p','','Student: '+event.answerText),el('p','','Reasoning: '+event.reasoning),
                    el('p','','Cited notes: '+(event.citedNotes.join(' · ') || 'None')),event.reason?el('p','',event.reason):'');
                else item.append(el('p','',event.late?'Help arrived late':'Help answered in '+event.solveTimeSec+'s'),event.noteAdded?el('p','','Notebook: '+event.noteAdded):'');
                item.append(el('p','','Correct answer: '+event.correctAnswer.text),el('p','',event.explanation),el('small','','Damage: '+event.damage));
                log.prepend(item);
            }
        }
        log.querySelector('details')?.setAttribute('open','');
        const step=btn(run.phase==='room_result'||run.phase==='results'?'Show result':'Next turn',()=>void this.step());
        const actions=el('div','actions',step);
        const summary=this.summary;
        if(summary) {
            actions.replaceChildren(el('b','',summary.passed?'Room cleared!':'Room failed'),btn(summary.passed?'Continue':'Retry room',async()=>{
                const next=await call(()=>summary.passed?api.continueRun(run.id):api.retry(run.id));
                if(next) {setRun(next);goTo(sceneForPhase(next.phase));}
            }));
            for(const f of summary.failedTurns) log.prepend(el('article','box',questionEl(f.question),el('p','',f.reasoning),el('p','','Cited: '+f.citedNotes.join(' · '))));
        }
        panel(this,el('div','',el('div','paneltop',el('b','','Question '+fight.turn+' / '+fight.totalTurns),journal),actions,log));
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
        const modal=el('div','veil',el('section','sheet journal',built.el));
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
                delete run.pendingHelpMe;
                const fight=this.boss?run.boss!:run.room!;
                fight.log.push(event);fight.turn++;
                if(event.hearts!==undefined && run.room) run.room.hearts=event.hearts;
                if(event.health!==undefined && run.boss) run.boss.health=event.health;
                if(event.kind==='help_result' && event.noteAdded) run.notebookMd+='\n- '+event.noteAdded;
                run.phase=event.phaseAfter;
                this.create();
                animateAnswer(event.correct);
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

