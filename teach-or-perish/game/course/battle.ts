import { api, call, goTo, openMenu, sceneForPhase, setRun, state } from './app.js';
import type { Answer, HelpMeTurn, PublicQuestion, PublicRun, TurnResult } from './api-client.js';
import { buildHelp } from './help.js';
import { atWorld, Page, panel, RoomView, stage, title } from './page.js';
import { btn, clock, el, mdToEl, questionEl } from './ui.js';
import { turnCard } from './battle-feedback.js';
import { attemptStats } from './report.js';
import { travel } from './transition.js';
import { DANGER_LEVELS, defeatFoe, defeatPip, drawStage, encounterFor, POS, setArrival, strike } from '../art.js';

/** Nameplates sit this far above each actor's centre, in world units: just over the head. */
const PIP_PLATE_Y = POS.pip.y - 102;
/** Floating hit labels and the battle banner are removed after this long even without animation events. */
const POP_MS = 1300;
/**
 * Each turn's question flies out of the foe to the centre, stays long enough to read (base + per character, capped;
 * a click moves on), then retracts into the foe while Pip thinks. Pip's thought bubble stays at least MIN_THINK_MS.
 */
const CAST_IN_MS = 450, CAST_OUT_MS = 400, CAST_BASE_MS = 1300, CAST_PER_CHAR_MS = 22, CAST_MAX_MS = 4200, MIN_THINK_MS = 900;
/** Pip's thought bubble floats beside Pip's head, toward the middle of the arena (world units). */
const THOUGHT_X = POS.pip.x + 150, THOUGHT_Y = POS.pip.y - 78;
/** Wrong answers listed on the defeat card (the battle log has all of them). */
const TRACE_SHOWN = 2;

type AnswerTurn = Extract<TurnResult, { kind: 'student_answer' | 'help_result' }>;
type RoomEnd = Extract<TurnResult, { kind: 'room_end' }>;

export class Battle extends Page {
    private summary?: RoomEnd;
    private stopHelp=()=>{};
    private introduced=false;
    private askedResult=false;
    private leaving=false;
    constructor(private boss:boolean) { super();this.onClose=()=>this.stopHelp(); }

    create() {
        const run=state.run!;
        const fight=this.boss?run.boss:run.room;
        if(!fight) {goTo(sceneForPhase(run.phase));return;}
        title(this,this.boss?'Final examination':run.currentRoom?.title ?? 'Room battle');
        const view = new RoomView();
        const turns=fight.log.filter((e):e is AnswerTurn=>e.kind==='student_answer'||e.kind==='help_result');
        const log=el('div','turns');
        for(const event of turns) log.prepend(turnCard(event));
        log.querySelector('details')?.setAttribute('open','');
        const plates=this.plates(run);
        // On a fresh fight the fighters walk in first; their nameplates follow.
        if (!this.introduced && !turns.length) plates.forEach(p=>p.classList.add('arriving'));
        view.root.append(...plates);
        view.inventory.append(view.entry('Notebook', 'Pip’s notebook', mdToEl(run.notebookMd)));
        const summary=this.summary;
        if (turns.length) {
            const book=view.entry('Battle log', 'Battle chronicle', log);
            view.inventory.append(book);
            if (!summary) view.root.append(this.outcome(turns, book, log));
        }
        stage.classList.toggle('ending', !!summary);
        if (summary) view.root.append(summary.passed ? this.victory(run, turns) : this.defeat(run, summary));
        else {
            const over=run.phase==='room_result'||run.phase==='results';
            view.actions.append(el('span', 'turn-count', `Question ${Math.min(fight.turn+1, fight.totalTurns)} of ${fight.totalTurns}`),
                btn(over?'Show result':'Next turn →',()=>void this.step()));
            if (over && !this.askedResult) { this.askedResult=true; void this.step(); }
        }
        if (!this.introduced && !turns.length && !run.pendingHelpMe && !summary) view.root.append(this.banner(this.boss?'Final exam!':'Battle start!'));
        this.introduced=true;
        panel(this, view.root);
        if(run.pendingHelpMe) this.helpModal(run.pendingHelpMe);
    }

    // ── HUD pieces ───────────────────────────────────────────────────────────

    private plates(run: PublicRun) {
        const fight=(this.boss?run.boss:run.room)!;
        const life = this.boss
            ? meter(run.boss!.health, 100, `Grade ${Math.round(run.boss!.health)}%`)
            : hearts(run.room!.hearts, run.room!.maxHearts);
        const pip = atWorld(el('div', 'plate pip-plate', el('strong', '', 'Pip'), life), POS.pip.x, PIP_PLATE_Y);
        const left = Math.max(0, fight.totalTurns - fight.turn);
        const foeAt = encounterFor(run.roomIndex, run.rooms.length, this.boss);
        const foe = atWorld(el('div', 'plate foe-plate', el('strong', '', foeAt.name),
            foeAt.danger === null ? null : danger(foeAt.danger),
            el('span', 'plate-sub', `${left} question${left === 1 ? '' : 's'} left`), segments(left, fight.totalTurns)),
            foeAt.x, foeAt.plateY);
        pip.setAttribute('aria-label', this.boss ? `Pip: grade ${Math.round(run.boss!.health)} percent` : `Pip: ${run.room!.hearts} of ${run.room!.maxHearts} hearts`);
        foe.setAttribute('aria-label', `${foeAt.name}${foeAt.danger === null ? '' : `, danger ${foeAt.danger + 1} of ${DANGER_LEVELS}`}: ${left} of ${fight.totalTurns} questions left`);
        return [pip, foe];
    }

    /** The latest turn stays on screen; clicking it opens that turn in the battle log. */
    private outcome(turns: AnswerTurn[], book: HTMLButtonElement, log: HTMLElement) {
        const latest=turns[turns.length-1]!;
        const label=latest.kind==='help_result'?'Your help':'Pip’s answer';
        const result=latest.kind==='help_result'&&latest.late?'Time expired':latest.correct?'Correct':'Incorrect';
        const damage=latest.damage===0?'No damage':`${Number(latest.damage.toFixed(1))} ${this.boss?'health':'heart'} lost`;
        const outcome=btn('',()=>{
            if(book.getAttribute('aria-expanded')!=='true')book.click();
            const card=log.querySelector<HTMLDetailsElement>('details');
            if(card){card.open=true;card.scrollIntoView({block:'nearest'});card.querySelector('summary')?.focus();}
        },'turn-outcome-panel');
        outcome.append(el('small','',`Turn ${turns.length} · ${label}`),el('strong',latest.correct?'ok':'bad',`${result} · ${damage}`),
            el('span','outcome-question',latest.question.prompt),el('span','outcome-link','See how this turn played out →'));
        outcome.setAttribute('aria-label',`Turn ${turns.length} outcome: ${result}. ${damage}. Open battle log`);
        return outcome;
    }

    private banner(text: string) {
        const node = el('div', 'fight-banner', text);
        node.setAttribute('aria-hidden', 'true');
        node.addEventListener('animationend', () => node.remove());
        clock.setTimeout(() => node.remove(), POP_MS + 500); // also gone when motion is reduced
        return node;
    }

    private victory(run: PublicRun, turns: AnswerTurn[]) {
        const room=run.room!;
        const record=run.history?.filter(h=>h.roomId===run.currentRoom?.id).at(-1);
        const correct=turns.filter(t=>t.correct).length;
        const nextIndex=run.roomIndex+1;
        const toBoss=nextIndex>=run.rooms.length;
        const stars=Math.max(1, Math.round((room.hearts/room.maxHearts)*3));
        const missed=[...new Set((record?.missed ?? []).flatMap(m=>m.concepts.map(c=>c.title)))];
        const door=btn(toBoss?'Face the final exam →':`Enter room ${nextIndex+1}: ${run.rooms[nextIndex]!.title} →`,()=>void this.advance(toBoss),'door');
        const panelEl=el('section','end-panel won',
            el('small','end-kicker',`Room ${run.roomIndex+1} of ${run.rooms.length} · ${run.currentRoom?.title ?? ''}`),
            el('h2','end-title','Room cleared!'),
            el('div','stars',...[0,1,2].map(i=>el('i',i<stars?'star lit':'star'))),
            attemptStats(record,{hearts:room.hearts,maxHearts:room.maxHearts,correct,total:turns.length}),
            missed.length?el('p','end-note',`Watch out: Pip stumbled on ${missed.join(', ')}. Check the notes before the exam.`):el('p','end-note','A clean lesson. Pip is ready for what comes next.'),
            door);
        panelEl.setAttribute('aria-label','Room cleared');
        clock.setTimeout(()=>door.focus({preventScroll:true}),900);
        return panelEl;
    }

    private defeat(run: PublicRun, summary: RoomEnd) {
        const retry=btn('Back to the library to reteach →',()=>void this.retry(),'door');
        const trace=summary.failedTurns.slice(0,TRACE_SHOWN).map(t=>el('li','',el('strong','',t.question.prompt),el('small','',`Pip’s reasoning: ${t.reasoning}`)));
        const panelEl=el('section','end-panel lost',
            el('small','end-kicker',`Room ${run.roomIndex+1} of ${run.rooms.length} · attempt ${run.room?.attempt ?? 1}`),
            el('h2','end-title','Pip was overwhelmed'),
            el('p','end-note','Pip’s notebook led it astray here. Reteach these ideas, then try the room again. Pip keeps the notebook.'),
            trace.length?el('ul','end-trace',...trace):null,
            retry);
        panelEl.setAttribute('aria-label','Room failed');
        clock.setTimeout(()=>retry.focus({preventScroll:true}),900);
        return panelEl;
    }

    // ── Moving on ────────────────────────────────────────────────────────────

    private async advance(toBoss: boolean) {
        if (this.leaving) return;
        this.leaving=true;
        const run=state.run!;
        const nextIndex=run.roomIndex+1;
        const card=toBoss
            ? {kicker:'All rooms cleared',title:'The final examination',detail:`Pip faces ${run.rules.bossQuestions} questions on everything. Your grade is the health Pip keeps.`}
            : {kicker:`Room ${nextIndex+1} of ${run.rooms.length}`,title:run.rooms[nextIndex]!.title,detail:'Back to the library to teach Pip the next lesson.'};
        const ok=await travel(card,async()=>{
            const next=await call(()=>api.continueRun(run.id));
            if(!next)return false;
            setRun(next);setArrival(toBoss?'fight':'study');goTo(sceneForPhase(next.phase));
            return true;
        });
        if(!ok){this.leaving=false;if(this.active)this.create();}
    }

    private async retry() {
        if (this.leaving) return;
        this.leaving=true;
        const run=state.run!;
        const ok=await travel({kicker:`Room ${run.roomIndex+1} · attempt ${(run.room?.attempt ?? 1)+1}`,title:run.currentRoom?.title ?? 'Back to the library',
            detail:'Pip keeps the notebook. Fix what went wrong, then fight again.'},async()=>{
            const next=await call(()=>api.retry(run.id));
            if(!next)return false;
            setRun(next);setArrival('study');goTo(sceneForPhase(next.phase));
            return true;
        },'left'); // the foe still stands, so Pip retreats the way it came
        if(!ok)this.leaving=false;
    }

    // ── Turns ────────────────────────────────────────────────────────────────

    private helpModal(event:HelpMeTurn) {
        const submit=async(answer:Answer)=>{
            const result=await call(()=>api.help(state.run!.id,event.eventId,answer));
            if(!this.active) return;
            this.stopHelp();
            if(result) await this.handle(result);
            else {panel(this,btn('Refresh help request',()=>void this.sync()));}
        };
        const content=stage.querySelector<HTMLElement>('section')!;
        const built=buildHelp(event,a=>void submit(a),()=>void (async()=>{
            const result=await call(()=>api.turn(state.run!.id));
            if(!this.active)return;
            this.stopHelp();
            if(result)await this.handle(result);
            else panel(this,btn('Refresh help request',()=>void this.sync()));
        })());
        const modal=el('div','veil',el('section','folio help-folio',btn('Pause & rooms',()=>void openMenu(),'alt'),built.el));
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
    private stepping=false;
    /** Next turn: the foe presents its question front and center, it retracts, then Pip thinks while the answer comes. */
    private async step() {
        if (this.stepping) return;
        this.stepping=true;
        const run=state.run!;
        const question=(this.boss?run.boss:run.room)?.nextQuestion;
        const next=stage.querySelector<HTMLButtonElement>('.room-actions .gold');
        if (next) next.disabled=true;
        try {
            if (question && !run.pendingHelpMe) await this.castQuestion(question);
            if (!this.active) return;
            const stopThinking=question ? this.thinking(question) : ()=>{};
            const started=clock.performance.now();
            const result=await call(()=>api.turn(run.id));
            if (question) await new Promise(r=>clock.setTimeout(r,Math.max(0,MIN_THINK_MS-(clock.performance.now()-started))));
            stopThinking();
            if (result && this.active) await this.handle(result);
            else if (next) next.disabled=false;
        } finally { this.stepping=false; }
    }

    /** The question flies out of the foe to the centre, then retracts back into it (click to move on sooner). */
    private castQuestion(q: PublicQuestion): Promise<void> {
        const run=state.run!;
        const foe=encounterFor(run.roomIndex,run.rooms.length,this.boss);
        const card=el('div','question-cast',el('small','cast-kicker',`${foe.name} asks`),questionEl(q),el('small','cast-hint','Click to continue'));
        card.style.setProperty('--fx',`${(foe.x/1280)*100}%`);card.style.setProperty('--fy',`${(foe.y/720)*100}%`);
        card.setAttribute('role','status');
        stage.querySelector('.room-view')?.append(card);
        const hold=Math.min(CAST_MAX_MS,CAST_BASE_MS+q.prompt.length*CAST_PER_CHAR_MS);
        return new Promise(resolve=>{
            let done=false;
            const retract=()=>{
                if(done)return; done=true;
                card.classList.add('retract');
                clock.setTimeout(()=>{card.remove();resolve();},CAST_OUT_MS);
            };
            card.addEventListener('click',retract);
            clock.setTimeout(retract,CAST_IN_MS+hold);
        });
    }

    /** Pip's thought bubble while the answer is worked out; returns a function that removes it. */
    private thinking(q: PublicQuestion) {
        const bubble=atWorld(el('div','thought',el('span','thought-dots',el('i'),el('i'),el('i')),el('strong','','Pip is thinking…'),
            el('small','',q.prompt)),THOUGHT_X,THOUGHT_Y);
        stage.querySelector('.room-view')?.append(bubble);
        return ()=>bubble.remove();
    }
    private async handle(event:TurnResult) {
        const run=state.run!;
        switch(event.kind){
            case 'boss_end':
                state.results=event.results;
                await travel({kicker:'Exam complete',title:'Grading Pip’s exam',detail:'Your grade is the health Pip kept through the exam.'},async()=>{
                    setRun({...run,phase:'results'});goTo('Results');return true;
                },'left'); // the exam dragon still stands
                return;
            case 'room_end': {
                this.summary=event;
                const snapshot=await call(()=>api.getRun(run.id));
                if(!this.active)return;
                if(snapshot)setRun(snapshot);
                else if(run.room){run.room.hearts=event.hearts;run.room.passed=event.passed;}
                this.create();
                if(event.passed)defeatFoe();else defeatPip();
                return;
            }
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
                this.animateAnswer(event);
            }
        }
    }

    /** The hit lands on the sprites, and a number floats up from whoever took it. */
    private animateAnswer(event: AnswerTurn) {
        strike(event.correct);
        const foeAt=encounterFor(state.run!.roomIndex,state.run!.rooms.length,this.boss);
        const [x,y,text,kind]=event.correct
            ? [foeAt.x, foeAt.plateY+30, event.kind==='help_result'?'Your help hit!':'Hit!', 'good']
            : [POS.pip.x, PIP_PLATE_Y+30, event.damage===0?'Miss':this.boss?`−${Number(event.damage.toFixed(1))}%`:`−${event.damage} ♥`, 'bad'];
        const pop=atWorld(el('div',`float-pop ${kind}`,text),x,y);
        stage.querySelector('.room-view')?.append(pop);
        pop.addEventListener('animationend',()=>pop.remove());
        clock.setTimeout(()=>pop.remove(),POP_MS);
    }
}

function hearts(have: number, max: number) {
    return el('span', 'heart-row', ...Array.from({ length: max }, (_, i) => el('i', i < have ? 'heart full' : 'heart')));
}
/** Danger pips: how fierce this room's monster is (rooms get fiercer toward the end of the expedition). */
function danger(tier: number) {
    return el('span', 'danger', el('small', '', 'Danger'), ...Array.from({ length: DANGER_LEVELS }, (_, i) => el('i', i <= tier ? 'danger-pip on' : 'danger-pip')));
}
function segments(left: number, total: number) {
    return el('span', 'segments', ...Array.from({ length: total }, (_, i) => el('i', i < left ? 'seg on' : 'seg')));
}
function meter(value: number, max: number, label: string) {
    const bar = el('span', 'plate-meter', el('i'));
    bar.firstElementChild!.setAttribute('style', `width:${Math.max(0, Math.min(100, (value / max) * 100))}%`);
    return el('span', 'plate-life', el('span', 'plate-sub', label), bar);
}

export function arena(run:PublicRun|null,screen:string) {
    drawStage({screen,isBoss:screen==='boss',index:run?.roomIndex??0,rooms:run?.rooms.length??1,victory:screen==='report',
        // Pip sits at the desk only in the lesson room itself; on the archive or menu screens Pip stands.
        phase:run?.phase==='learning'&&screen==='room'?'teach':run?.room?.passed && screen==='room'?'won':'intro'});
}
