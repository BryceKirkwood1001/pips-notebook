import { btn, el, host } from './ui.js';
import { banner, goHome, mock, openMenu, openSettings, state } from './app.js';
import { musicOn, toggleMusic } from './soundtrack.js';

/** The game world the canvas letterboxes, in world units. */
const WORLD_W = 1280, WORLD_H = 720;
/**
 * The HUD is laid out in CSS pixels on a stage exactly over the canvas, so browser zoom resizes it while the
 * world keeps filling the window. Below this many CSS pixels per world unit the HUD shrinks with the window
 * instead, so it never overflows a small window (its layout fits a 1024×576 stage).
 */
const MIN_HUD_SCALE = 0.8;

export const stage=el('main','stage course-stage');
const heading=el('div','roomname');
const content=el('section','');
export class Page {
    active=true;
    onClose:()=>void=()=>{};
    close() {this.active=false;this.onClose();}
}
/** The room's name, top left; the journey bar (rooms cleared) stays under it. */
export function title(_page:Page, text:string){heading.querySelector('h2')?.remove();heading.prepend(el('h2','',text));}
export function panel(_page:Page, body:HTMLElement){content.replaceChildren(body);}

/** A HUD element pinned to a world position (a sprite's head), so it tracks the canvas at any zoom. */
export function atWorld(node: HTMLElement, x: number, y: number) {
    node.style.left = `${(x / WORLD_W) * 100}%`;
    node.style.top = `${(y / WORLD_H) * 100}%`;
    return node;
}

/** Keep the page nodes alive when the player puts a book away, including unsent answers. */
export class RoomView {
    readonly root = el('div', 'room-view');
    readonly inventory = el('div', 'inventory');
    readonly actions = el('div', 'room-actions');
    private window = el('article', 'folio room-folio');
    private opener?: HTMLButtonElement;

    constructor() {
        this.window.hidden = true;
        this.root.append(this.inventory, this.actions, this.window);
        this.root.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !this.window.hidden) this.dismiss();
        });
    }

    entry(label: string, heading: string, body: HTMLElement, style = 'inventory-key') {
        const button = btn(label, () => {
            if (this.opener === button) return this.dismiss();
            this.opener?.setAttribute('aria-expanded', 'false');
            const close = btn('Close', () => this.dismiss(), 'book-close');
            const bar = el('div', 'folio-bar', el('h2', '', heading), close);
            this.window.replaceChildren(bar, el('div', 'folio-leaf', body));
            this.window.setAttribute('aria-label', heading);
            this.window.hidden = false;
            this.window.classList.remove('opening'); void this.window.offsetWidth; this.window.classList.add('opening');
            this.window.scrollTop = 0;
            this.opener = button;
            button.setAttribute('aria-expanded', 'true');
            close.focus();
        }, style);
        button.setAttribute('aria-expanded', 'false');
        return button;
    }

    get open() { return !this.window.hidden; }

    dismiss() {
        this.window.hidden = true;
        this.opener?.setAttribute('aria-expanded', 'false');
        this.opener?.focus();
        this.opener = undefined;
    }
}
export function musicButton() {
    const music=btn(musicOn()?'Music on':'Music off',()=>{ const on=toggleMusic(); music.textContent=on?'Music on':'Music off'; music.setAttribute('aria-pressed',String(on)); },'alt');
    music.setAttribute('aria-pressed',String(musicOn()));
    return music;
}
export function frame(screen:string) {
    const badge=state.run ? 'Target grade '+state.run.targetGrade : mock ? 'Practice course' : 'My archive';
    const home=btn("Pip's Notebook",()=>void goHome(),'home-link');
    home.title=state.run?'Home (your expedition is paused and saved in My archive)':'Home';
    const music=musicButton();
    const header=el('header','',home,el('div','nav-right',badge),music);
    if (screen !== 'settings') header.append(btn('Settings', openSettings, 'alt'));
    if (state.run && screen !== 'menu') {
        header.append(btn('Rooms', () => void openMenu(), 'alt'));
        if (screen !== 'report') header.append(btn('Pause', () => void openMenu(), 'alt'));
    }
    stage.dataset.screen=screen;
    stage.dataset.phase=state.run?.phase ?? '';
    stage.classList.remove('ending');
    heading.replaceChildren(); content.replaceChildren();
    stage.replaceChildren(...(screen === 'title' ? [] : [header]),heading,content,banner,el('div','busy-chip','Pip is thinking'));
    if (state.run && state.run.phase !== 'learning' && (screen === 'room' || screen === 'boss')) {
        const run = state.run;
        const complete = run.rooms.filter(r => r.state === 'passed').length + (run.phase === 'room_result' && run.room?.passed ? 1 : 0);
        const progress=el('progress'); progress.max=run.rooms.length; progress.value=complete;
        progress.setAttribute('aria-label','Rooms completed');
        const label = run.currentRoom ? `Room ${run.roomIndex+1} of ${run.rooms.length}` : 'All rooms cleared · Final exam';
        const map = btn(label, () => void openMenu(), 'journey-link');
        map.title = run.rooms.map((r,i)=>`${i+1}. ${r.title} (${r.state})`).join('\n');
        heading.append(el('nav','journey-progress',map,progress));
    }
    content.className=screen==='title'?'cover':screen==='room'||screen==='boss'?'room-field':'folio archive-folio';
}
export function mount() {
    const css=el('link');css.rel='stylesheet';css.href='media/game.css';host.head.append(css);
    const icon=el('link');icon.rel='icon';icon.type='image/png';icon.href='media/pip-icon.png';host.head.append(icon);
    host.title="Pip's Notebook";host.documentElement.lang='en';host.body.append(stage);
    const fit=()=>{
        const view=host.documentElement;
        const world=Math.min(view.clientWidth/WORLD_W,view.clientHeight/WORLD_H);
        const hud=Math.max(world,MIN_HUD_SCALE);
        stage.style.width=WORLD_W*hud+'px'; stage.style.height=WORLD_H*hud+'px';
        stage.style.transform='translate(-50%, -50%) scale('+world/hud+')';
    };
    new ResizeObserver(fit).observe(host.documentElement);fit();
    for(const event of ['keydown','keyup']) stage.addEventListener(event,e=>e.stopPropagation());
}
