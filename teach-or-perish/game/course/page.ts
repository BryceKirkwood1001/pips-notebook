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
    content.className=screen==='title'?'cover':screen==='room'||screen==='boss'?'console live-console':'sheet course-sheet';
}
export function mount() {
    const css=el('link');css.rel='stylesheet';css.href='media/game.css';host.head.append(css);
    host.title='Teach or Perish';host.documentElement.lang='en';host.body.append(stage);
    const fit=()=>{ const scale=Math.min(host.documentElement.clientWidth/1280,host.documentElement.clientHeight/720);
        stage.style.transform='translate(-50%, -50%) scale('+scale+')'; };
    new ResizeObserver(fit).observe(host.documentElement);fit();
    for(const event of ['keydown','keyup']) stage.addEventListener(event,e=>e.stopPropagation());
}
