import { expect, test } from 'vitest';
import { applyLessonPlan, lessonPlanPrompt, LessonPlanSchema, lessonPlanSchemaFor, LessonPlanCoverageError, PLAN_LESSONS_SYSTEM } from './lesson-plan';
import type { OutlineResult } from './outline';
import type { Concept } from '@top/shared';

const evidence={fileId:'f1',page:4,chunkId:'chunk1',sectionPath:[],quote:'An array is fixed-size.'};
const concept=(id:string):Concept=>({id,unitId:'u1',title:`Arrays ${id}`,summary:'Explain how arrays store values.',order:Number(id.slice(1)),prerequisites:[],misconceptions:[],
  keyPoints:[{id:`${id}_k1`,statement:'An array is fixed-size.',evidence}]});
const outline:OutlineResult={units:[{id:'u1',title:'Review',order:1,conceptIds:['c1','c2','c3']}],concepts:[concept('c1'),concept('c2'),{...concept('c3'),prerequisites:['c1'],keyPoints:[{id:'c3_k1',statement:'Lists can grow.',evidence}]}],
  materialItems:[{id:'m1',kind:'definition',text:'array',conceptIds:['c2','c3'],evidence}],rooms:[],dropped:[]};
const plan=LessonPlanSchema.parse({lessons:[{title:'From arrays to growable lists',description:'Explain why fixed-size storage needs a list abstraction. Connect array representation to changing list size.',
  learningObjectives:['Explain the limitation of fixed-size arrays.','Compare fixed storage with a growable list.'],concepts:[
    {sourceIds:['c1','c2'],title:'Fixed-size array storage',summary:'Explain how indexed arrays store a fixed number of values.'},
    {sourceIds:['c3'],title:'A list that can grow',summary:'Explain how a growable list differs from a fixed-size array.'}]}]});

test('whole-course grouping merges duplicates without losing evidence or item/prerequisite mappings',()=>{
  const out=applyLessonPlan(outline,plan);
  expect(out.rooms).toHaveLength(1);expect(out.concepts).toHaveLength(2);
  expect(out.concepts[0].keyPoints).toHaveLength(1);expect(out.concepts[0].keyPoints[0].evidence).toEqual(evidence);
  expect(out.materialItems[0].conceptIds).toEqual(['c1','c2']);expect(out.concepts[1].prerequisites).toEqual(['c1']);
  expect(out.rooms[0].learningObjectives).toHaveLength(2);expect(outline.concepts).toHaveLength(3);
});
test.each([{ids:['c1']},{ids:['c1','c1','c3']},{ids:['c1','c2','missing']}])('rejects a lossy or invented plan $ids',({ids})=>{
  const bad=structuredClone(plan);bad.lessons[0].concepts=[{...bad.lessons[0].concepts[0],sourceIds:ids}];
  expect(()=>applyLessonPlan(outline,bad)).toThrow('exactly once');
});
test('planner bounds complete lessons and requests concrete teaching guidance',()=>{
  expect(LessonPlanSchema.safeParse({lessons:Array(7).fill(plan.lessons[0])}).success).toBe(false);
  expect(PLAN_LESSONS_SYSTEM).toContain('batch/page boundary is never a lesson boundary');
});
test('planning prompt uses supported topics without hidden misconceptions',()=>{
  const c={...concept('c1'),misconceptions:[{id:'m1',conceptId:'c1',description:'SECRET_BELIEF',beliefStatement:'SECRET_BELIEF',correction:'SECRET_CORRECTION',evidence,origin:'material' as const,likelihood:1}]};
  const prompt=lessonPlanPrompt('Arrays',[c]);
  expect(prompt).toContain('An array is fixed-size.');expect(prompt).toContain('<material>');
  expect(prompt).not.toContain('SECRET_');
});

test('coverage feedback identifies the exact ids to repair without accepting partial coverage',()=>{
  const bad=structuredClone(plan);
  bad.lessons[0].concepts=[{...bad.lessons[0].concepts[0],sourceIds:['c1','c1','unknown']}];
  try { applyLessonPlan(outline,bad); throw new Error('Expected coverage failure'); }
  catch (error) {
    expect(error).toBeInstanceOf(LessonPlanCoverageError);
    const { repair }=error as LessonPlanCoverageError;
    expect(repair).toMatchObject({missingIds:['c2','c3'],duplicateIds:['c1'],unknownIds:['unknown'],previousPlan:bad});
    const prompt=lessonPlanPrompt('Arrays',outline.concepts,repair);
    expect(prompt).toContain('"requiredSourceIds":["c1","c2","c3"]');
    expect(prompt).toContain('"validationFeedback"');
    expect(prompt).toContain('"missingIds":["c2","c3"]');
  }
});

test('provider schema restricts sourceIds to concept ids from this upload',()=>{
  const schema=lessonPlanSchemaFor(outline.concepts);
  expect(schema.safeParse(plan).success).toBe(true);
  const bad=structuredClone(plan);bad.lessons[0].concepts[0].sourceIds=['c1_k1'];
  expect(schema.safeParse(bad).success).toBe(false);
});

test('Python dictionary reference keeps all eleven methods in three coherent lessons with original evidence',()=>{
  const definitions=[
    ['get()', 'Returns the value associated with the specified key.'],
    ['items()', 'Returns a view object containing all key-value pairs as tuples.'],
    ['keys()', 'Returns a view object containing all dictionary keys.'],
    ['values()', 'Returns a view object containing all dictionary values.'],
    ['update()', 'Updates the dictionary using another dictionary or iterable of key-value pairs.'],
    ['pop()', 'Removes the specified key and returns its value.'],
    ['popitem()', 'Removes and returns the last inserted key-value pair.'],
    ['clear()', 'Removes all key-value pairs from the dictionary.'],
    ['setdefault()', 'Returns the value of a key if it exists. Otherwise, inserts the key with the specified default value.'],
    ['copy()', 'Returns a shallow copy of the dictionary.'],
    ['fromkeys()', 'Creates a new dictionary using the given iterable as keys and assigns the same default value to all keys.'],
  ];
  const source=definitions.map(([title,statement],i)=>({...concept(`c${i+1}`),title,summary:statement,
    keyPoints:[{id:`c${i+1}_k1`,statement,evidence:{...evidence,quote:statement}}]}));
  const dictionaryOutline={...outline,concepts:source,materialItems:source.map(c=>({id:`m_${c.id}`,kind:'definition' as const,text:c.summary,conceptIds:[c.id],evidence:c.keyPoints[0].evidence}))};
  const titles=['Access dictionary values and inspect contents','Update and remove dictionary entries','Create dictionaries and copy existing contents'];
  const groups=[source.slice(0,4),source.slice(4,9),source.slice(9)];
  const dictionaryPlan=lessonPlanSchemaFor(source).parse({lessons:groups.map((concepts,i)=>({
    title:titles[i],description:concepts.map(c=>`${c.title}: ${c.summary}`).join(' '),
    learningObjectives:concepts.map(c=>`Explain ${c.title} using the supplied dictionary example.`),
    concepts:concepts.map(c=>({sourceIds:[c.id],title:`Use ${c.title}`,summary:c.summary})),
  }))});
  const result=applyLessonPlan(dictionaryOutline,dictionaryPlan);
  expect(result.rooms).toHaveLength(3);
  expect(result.concepts).toHaveLength(11);
  expect(result.concepts.flatMap(c=>c.keyPoints).map(k=>k.evidence)).toEqual(source.flatMap(c=>c.keyPoints).map(k=>k.evidence));
  expect(result.materialItems.every(m=>m.conceptIds.length===1 && result.concepts.some(c=>c.id===m.conceptIds[0]))).toBe(true);
});
