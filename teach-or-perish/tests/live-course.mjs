// Run against a local preview and a local backend using its mock model and memory storage.
import { chromium } from '../phaser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage();
page.setDefaultTimeout(12000);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const button = name => page.getByRole('button',{name,exact:true});
try {
    await page.goto(process.env.GAME_URL || 'http://localhost:4173');
    await button('Play →').click();
    // Exercise both ingest transports with synthetic study material.
    const notes='Earth has seasons because its axis is tilted. The angle of sunlight and the length of daylight vary throughout the year.';
    for (const method of ['Upload files','Create from text']) {
        if(method==='Upload files') {
            await page.locator('input[type=file]').setInputFiles({name:'lesson.md',mimeType:'text/markdown',buffer:Buffer.from(notes)});
        } else await page.getByPlaceholder('Paste course notes here').fill(notes);
        const accepted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/courses' && r.request().method()==='POST');
        await button(method).click();
        assert((await accepted).ok());
        await page.getByText('Scope (rooms to play)').waitFor();
        await button('Change course').click();
    }
    await page.getByRole('button',{name:/seasons/i}).first().click();
    await button('Start run').click();
    await page.waitForURL(url=>url.searchParams.has('run'));
    const explain=page.getByPlaceholder('Explain this room to your student...');
    await explain.fill('Earth has an axial tilt of 23.5 degrees. The tilt changes day length and sunlight angle. Direct sunlight concentrates energy over a smaller area.');
    await button('Teach').click();
    await page.getByText(/Taught 1 time/).waitFor();
    await page.reload();
    await page.getByText(/Taught 1 time/).waitFor();
    await button('Ready: go fight').click();
    await button('Next turn').click();
    await page.locator('.turns details,[role=dialog]').first().waitFor();
    const pending=await page.getByRole('dialog').count();
    await page.reload();
    await (pending?page.getByRole('dialog'):page.locator('.turns details').first()).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: live sample, run creation, notebook persistence, combat and reload.');
} finally { await browser.close(); }

