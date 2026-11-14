// Run after npm run build. Exercise the actual built site with external requests blocked.
import { chromium } from '../phaser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
const dist = new URL('../dist/', import.meta.url);
const server = createServer(async (req, res) => {
    try {
        const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
        const file = new URL(name, dist);
        if (!file.href.startsWith(dist.href)) throw Error();
        const data = await readFile(file);
        res.setHeader('content-type', ({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css','.png':'image/png'})[extname(name)] || 'application/octet-stream');
        res.end(data);
    } catch {res.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const local='http://127.0.0.1:'+server.address().port;
let browser;
try {
    browser=await chromium.launch({args:['--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    const errors=[],remote=[];
    page.on('pageerror',e=>{errors.push(e.message); console.error(e.message);});
    await page.route(/^https?:/,route=>{
        if(new URL(route.request().url()).origin!==local){remote.push(route.request().url());return route.abort();}
        return route.continue();
    });
    const press = action=>page.locator('[data-action="'+action+'"]').last().click({timeout:15000});
    const content=()=>page.locator('main').innerText();
    const has=async text=>{await page.getByText(text,{exact:false}).first().waitFor({timeout:15000});};
    async function fight() {
        for(let i=0;i<30;i++){
            await page.locator('[data-action="continue"],[data-action="next"],[data-action="retry"],.report').first().waitFor({timeout:15000});
            if(!await page.locator('[data-action="continue"]').count()) return;
            await press('continue');
        }
        throw Error('Battle did not terminate');
    }
    await page.goto(local);
    await press('setup');
    await page.locator('input[type=file]').setInputFiles([{name:'lecture.txt',mimeType:'text/plain',buffer:Buffer.from('light')},{name:'remove.txt',mimeType:'text/plain',buffer:Buffer.from('shadow')}]);
    await press('remove:1'); assert(!(await content()).includes('remove.txt'));
    await page.locator('#target').fill('91');
    await press('start');
    await page.locator('#words').fill('The beam can bend.');
    await press('teach:Analogy');
    await press('notes'); await has('The beam can bend.'); await press('notes');
    await press('battle');await fight();await has('Room cleared.');
    assert((await content()).includes('88 / 100'));
    await press('retry');await has('100 / 100');await press('notes');
    assert(!(await content()).includes('The beam can bend.'));await press('notes');
    for(let room=0;room<3;room++){
        await press('teach:Socratic Question');await press('teach:Example');
        await fight();await press('next');
    }
    await has('The Archive Keeper');await press('battle');await fight();await press('next');
    await has('Target achieved');assert((await content()).includes('91%'));assert((await content()).includes('3/3'));
    await press('retryLesson');await press('battle');await fight();await press('report');await has('Defeat');await has('91%');
    await press('menu');await has('Play');
    assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
    console.log('PASS: files, target, notebook, room rollback, all three rooms, boss, victory, retry lesson, defeat, main menu, offline play.');
} finally {await browser?.close();server.close();}


