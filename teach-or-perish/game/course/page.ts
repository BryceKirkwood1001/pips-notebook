import { btn, el, host } from './ui.js';
import { banner, mock, state } from './app.js';
export const stage=el('main','stage course-stage');
const heading=el('div','roomname');
const content=el('section','');
export class Page {
    active=true;
    onClose:()=>void=()=>{};
    close() {this.active=false;this.onClose();}
}
export function title(_page:Page, text:string){heading.replaceChildren(el('h2','',text));}
export function panel(_page:Page, body:HTMLElement){content.replaceChildren(body);}

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
            this.window.scrollTop = 0;
            this.opener = button;
            button.setAttribute('aria-expanded', 'true');
            close.focus();
        }, style);
        button.setAttribute('aria-expanded', 'false');
        return button;
    }

    dismiss() {
        this.window.hidden = true;
        this.opener?.setAttribute('aria-expanded', 'false');
        this.opener?.focus();
        this.opener = undefined;
    }
}
export function frame(screen:string) {
    const badge=state.run ? state.run.studentEmoji+' · Target '+state.run.targetGrade : mock ? 'Practice course' : 'The Lantern Archive';
    const header=el('header','',el('span','','Teach or Perish'),el('div','nav-right',badge));
    if (state.run && screen !== 'report') header.append(btn('Pause', () => {
        const resume=btn('Resume',()=>pause.close());
        const pause=el('dialog','course-pause',el('h2','','Paused'),el('p','','Timed help deadlines keep running.'),resume);
        stage.append(pause);
        pause.onclose=()=>pause.remove();
        pause.showModal();
    },'alt'));
    stage.dataset.screen=screen;
    heading.replaceChildren(); content.replaceChildren();
    stage.replaceChildren(header,heading,content,banner);
    content.className=screen==='title'?'cover':screen==='room'||screen==='boss'?'room-field':'folio archive-folio';
}
export function mount() {
    const css=el('link');css.rel='stylesheet';css.href='media/game.css';host.head.append(css);
    host.title='Teach or Perish';host.documentElement.lang='en';host.body.append(stage);
    const fit=()=>{ const scale=Math.min(host.documentElement.clientWidth/1280,host.documentElement.clientHeight/720);
        stage.style.transform='translate(-50%, -50%) scale('+scale+')'; };
    new ResizeObserver(fit).observe(host.documentElement);fit();
    for(const event of ['keydown','keyup']) stage.addEventListener(event,e=>e.stopPropagation());
}
