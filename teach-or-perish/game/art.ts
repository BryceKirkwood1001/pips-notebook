import { game, type Sprite } from './engine.js';

/** Where the actors stand, in world units (1280×720). Battle positions leave the middle of the floor empty. */
export const POS = {
    desk: { x: 820, y: 490, width: 225 },
    /** Title, archive, menu and report screens: Pip waits at the right, clear of the left-hand panels. */
    lounge: { x: 935, y: 490, width: 225 },
    pip: { x: 330, y: 520, width: 222 },
    foe: { x: 930, y: 531, width: 191 },
    /** The final boss sheet is drawn larger (the teammate's 330-wide dragon), standing on the same floor line. */
    boss: { x: 950, y: 474, width: 330 },
} as const;
/** An attacker steps in this far, but the two sprites' facing frame edges never come closer than MIN_GAP. */
const LUNGE = 80, MIN_GAP = 140, KNOCKBACK = 18;
/** Walking: world units per second, and the height and length of each bouncing step. */
const WALK_SPEED = 430, STEP_BOB = 8, STEP_BOB_WITH_SHEET = 2, STEP_TIME = 0.17;
/** How far Pip walks toward the next scene on a scene change without the curtain. */
const SCENE_STEP = 165;
/** Where a walk starts or ends off screen. */
const OFF_LEFT = -150, OFF_RIGHT = 1440;

/**
 * Room battles get more menacing as the expedition goes on (later lessons build on earlier ones): the first room
 * is the gentlest tier, the last room the darkest, spread over however many rooms the run has. Arenas go from the
 * sunset meadow to the deep forest to the moonlit ruins; monsters from the slime to the drake. Each monster's size,
 * standing height (feet on the same floor line, about y 613) and nameplate height are tuned to its sheet.
 */
const tiers = [
    { enemy: 'monster', background: 'fight_scene_3', name: 'Misconception slime', width: 191, y: 531, plateY: 439 },
    { enemy: 'monster_2', background: 'fight_scene_2', name: 'Muddle beast', width: 205, y: 525, plateY: 447 },
    // The drake's body fills only the lower part of its frame, so its sheet is drawn larger to read as the fiercest.
    { enemy: 'monster_3', background: 'fight_scene_1', name: 'Fallacy drake', width: 255, y: 504, plateY: 434 },
] as const;
/** The final exam has its own hall and dragon. */
const BOSS = { enemy: 'final_boss', background: 'boss_room_background', name: 'The final exam', ...POS.boss, plateY: POS.boss.y - 95 } as const;
export const DANGER_LEVELS = tiers.length;
const files = ['concept_room_background','boss_room_background','student_learning','student_fighting','student_finished',
    ...tiers.map(room => room.background)];
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
type Home = { homeX: number; homeY: number; enemy?: string };
/** How the next scene's actors arrive: walking in to study, or squaring up for a fight. */
export type Arrival = 'study' | 'fight' | null;
let arrival: Arrival = null;
export function setArrival(next: Arrival) { arrival = next; }

type Enemy = typeof tiers[number]['enemy'] | 'final_boss';

function animations(prefix: 'student' | Enemy) {
    return Object.fromEntries(Object.entries(clips)
        .filter(([key]) => game.assets.has(key) && (prefix === 'student'
            ? key.startsWith('student_') : key === prefix + '_idle' || key === prefix + '_attack'))
        .map(([strip, { fps, hold }]) => [strip, { strip, fps, hold }]));
}

function actorOf(tag: Actor): Sprite<Home> | undefined {
    for (const sprite of game.roster.tagged(tag)) if (sprite.alive) return sprite as Sprite<Home>;
    return undefined;
}

function playPose(actor: Actor, pose: Clip, follow?: Clip) {
    const sprite = actorOf(actor);
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

/** Danger tier (0 = gentlest) of room `index` out of `total`: first room 0, last room the top tier. */
export function tierFor(index: number, total: number): number {
    if (total <= 1) return 0;
    return Math.round((Math.min(index, total - 1) / (total - 1)) * (tiers.length - 1));
}

/** Who and where the foe is: its sheet, arena, name, standing spot, nameplate height and danger (boss: null). */
export function encounterFor(index: number, total: number, boss: boolean) {
    if (boss) return { ...BOSS, danger: null as number | null };
    const tier = tierFor(index, total);
    return { ...tiers[tier]!, x: POS.foe.x, danger: tier as number | null };
}

/** The foe's own attack sheet (each monster and the boss has one), then back to its idle sheet. */
function foeAttack() {
    const foe = actorOf('monster');
    const enemy = (foe?.data.enemy ?? 'monster') as Enemy;
    playPose('monster', `${enemy}_attack`, `${enemy}_idle`);
}

/** Pip walks to `toX` with the walking sheet (or a bouncing step without it). Resolves when the walk ends. */
export function walk(toX: number): Promise<void> {
    const pip = actorOf('student');
    if (!pip) return Promise.resolve();
    const homeY = pip.data.homeY;
    const time = Math.max(0.25, Math.abs(toX - pip.x) / WALK_SPEED);
    const sheet = game.assets.has('student_walking');
    if (sheet) pip.play('student_walking');
    const bob = game.tween.fromTo(pip, { y: homeY }, { y: homeY - (sheet ? STEP_BOB_WITH_SHEET : STEP_BOB) },
        { duration: STEP_TIME / 2, yoyo: true, loop: Math.max(1, Math.round(time / STEP_TIME)), ease: 'easeOutQuad' });
    return new Promise(resolve => {
        game.tween.to(pip, { x: toX }, { duration: time, ease: 'linear', onComplete: () => {
            bob.stop(); if (pip.alive) pip.y = homeY; resolve();
        } });
    });
}

/** Pip leaves through the right edge, for a room change. */
export function walkOff() { return walk(OFF_RIGHT); }

/** A few steps toward the next scene for a scene change without the curtain (app.ts goTo). */
export function walkToScene(arrive: () => void) {
    const pip = actorOf('student');
    if (!pip || !game.assets.has('student_walking')) return arrive();
    void walk(pip.x + SCENE_STEP);
    game.after(SCENE_STEP / WALK_SPEED + 0.05, arrive);
}

/** The answer lands: the attacker steps in (never past the victim), the victim is knocked back and flashes. */
export function strike(correct: boolean) {
    const pip = actorOf('student'), foe = actorOf('monster');
    if (correct) playPose('student', 'student_attack', 'student_idle');
    else foeAttack();
    if (!pip || !foe) return;
    const [attacker, victim, dir] = correct ? [pip, foe, 1] : [foe, pip, -1];
    const gap = Math.abs(victim.data.homeX - attacker.data.homeX) - (attacker.width + victim.width) / 2;
    const step = Math.max(0, Math.min(LUNGE, gap - MIN_GAP));
    game.tween.fromTo(attacker, { x: attacker.data.homeX }, { x: attacker.data.homeX + dir * step }, { duration: 0.14, yoyo: true, ease: 'easeOutQuad' });
    game.tween.fromTo(victim, { x: victim.data.homeX }, { x: victim.data.homeX + dir * KNOCKBACK }, { duration: 0.12, delay: 0.12, yoyo: true, ease: 'easeOutQuad' });
    game.tween.fromTo(victim, { alpha: 1 }, { alpha: 0.35 }, { duration: 0.09, delay: 0.12, yoyo: true, loop: 1,
        onComplete: () => { if (victim.alive) victim.alpha = 1; } });
    game.particles.burst({ x: victim.data.homeX - dir * victim.width * 0.2, y: victim.y - 20, count: correct ? 18 : 12, layer: 'front',
        frame: 'particle:spark', blend: 'add', speed: [90, 230], lifespan: [0.25, 0.55],
        color: correct ? ['#fff3b0', '#9ee6ff'] : ['#ffd0b0', '#ff6a4a'] });
    if (!correct) game.feel.shake(7, 0.25);
}

/** The foe is beaten: it flashes, shrinks and bursts into stars while Pip celebrates. */
export function defeatFoe() {
    const foe = actorOf('monster'), pip = actorOf('student');
    if (foe) {
        const facing = Math.sign(foe.sx) || 1;
        game.tween.fromTo(foe, { alpha: 1 }, { alpha: 0.3 }, { duration: 0.08, yoyo: true, loop: 3 });
        game.tween.to(foe, { sx: facing * 0.1, sy: 1.6, alpha: 0 }, { duration: 0.45, delay: 0.55, ease: 'easeInBack' });
        game.after(0.75, () => game.particles.burst({ x: foe.data.homeX, y: foe.data.homeY - 10, count: 36, layer: 'front',
            frame: 'particle:star', speed: [120, 320], lifespan: [0.5, 1.1], gravityY: 260, color: ['#fff3b0', '#ffd166', '#9ee6ff'] }));
        game.feel.shake(5, 0.3);
    }
    if (pip) {
        // A victory punch, then two hops (the "understanding" sheet is drawn at a desk, so it is for the library only).
        playPose('student', 'student_attack', 'student_idle');
        game.tween.fromTo(pip, { y: pip.data.homeY }, { y: pip.data.homeY - 28 }, { duration: 0.22, delay: 0.9, yoyo: true, loop: 1, ease: 'easeOutQuad' });
    }
}

/** Pip loses the room: the foe gloats and Pip slumps. */
export function defeatPip() {
    const pip = actorOf('student');
    foeAttack();
    if (pip) game.tween.to(pip, { alpha: 0.55, sy: 0.88, y: pip.data.homeY + 12 }, { duration: 0.5, delay: 0.3, ease: 'easeOutQuad' });
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

export function drawStage(run: { screen: string; isBoss: boolean; phase: string; index: number; rooms: number; victory: boolean }) {
    const entering = arrival; arrival = null;
    const boss = run.isBoss || run.screen === 'report';
    const teaching = run.phase === 'teach';
    const foe = encounterFor(run.index, run.rooms, run.isBoss);
    const bg = boss ? 'boss_room_background' : run.screen === 'room' && !teaching ? foe.background : 'concept_room_background';
    const key = (s: string) => game.assets.has(s) ? s : 'fallback-'+s;
    const encounter = run.screen === 'room' || run.isBoss;
    game.spawn({texture:key(bg), x:640, y:360, width:1280,height:720,layer:'back'});
    const idle = teaching ? 'student_writing_notes' : 'student_idle';
    const animated = !run.victory && game.assets.has(idle);
    const fallback = run.victory ? 'student_finished' : encounter && !teaching ? 'student_fighting' : 'student_learning';
    const spot = !encounter ? POS.lounge : teaching ? POS.desk : POS.pip;
    // The writing pose has Pip seated at a desk, so Pip walks in standing and sits down on arrival.
    const pose = entering && game.assets.has('student_idle') ? 'student_idle' : idle;
    const pip = game.spawn({
        texture: animated ? pose : key(fallback), tags: ['student'], x: entering ? OFF_LEFT : spot.x, y: spot.y,
        width: spot.width, layer: 'world', anims: animations('student'), data: { homeX: spot.x, homeY: spot.y },
        ...(animated ? { play: pose } : {}),
    });
    if (entering) void walk(spot.x).then(() => { if (pip.alive && animated && pose !== idle) pip.play(idle); });
    if (!encounter || teaching) return;
    const name: Enemy = foe.enemy;
    const idleClip = `${name}_idle` as const;
    const hasEnemy = game.assets.has(idleClip);
    const place = foe;
    const enemy = game.spawn({
        tags: ['monster'], texture: hasEnemy ? idleClip : 'foe' + (run.isBoss ? 3 : (foe.danger ?? 0)),
        x: place.x, y: place.y, width: place.width, layer: 'world', data: { homeX: place.x, homeY: place.y, enemy: name },
        anims: animations(name), ...(hasEnemy ? { play: idleClip } : {}),
    });
    if (hasEnemy) enemy.sx *= -1; // the sheets face right; the foe faces Pip
    if (run.phase === 'won') { enemy.alpha = 0; return; }
    if (entering === 'fight') {
        game.tween.fromTo(enemy, { x: OFF_RIGHT, alpha: 0 }, { x: place.x, alpha: 1 }, { duration: 0.7, delay: 0.35, ease: 'easeOutBack' });
        game.after(1.05, () => game.particles.burst({ x: place.x, y: place.y + place.width * 0.35, count: 14, layer: 'front',
            frame: 'particle:smoke', speed: [40, 110], angle: 270, spread: 150, lifespan: [0.4, 0.8], color: ['#d8c7ad', '#8e6546'] }));
    }
}
