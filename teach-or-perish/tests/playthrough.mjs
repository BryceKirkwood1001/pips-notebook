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
    await page.goto(local+'/?mock=1');
    const button=name=>page.getByRole('button',{name,exact:true});
    await button('Play →').click();
    await button('Seasons (mock sample)').click();
    await page.getByRole('checkbox').nth(1).uncheck();
    await button('🦉').click();await button('Start run').click();
    await page.getByPlaceholder('Explain this room to your student...').fill('Earth tilts as it orbits.');
    await button('Teach').click();
    await page.getByPlaceholder('Your answer...').first().fill('Earth’s tilt changes the sunlight angle.');
    await button('Answer').first().click();await button('Skip').last().click();
    await button('Ready: go fight').click();
    let helped=0,retried=false;
    for(let n=0;n<65;n++){
        const actions=page.getByRole('button',{name:/^(Next turn|Show result|Continue|Retry room|Ready: go fight|Start over|Submit)$/});
        await actions.last().waitFor();
        if(await button('Start over').isVisible())break;
        const modal=page.getByRole('dialog');
        if(await modal.isVisible()){
            if (!helped) {
                await page.reload();
                await modal.waitFor();
            }
            const input=modal.locator('input').first();
            if(await input.count()){
                const type=await input.getAttribute('type');
                if(type==='checkbox')await input.check();
                else await input.fill(type==='number'?'23.5':'equinox');
            }else{
                const options=modal.locator('button').filter({hasNotText:/Submit|Reset/});
                if(await button('Reset').count()){
                    for(let i=0;i<await options.count();i++)await options.nth(i).click();
                }else await options.first().click();
            }
            await button('Submit').click();await modal.waitFor({state:'detached'});helped++;continue;
        }
        const action=actions.last();
        if((await action.innerText())==='Retry room')retried=true;
        await action.click();
        await page.waitForFunction(()=>!document.body.classList.contains('waiting'));
    }
    await page.getByText(/Predicted grade/).waitFor();
    assert(helped>=5 && retried);
    await page.getByText(/seasons.pdf, page 3/).waitFor();
    await button('Start over').click();
    assert(!new URL(page.url()).searchParams.has('run'));
    assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
    console.log('PASS: course scope, student, teaching, follow-ups, retry, help, exam, study guide and restart.');
} finally {await browser?.close();server.close();}
