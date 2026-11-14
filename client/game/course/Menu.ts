import { Page, panel } from './page.js';
import { api, call, continuePlaying, goTo, state } from './app.js';
import { btn, el } from './ui.js';
import { lessonGuide } from './lesson-guide.js';
import { reportBook } from './report.js';
import { canPlay, endExpedition, removeExpedition } from './expedition.js';

export class MenuScene extends Page {
  async create() {
    const run=state.run;
    if (!run) return goTo('Upload');
    const completed = run.rooms.filter(r=>r.state==='passed').length + (run.phase === 'room_result' && run.room?.passed ? 1 : 0);
    const bar=el('progress');bar.max=run.rooms.length;bar.value=completed;bar.setAttribute('aria-label','Rooms completed');
    const lessons=el('div','lesson-map');
    const ended=!!run.endedAt;
    const status=ended
      ? `Ended ${new Date(run.endedAt!).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}. ${completed} of ${run.rooms.length} rooms cleared. This record stays in My archive; it can’t be resumed.`
      : `${completed} of ${run.rooms.length} rooms cleared. ${run.pausedAt ? 'Help timers are paused. Your notebook and progress are saved.' : 'Your progress is saved.'}`;
    const actions=el('div','menu-actions');
    if (!ended) actions.append(btn(run.phase==='results'?'View results':'Resume expedition',()=>void continuePlaying()));
    actions.append(btn('My archive',()=>goTo('Upload'),'alt'));
    if (canPlay(run)) actions.append(btn('End expedition',async()=>{ if (await endExpedition(run.id) && this.active) goTo('Menu'); },'alt'));
    actions.append(btn('Remove expedition',async()=>{ if (await removeExpedition(run.id) && this.active) goTo('Upload'); },'alt remove'));
    const root=el('div','course-menu',el('h2','',ended?'Expedition ended':run.phase==='results'?'Your expedition':'Expedition paused'),
      el('p','',run.courseTitle),el('p','',status),bar,actions,
      el('details','menu-report',el('summary','','Expedition report'),reportBook(run)),
      el('h3','','All lessons and rooms'),lessons);
    panel(this,root);
    const course=await call(()=>api.getCourse(run.courseId));
    if (!this.active) return;
    const refs = new Map((course?.units ?? []).flatMap(u=>u.concepts).map(c=>[c.id,c]));
    const rooms=course?.rooms ?? run.rooms.map(r=>({...r,conceptIds:r.concepts.map(c=>c.id)}));
    for (const [index,room] of rooms.entries()) {
      const scoped=run.rooms.find(r=>r.id===room.id);
      const status = scoped?.state ?? 'outside this expedition';
      const concepts=room.conceptIds.map(id=>refs.get(id) ?? scoped?.concepts.find(c=>c.id===id)).filter((c):c is NonNullable<typeof c>=>!!c);
      const details=el('details','map-room',el('summary','',`${index+1}. ${room.title} · ${status}`),
        lessonGuide({...room,concepts}));
      if(scoped?.state==='current')details.open=true;
      lessons.append(details);
    }
  }
}
