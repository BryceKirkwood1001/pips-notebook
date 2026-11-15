import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '@pips-notebook/shared/api-client';
import type { Services } from '../src/services/types';
import { startTestApp, type TestApp } from './helpers/app';

type CourseInput = Parameters<Services['createCourse']>[0];
let t: TestApp;
let api: ApiClient;
let submissions: CourseInput[];

beforeEach(async () => {
  t = await startTestApp();
  submissions = [];
  vi.spyOn(t.container.services, 'createCourse').mockImplementation(async input => {
    submissions.push(input);
    return { courseId: 'crs_sources' };
  });
  api = createApiClient({
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const response = await t.app.inject({
        method: 'POST', url: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        payload: Buffer.from(await request.arrayBuffer()),
      });
      return new Response(response.body, { status: response.statusCode });
    },
  });
});

afterEach(async () => { await t.close(); vi.restoreAllMocks(); });

describe('course sources across the public client and HTTP upload boundary', () => {
  it('keeps files-only uploads in one course with their original names and bytes', async () => {
    const data = new Uint8Array([0, 1, 2, 255]);
    await expect(api.uploadCourse([{ name: 'lecture.pdf', data: new Blob([data]) }], 'Lecture'))
      .resolves.toEqual({ courseId: 'crs_sources' });
    expect(submissions).toHaveLength(1);
    expect(submissions[0].title).toBe('Lecture');
    expect(submissions[0].files).toEqual([{ name: 'lecture.pdf', data }]);
  });

  it('keeps notes-only creation working, including whitespace and code indentation', async () => {
    const notes = '# Notes\n\n    print("hello")\n';
    await api.createCourseFromText(notes, 'My notes');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].title).toBe('My notes');
    expect(submissions[0].files).toHaveLength(1);
    expect(new TextDecoder().decode(submissions[0].files[0].data)).toBe(notes);
  });

  it('sends every selected file and the complete pasted notes together as one course', async () => {
    const notes = '# Extra notes\n\n    π = 3.14\n' + 'Supporting explanation.\n'.repeat(2000);
    await api.uploadCourse([
      { name: 'slides.pdf', data: new Blob(['PDF source']) },
      { name: 'handout.md', data: new Blob(['# Handout']) },
    ], 'Combined lesson', notes);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].title).toBe('Combined lesson');
    expect(submissions[0].files.map(f => f.name)).toEqual(['slides.pdf', 'handout.md', 'pasted-notes.md']);
    expect(submissions[0].files.map(f => new TextDecoder().decode(f.data)))
      .toEqual(['PDF source', '# Handout', notes]);
  });

  it('gives pasted notes a distinct filename when uploaded files already use that name', async () => {
    await api.uploadCourse([
      { name: 'PASTED-NOTES.MD', data: new Blob(['First source']) },
      { name: 'pasted-notes-2.md', data: new Blob(['Second source']) },
    ], undefined, 'Additional notes');
    expect(submissions[0].files.map(f => f.name))
      .toEqual(['PASTED-NOTES.MD', 'pasted-notes-2.md', 'pasted-notes-3.md']);
  });

  it('does not manufacture a blank notes file, and an empty upload is still rejected', async () => {
    await api.uploadCourse([{ name: 'source.txt', data: new Blob(['Source']) }], undefined, '  \n ');
    expect(submissions[0].files.map(f => f.name)).toEqual(['source.txt']);
    await expect(api.uploadCourse([], undefined, '  \n ')).rejects.toMatchObject({ status: 400 });
    expect(submissions).toHaveLength(1);
  });
});
