import { game } from './engine.js';

const encounters = [
    { enemy: 'monster', background: 'fight_scene_1' },
    { enemy: 'monster_2', background: 'fight_scene_2' },
    { enemy: 'monster_3', background: 'fight_scene_3' },
] as const;
const files = ['concept_room_background','boss_room_background','student_learning','student_fighting','student_finished',
    ...encounters.map(room => room.background)];
const clips = {
    student_idle: { cols: 4, fps: 3, hold: false },
    student_writing_notes: { cols: 4, fps: 5, hold: false },
    student_raising_hand: { cols: 6, fps: 7, hold: true },
    student_understanding_moment: { cols: 5, fps: 5, hold: true },
    student_attack: { cols: 5, fps: 10, hold: true },
    monster_idle: { cols: 4, fps: 4, hold: false },
    monster_attack: { cols: 5, fps: 10, hold: true },
    monster_2_idle: { cols: 4, fps: 4, hold: false },
    monster_2_attack: { cols: 6, fps: 10, hold: true },
    monster_3_idle: { cols: 4, fps: 4, hold: false },
    monster_3_attack: { cols: 8, fps: 11, hold: true },
    final_boss_idle: { cols: 4, fps: 3, hold: false },
    final_boss_attack: { cols: 10, fps: 11, hold: true },
    student_walking: { cols: 4, fps: 8, hold: false },
};
type Clip = keyof typeof clips;
type Actor = 'student' | 'monster';

type Enemy = typeof encounters[number]['enemy'] | 'final_boss';

function animations(prefix: 'student' | Enemy) {
    return Object.fromEntries(Object.entries(clips)
        .filter(([key]) => game.assets.has(key) && (prefix === 'student'
            ? key.startsWith('student_') : key === prefix + '_idle' || key === prefix + '_attack'))
        .map(([strip, { fps, hold }]) => [strip, { strip, fps, hold }]));
}

function playPose(actor: Actor, pose: Clip, follow?: Clip) {
    const [sprite] = game.roster.tagged(actor);
    if (!sprite || !game.assets.has(pose)) return;
    sprite.play(pose);
    if (!follow || !game.assets.has(follow)) return;
    const { cols, fps } = clips[pose];
    game.after(cols / fps, () => {
        if (sprite.alive && game.anim(sprite)?.name === pose) sprite.play(follow);
    });
}

export function teachingPose(hasQuestion: boolean, understood = false) {
    const rest = hasQuestion ? 'student_raising_hand' : 'student_writing_notes';
    if (understood) playPose('student', 'student_understanding_moment', rest);
    else playPose('student', rest);
}

function enemyFor(index: number, boss: boolean): Enemy {
    return boss ? 'final_boss' : encounters[index % encounters.length]!.enemy;
}

export function playAttack(correct: boolean, roomIndex: number, boss: boolean) {
    if (correct) playPose('student', 'student_attack', 'student_idle');
    else {
        const enemy = enemyFor(roomIndex, boss);
        playPose('monster', `${enemy}_attack`, `${enemy}_idle`);
    }
}

export function walkToScene(arrive: () => void) {
    const [pip] = game.roster.tagged('student');
    if (!pip || !game.assets.has('student_walking')) return arrive();
    pip.play('student_walking');
    game.tween.to(pip, { x: pip.x + 165 }, { duration: 0.78 });
    game.after(0.8, arrive);
}

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
    await game.assets.load([
        ...files.map(key => ({kind:'image' as const,key,url:'media/'+key+'.png'})),
        ...Object.entries(clips).map(([key, { cols }]) => ({
            kind: 'image' as const, key, url: 'media/' + key + '.png', w: 224, h: 192, cols, rows: 1,
        })),
    ]);
}
export function drawStage(run: { screen: string; isBoss: boolean; phase: string; index: number; victory: boolean }) {
    const boss = run.isBoss || run.screen === 'report';
    const teaching = run.phase === 'teach';
    const field = encounters[run.index % encounters.length]!;
    const bg = boss ? 'boss_room_background' : run.screen === 'room' && !teaching ? field.background : 'concept_room_background';
    const key = (s: string) => game.assets.has(s) ? s : 'fallback-'+s;
    const encounter = run.screen === 'room' || run.isBoss;
    game.spawn({texture:key(bg), x:640, y:360, width:1280,height:720,layer:'back'});
    const idle = teaching ? 'student_writing_notes' : 'student_idle';
    const animated = !run.victory && game.assets.has(idle);
    const fallback = run.victory ? 'student_finished' : encounter && !teaching ? 'student_fighting' : 'student_learning';
    const x = encounter ? teaching ? 820 : 465 : 935;
    const y = encounter ? 518 : 490;
    game.spawn({
        texture: animated ? idle : key(fallback), tags: ['student'], x, y,
        width: encounter ? 222 : 225, layer: 'world', anims: animations('student'),
        ...(animated ? { play: idle } : {}),
    });
    if (!encounter || teaching) return;
    const name = enemyFor(run.index, run.isBoss);
    const idleClip = `${name}_idle` as const;
    const hasEnemy = game.assets.has(idleClip);
    const enemy = game.spawn({
        tags: ['monster'], texture: hasEnemy ? idleClip : 'foe' + (run.isBoss ? 3 : run.index % 3),
        x: 861, y: run.isBoss ? 474 : 531, width: run.isBoss ? 330 : 191, layer: 'world',
        anims: animations(name), ...(hasEnemy ? { play: idleClip } : {}),
    });
    if (hasEnemy) enemy.sx *= -1;
    if (run.phase === 'won') { game.tween.to(enemy,{alpha:0,scale:0.1},{duration:0.5}); return; }
}
