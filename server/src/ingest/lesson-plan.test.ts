import { expect, test } from 'vitest';
import { applyLessonPlan, lessonPlanPrompt, LessonPlanSchema, PLAN_LESSONS_SYSTEM } from './lesson-plan';
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
