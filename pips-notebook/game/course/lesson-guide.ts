import { el, inline } from './ui.js';
import type { PublicRunRoom } from './api-client.js';

export function lessonGuide(room: Pick<PublicRunRoom,'title'|'description'|'learningObjectives'|'concepts'>, includeDescription = true) {
  const guide = el('div','lesson-guide');
  if (includeDescription && room.description) guide.append(el('p','lesson-description',inline(room.description)));
  if (room.learningObjectives?.length) guide.append(el('h3','','What to teach Pip'),
    el('ul','teaching-goals',...room.learningObjectives.map(goal=>el('li','',inline(goal)))));
  guide.append(el('h3','','Topics to cover'));
  for (const c of room.concepts) guide.append(el('div','topic-guide',el('h4','',c.title),
    el('p','',inline(c.summary || `Explain ${c.title.toLowerCase()} using the definitions, reasoning and examples in your uploaded material.`))));
  return guide;
}
