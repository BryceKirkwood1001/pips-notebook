import { ApiError, createApiClient, type PublicRun, type Results, type RunPhase } from './api-client.js';
import { createMockApi } from './mock.js';
import { btn, el, host, clock } from './ui.js';
import { game } from '../engine.js';
import { walkToScene } from '../art.js';
import { curtainUp } from './transition.js';

const params = new URLSearchParams(location.search);
export const mock = params.get('mock') === '1';
export let apiOrigin = params.get('api') || 'http://localhost:8787';
try { apiOrigin = params.get('api') || localStorage.getItem('top.apiOrigin') || apiOrigin; } catch { /* Storage may be disabled. */ }
export let api = mock ? createMockApi() : createApiClient({baseUrl: apiOrigin});
export const state: {run: PublicRun | null; results: Results | null} = {run:null, results:null};
export type Screen = 'Title' | 'Upload' | 'Learning' | 'Fight' | 'Boss' | 'Results' | 'Settings' | 'Menu';
let currentScreen: Screen = 'Title';
let settingsReturn: Screen = 'Title';
let walking = false;
export function goTo(screen: Screen) {
    if (walking) return;
    const stage = host.querySelector<HTMLElement>('.course-stage');
    const arrive = () => {
        if (stage) {
            stage.inert = false;
            stage.classList.remove('travelling');
        }
        walking = false;
        currentScreen = screen;
        game.scenes.go(screen);
    };
    const leavesRoom = ['Upload', 'Learning', 'Fight', 'Boss'].includes(currentScreen);
    const entersRoom = ['Learning', 'Fight', 'Boss', 'Results'].includes(screen);
    // Behind a room-change title card (transition.ts) Pip already walks out and in, so the scene changes at once.
    if (currentScreen === screen || !leavesRoom || !entersRoom || curtainUp() ||
        state.run?.pendingHelpMe || clock.matchMedia('(prefers-reduced-motion: reduce)').matches) return arrive();
    walking = true;
    if (stage) {
        stage.inert = true;
        stage.classList.add('travelling');
    }
    walkToScene(arrive);
}
/** Home: back to the title screen. A run in progress is paused first (help timers freeze) and stays in My archive. */
export async function goHome() {
    const run = state.run;
    if (run && !run.pausedAt && !run.endedAt && run.phase !== 'results') await call(() => api.pauseRun(run.id));
    setRun(null); state.results = null;
    goTo('Title');
}
export function openSettings() { settingsReturn = currentScreen; goTo('Settings'); }
export function backFromSettings() { goTo(state.run?.pausedAt ? 'Menu' : state.run ? sceneForPhase(state.run.phase) : settingsReturn === 'Settings' ? 'Title' : settingsReturn); }
export async function openMenu() {
    if (!state.run) return goTo('Upload');
    const run = await call(() => api.pauseRun(state.run!.id));
    if (run) {setRun(run);goTo('Menu');}
}
export async function continuePlaying() {
    if (!state.run) return goTo('Upload');
    if (state.run.endedAt) return goTo('Menu'); // an ended expedition is a record: it opens in the menu
    const run=await call(()=>api.resumeRun(state.run!.id));
    if(run){setRun(run);goTo(sceneForPhase(run.phase));}
}
export function setApiOrigin(origin: string) {
    if (apiOrigin !== origin) { setRun(null); state.results = null; settingsReturn = 'Title'; needsSync = false; }
    apiOrigin = origin;
    if (!mock) api = createApiClient({ baseUrl: origin });
    try { localStorage.setItem('top.apiOrigin', origin); } catch { /* Only this non-secret origin is persisted in the browser. */ }
    const url = new URL(location.href); url.searchParams.set('api', origin); history.replaceState(null, '', url);
}
export function sceneForPhase(phase: RunPhase): Screen {
    switch (phase) {
        case 'learning': return 'Learning';
        case 'room': case 'room_result': return 'Fight';
        case 'boss': return 'Boss';
        case 'results': return 'Results';
    }
}
export function setRun(run: PublicRun | null) {
    state.run=run;
    const url=new URL(location.href);
    if (run) url.searchParams.set('run',run.id);
    else url.searchParams.delete('run');
    history.replaceState(null,'',url);
}
export function describeError(error: unknown) {
    if (error instanceof ApiError) return (error.status===425?'Room still preparing. ':'')+error.message+' ('+error.code+', '+error.status+')';
    return error instanceof Error ? error.message : String(error);
}
export const banner=el('aside','api-error');
banner.setAttribute('role','alert');
export function showError(message:string) {
    banner.replaceChildren(el('span','',message),btn('Dismiss',()=>banner.replaceChildren(),'alt'));
}
let inflight=false;
let needsSync=false;
async function reconcile() {
    if (!state.run) return;
    const snapshot=await api.getRun(state.run.id);
    setRun(snapshot); needsSync=false;
    goTo(snapshot.pausedAt || snapshot.endedAt ? 'Menu' : sceneForPhase(snapshot.phase));
}
export async function call<T>(action:()=>Promise<T>):Promise<T|undefined> {
    if(inflight) return;
    inflight=true; banner.replaceChildren();host.body.classList.add('waiting');
    try {
        if (needsSync && state.run) { await reconcile(); return; }
        return await action();
    } catch(error) {
        let message=describeError(error);
        if (state.run && (error instanceof TypeError || (error instanceof ApiError && [0,409,425].includes(error.status)))) {
            needsSync=true;
            try { await reconcile(); }
            catch(syncError) { message+=' · Could not refresh the run: '+describeError(syncError); }
        }
        showError(message);
    } finally {inflight=false;host.body.classList.remove('waiting');}
}
export async function resume(id:string) {
    const run=await call(()=>api.getRun(id));
    if(run) {setRun(run);goTo(run.pausedAt || run.endedAt ? 'Menu' : sceneForPhase(run.phase));}
}
