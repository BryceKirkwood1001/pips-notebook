import { expect, test } from 'vitest';
import { createContainer } from '../src/container';
import { buildApp } from '../src/app';
import { createFakeLlmClient } from '../src/llm/fake-client';
import { createDirectorySampleSource } from '../src/node/samples';
import { TeachResponseSchema } from '@pips-notebook/shared';

test('teaching exposes the student reply and notes over HTTP, including a specific empty-note reply',async()=>{
  let offTopic=false;
  const llm=createFakeLlmClient({handlers:{studentReview:()=>({
    feedback:offTopic?'How does orange juice relate to seasons?':'I heard that a tilted axis changes sunlight angle.',
    notesToAdd:offTopic?[]:[{conceptId:'c1',text:'A tilted axis changes sunlight angle.'}],
    statedMisconceptionIds:[],resolvedMisconceptionIds:[],questions:[],
  })}});
  const c=await createContainer({env:{LLM_PROVIDER:'openai',OPENAI_API_KEY:'fake-test-key',HELP_ME_PROB:'0'},
    llmFactory:()=>llm,seed:42,samples:createDirectorySampleSource()});
  const app=buildApp(c);
  try {
    const {courseId}=await c.services.seedCourse('seasons');
    const run=await c.services.createRun({courseId,targetGrade:'B'});
    const response=await app.inject({method:'POST',url:`/api/runs/${run.id}/teach`,payload:{conceptId:'c1',explanation:'A tilted axis changes sunlight angle.'}});
    expect(response.statusCode).toBe(200);
    const learned=TeachResponseSchema.parse(response.json());
    expect(learned.feedback).toBe('I heard that a tilted axis changes sunlight angle.');
    expect(learned.notebookMd).toContain('- A tilted axis changes sunlight angle.');
    offTopic=true;
    const empty=await app.inject({method:'POST',url:`/api/runs/${run.id}/teach`,payload:{conceptId:'c1',explanation:'the orange juice is big'}});
    const rejected=TeachResponseSchema.parse(empty.json());
    expect(rejected.feedback).toBe('How does orange juice relate to seasons?');
    expect(rejected.notebookMd).toBe(learned.notebookMd);
    expect(JSON.stringify(rejected)).not.toMatch(/beliefStatement|statedMisconceptionIds|resolvedMisconceptionIds/);
  } finally { await app.close(); }
});
