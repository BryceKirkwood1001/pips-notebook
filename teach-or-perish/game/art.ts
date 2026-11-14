import { game } from './engine.js';
import type { DungeonRun } from './run.js';
const files = ['concept_room_background','boss_room_background','student_learning','student_fighting','student_finished'];
export async function loadArt() {
    for (const key of files) game.pixels('fallback-' + key, ['..oo..','.occo.','ocwwco','.occo.','..oo..'], { o:'#362333', c:'#75acbb', w:'#fff1bd' }, 8);
    const palettes = [
        { a:'#452e45', b:'#d57a43', c:'#ffe098', d:'#fff6cd' },
        { a:'#342843', b:'#835b9a', c:'#cfa6dd', d:'#fcdd9f' },
        { a:'#263344', b:'#39868a', c:'#9ed1b4', d:'#fff1b2' },
        { a:'#34203d', b:'#92568b', c:'#e9ac5e', d:'#fff7c8' }
    ];
    const drawings = [
        ['.......c......','......cc......','....ccdb......','...bcddc..c...','..bcdddb.bc...', '.abccbbccbba..','.abbbddbbbba..','..abcdcccbba..','...abbbbbba...','....aaabaa....'],
        ['..............','.....bb.......','...bbccbb.....','..bcccccbb....','.bcddccddbb...', 'abbddbbddbbba.','abbbbbbbbbbba.','abbcbbbbbcbaa.','.aabccbbccaa..','..aaaaaaaaa...'],
        ['......bc......','.....bccb.....','....bccbcb....','...bccbbccb...','..bcdddddccb..','.abddabaddbba.','..bcdddddccb..','...bccbbccb...','....bccbcb....','.....baab.....'],
        ['.c....cc....c.','.bc..cddc..cb.','.bccbccbccbcb.','..bbbbbbbbbb..','.bcddbbbbddcb.','.abddbbbbddba.','..babccccbab..','...bccccccb...','..bcbbccbbcb..','.cbbaabbaabbc.']
    ];
    drawings.forEach((rows,i) => game.pixels('foe'+i, rows,palettes[i]!,8));
    await game.assets.load(files.map(key => ({kind:'image' as const,key,url:'media/'+key+'.png'})));
}
export function drawStage(run: DungeonRun) {
    const boss = run.isBoss || (run.screen === 'report' && run.completed === run.lesson.concepts.length);
    const bg = boss ? 'boss_room_background' : 'concept_room_background';
    const key = (s: string) => game.assets.has(s) ? s : 'fallback-'+s;
    const encounter = run.screen === 'room' || run.isBoss;
    game.spawn({texture:key(bg), x:640, y:encounter ? 120 : 360, width:1280,height:720,layer:'back'});
    const pose = run.victory ? 'student_finished' : encounter && run.phase !== 'teach' ? 'student_fighting' : 'student_learning';
    const teaching = run.phase === 'teach';
    const x = encounter ? teaching ? 704 : 480 : 935;
    const y = encounter ? 249 : 466;
    const pip = game.spawn({texture:key(pose),x,y,width:encounter ? 148 : 205,layer:'world'});
    game.tween.to(pip,{y:y-4},{duration:1.3,yoyo:true,loop:true});
    if (!encounter || teaching) return;
    const enemy = game.spawn({texture:'foe'+(run.isBoss ? 3 : run.index%3),x:861,y:245,width:run.isBoss?151:111,layer:'world'});
    game.tween.to(enemy,{y:237},{duration:0.9,yoyo:true,loop:true});
    if (run.phase === 'won') { game.tween.to(enemy,{alpha:0,scale:0.1},{duration:0.5}); return; }
    if (run.phase === 'answer') {
        const correct = run.history[run.history.length-1]!.correct;
        const attacker = correct ? pip : enemy;
        const victim = correct ? enemy : pip;
        game.tween.to(attacker,{x:attacker.x+(correct?105:-105)},{duration:0.14,yoyo:true});
        game.tween.from(victim,{alpha:0.2},{duration:0.4});
    }
}
