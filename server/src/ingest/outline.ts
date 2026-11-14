/**
 * Stage "outline": turns the OutlineDraft into units, concepts, key points, material items and rooms.
 * Every QuoteRef is located in a chunk; whatever cannot be located is dropped.
 */
import type { Chunk, Concept, CoursePack, MaterialItem, Room, Unit } from '@top/shared';
import { locateQuote } from '../rag';
import type { OutlineDraft } from '../llm/types';

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface OutlineResult {
  units: Unit[];
  concepts: Concept[];
  materialItems: MaterialItem[];
  rooms: Room[];
  dropped: string[];
}

export function buildOutline(draft: OutlineDraft, chunks: Chunk[]): OutlineResult {
  const dropped: string[] = [];
  const units: Unit[] = [];
  const concepts: Concept[] = [];
  const idByTitle = new Map<string, string>();

  for (const du of draft.units) {
    const unitId = `u${units.length + 1}`;
    const unit: Unit = { id: unitId, title: du.title, order: units.length + 1, conceptIds: [] };
    for (const dc of du.concepts) {
      const conceptId = `c${concepts.length + 1}`;
      const keyPoints: Concept['keyPoints'] = [];
      for (const dk of dc.keyPoints) {
        const evidence = locateQuote(dk.evidence.quote, chunks, dk.evidence);
        if (!evidence || dk.statement.trim() === '') {
          dropped.push(`key point of "${dc.title}": ${dk.statement}`);
          continue;
        }
        keyPoints.push({ id: `${conceptId}_k${keyPoints.length + 1}`, statement: dk.statement.trim(), evidence });
      }
      if (keyPoints.length === 0) {
        dropped.push(`concept "${dc.title}" (no key point with a findable quote)`);
        continue;
      }
      concepts.push({
        id: conceptId,
        unitId,
        title: dc.title.trim(),
        summary: dc.summary,
        order: concepts.length + 1,
        prerequisites: [], // filled below, once every concept has an id
        keyPoints,
        misconceptions: [],
      });
      unit.conceptIds.push(conceptId);
      idByTitle.set(norm(dc.title), conceptId);
    }
    if (unit.conceptIds.length > 0) units.push(unit);
  }

  // Prerequisites: titles -> ids.
  const draftConcepts = draft.units.flatMap((u) => u.concepts);
  for (const concept of concepts) {
    const dc = draftConcepts.find((c) => norm(c.title) === norm(concept.title));
    concept.prerequisites = (dc?.prerequisites ?? [])
      .map((t) => idByTitle.get(norm(t)))
      .filter((id): id is string => !!id && id !== concept.id);
  }

  const materialItems: MaterialItem[] = [];
  for (const di of draft.materialItems) {
    const evidence = locateQuote(di.evidence.quote, chunks, di.evidence);
    if (!evidence || di.text.trim() === '') {
      dropped.push(`material item: ${di.text.slice(0, 60)}`);
      continue;
    }
    let conceptIds = di.conceptTitles.map((t) => idByTitle.get(norm(t))).filter((id): id is string => !!id);
    conceptIds = [...new Set(conceptIds)];
    if (conceptIds.length === 0) {
      // Fall back to the concept whose key point sits in the same chunk, else the first concept.
      const same = concepts.find((c) => c.keyPoints.some((k) => k.evidence.chunkId === evidence.chunkId));
      conceptIds = [(same ?? concepts[0])?.id].filter(Boolean) as string[];
    }
    materialItems.push({
      id: `m${materialItems.length + 1}`,
      kind: di.kind,
      text: di.text.trim(),
      ...(di.solution && di.solution.trim() !== '' ? { solution: di.solution.trim() } : {}),
      conceptIds,
      ...(di.points && di.points > 0 ? { points: di.points } : {}),
      evidence,
    });
  }

  return { units, concepts, materialItems, rooms: buildRooms(concepts), dropped };
}

/**
 * Usually one concept per room. A tiny concept (fewer than 2 key points) shares a room with its
 * neighbour in the same unit. A room never holds more than 3 concepts.
 */
export function buildRooms(concepts: Concept[]): Room[] {
  const MAX_PER_ROOM = 3;
  const tiny = (c: Concept) => c.keyPoints.length < 2;
  const groups: Concept[][] = [];
  for (const c of concepts) {
    const last = groups[groups.length - 1];
    const sameUnit = last !== undefined && last[last.length - 1].unitId === c.unitId;
    const lastIsTinyAlone = last !== undefined && last.length === 1 && tiny(last[0]);
    if (last && sameUnit && last.length < MAX_PER_ROOM && (tiny(c) || lastIsTinyAlone)) last.push(c);
    else groups.push([c]);
  }
  return groups.map((g, i) => ({
    id: `r${i + 1}`,
    title: g.map((c) => c.title).join(' & '),
    order: i + 1,
    conceptIds: g.map((c) => c.id),
  }));
}

/** Tags chunks with the concepts whose evidence they hold (and their same-section neighbours). */
export function tagChunks(pack: CoursePack, chunks: Chunk[]): Chunk[] {
  const tags = new Map<string, Set<string>>();
  const add = (chunkId: string, conceptId: string) => {
    if (!tags.has(chunkId)) tags.set(chunkId, new Set());
    tags.get(chunkId)?.add(conceptId);
  };
  for (const c of pack.concepts) {
    for (const k of c.keyPoints) add(k.evidence.chunkId, c.id);
    for (const m of c.misconceptions) add(m.evidence.chunkId, c.id);
  }
  for (const item of pack.materialItems) for (const id of item.conceptIds) add(item.evidence.chunkId, id);

  // Neighbours: other chunks of the same file, page and section follow the same concept.
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const sectionKey = (c: Chunk) => `${c.fileId}|${c.page}|${c.sectionPath.join('>')}`;
  for (const [chunkId, concepts] of [...tags.entries()]) {
    const base = byId.get(chunkId);
    if (!base || base.sectionPath.length === 0) continue;
    for (const other of chunks) {
      if (sectionKey(other) === sectionKey(base)) for (const id of concepts) add(other.id, id);
    }
  }

  const changed: Chunk[] = [];
  for (const chunk of chunks) {
    const t = tags.get(chunk.id);
    if (!t) continue;
    const ids = [...new Set([...chunk.conceptIds, ...t])].sort();
    if (ids.join() !== [...chunk.conceptIds].sort().join()) {
      chunk.conceptIds = ids;
      changed.push(chunk);
    }
  }
  return changed;
}
