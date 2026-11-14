import { ApiError, createApiClient, type PublicRun, type Results, type RunPhase } from './api-client.js';
import { createMockApi } from './mock.js';
import { btn, el, host } from './ui.js';
import { game } from '../engine.js';

const params = new URLSearchParams(location.search);
export const mock = params.get('mock') === '1';
export let apiOrigin = params.get('api') || 'http://localhost:8787';
try { apiOrigin = params.get('api') || localStorage.getItem('top.apiOrigin') || apiOrigin; } catch { /* Storage may be disabled. */ }
export let api = mock ? createMockApi() : createApiClient({baseUrl: apiOrigin});
export const state: {run: PublicRun | null; results: Results | null} = {run:null, results:null};
export type Screen = 'Title' | 'Upload' | 'Learning' | 'Fight' | 'Boss' | 'Results' | 'Settings';
let currentScreen: Screen = 'Title';
let settingsReturn: Screen = 'Title';
export function goTo(screen: Screen) { currentScreen = screen; game.scenes.go(screen); }
export function openSettings() { settingsReturn = currentScreen; goTo('Settings'); }
export function backFromSettings() { goTo(state.run ? sceneForPhase(state.run.phase) : settingsReturn === 'Settings' ? 'Title' : settingsReturn); }
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
    goTo(sceneForPhase(snapshot.phase));
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
    if(run) {setRun(run);goTo(sceneForPhase(run.phase));}
}
