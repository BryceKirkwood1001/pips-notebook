# Frontend source variable inventory

Generated from the current TypeScript source. This lists every variable declaration, class field and function/callback parameter in `test-client/src`, including temporary rendering locals. Imported bindings refer to declarations in their source modules. The screen/API contract and field meanings are in [FRONTEND_VARIABLES.md](FRONTEND_VARIABLES.md).

Regenerate with `npm run docs:frontend`. Types come from the TypeScript checker and are shortened after 180 characters. Repeated names are distinct bindings in the listed scopes. This inventory describes the reference harness; the Phaser AE teammate does not need to copy its presentation internals.

## app.ts

Page: All pages: configuration, state, errors, navigation.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `params` | variable | `URLSearchParams` | module | [13](../test-client/src/app.ts#L13) |
| `isMock` | variable | `boolean` | module | [14](../test-client/src/app.ts#L14) |
| `apiOrigin` | variable | `string` | module | [15](../test-client/src/app.ts#L15) |
| `api` | variable | `{ getApiSettings: () => Promise<ApiSettings>; updateApiSettings: (body: UpdateApiSettingsBody) => Promise<ApiSettings>; testApiSettings: (body: UpdateApiSettingsBody) => Promise...` | module | [17](../test-client/src/app.ts#L17) |
| `state` | variable | `{ run: PublicRun \| null; results: Results \| null; game: Game \| null; }` | module | [21](../test-client/src/app.ts#L21) |
| `text` | parameter | `string` | showError | [29](../test-client/src/app.ts#L29) |
| `b` | variable | `HTMLElement \| null` | showError | [30](../test-client/src/app.ts#L30) |
| `close` | variable | `HTMLButtonElement` | showError | [33](../test-client/src/app.ts#L33) |
| `msg` | variable | `HTMLSpanElement` | showError | [36](../test-client/src/app.ts#L36) |
| `b` | variable | `HTMLElement \| null` | clearBanner | [43](../test-client/src/app.ts#L43) |
| `err` | parameter | `unknown` | describeError | [47](../test-client/src/app.ts#L47) |
| `pre` | variable | `"Not ready yet. " \| ""` | describeError | [49](../test-client/src/app.ts#L49) |
| `inflight` | variable | `boolean` | module | [57](../test-client/src/app.ts#L57) |
| `fn` | parameter | `() => Promise<T>` | call | [60](../test-client/src/app.ts#L60) |
| `err` | variable | `unknown` | call | [67](../test-client/src/app.ts#L67) |
| `run` | variable | `PublicRun` | call | [72](../test-client/src/app.ts#L72) |
| `e2` | variable | `unknown` | call | [75](../test-client/src/app.ts#L75) |
| `p` | parameter | `RunPhase` | sceneForPhase | [88](../test-client/src/app.ts#L88) |
| `run` | parameter | `PublicRun \| null` | setRun | [103](../test-client/src/app.ts#L103) |
| `u` | variable | `URL` | setRun | [105](../test-client/src/app.ts#L105) |
| `SCENE_STARTED` | variable | `2` | module | [112](../test-client/src/app.ts#L112) |
| `SCENE_SLEEPING` | variable | `7` | module | [113](../test-client/src/app.ts#L113) |
| `key` | parameter | `string` | goTo | [120](../test-client/src/app.ts#L120) |
| `game` | variable | `Game \| null` | goTo | [121](../test-client/src/app.ts#L121) |
| `scene` | variable | `Scene` | goTo | [123](../test-client/src/app.ts#L123) |
| `status` | variable | `number` | goTo | [124](../test-client/src/app.ts#L124) |

## battle.ts

Page: Fight and Boss.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `MONSTERS` | variable | `string[]` | module | [8](../test-client/src/battle.ts#L8) |
| `student` | field | `Text` | BattleScene | [12](../test-client/src/battle.ts#L12) |
| `monster` | field | `Text` | BattleScene | [13](../test-client/src/battle.ts#L13) |
| `fx` | field | `Text` | BattleScene | [14](../test-client/src/battle.ts#L14) |
| `statText` | field | `Text` | BattleScene | [15](../test-client/src/battle.ts#L15) |
| `bar` | field | `Graphics \| undefined` | BattleScene | [16](../test-client/src/battle.ts#L16) |
| `logEl` | field | `HTMLElement` | BattleScene | [17](../test-client/src/battle.ts#L17) |
| `detailEl` | field | `HTMLElement` | BattleScene | [18](../test-client/src/battle.ts#L18) |
| `endEl` | field | `HTMLElement` | BattleScene | [19](../test-client/src/battle.ts#L19) |
| `nextBtn` | field | `HTMLButtonElement` | BattleScene | [20](../test-client/src/battle.ts#L20) |
| `modal` | field | `DOMElement \| undefined` | BattleScene | [21](../test-client/src/battle.ts#L21) |
| `stopHelp` | field | `(() => void) \| undefined` | BattleScene | [22](../test-client/src/battle.ts#L22) |
| `hearts` | field | `number` | BattleScene | [23](../test-client/src/battle.ts#L23) |
| `maxHearts` | field | `number` | BattleScene | [24](../test-client/src/battle.ts#L24) |
| `health` | field | `number` | BattleScene | [25](../test-client/src/battle.ts#L25) |
| `answered` | field | `number` | BattleScene | [26](../test-client/src/battle.ts#L26) |
| `total` | field | `number` | BattleScene | [27](../test-client/src/battle.ts#L27) |
| `key` | parameter | `string` | BattleScene → constructor | [29](../test-client/src/battle.ts#L29) |
| `kind` | constructor field | `Kind` | BattleScene → constructor | [29](../test-client/src/battle.ts#L29) |
| `run` | variable | `PublicRun \| null` | BattleScene → create | [34](../test-client/src/battle.ts#L34) |
| `boss` | variable | `boolean` | BattleScene → create | [36](../test-client/src/battle.ts#L36) |
| `fight` | variable | `{ turn: number; totalTurns: number; health: number; helpMeUsed: number; log: TurnResult[]; } \| { attempt: number; turn: number; totalTurns: number; hearts: number; maxHearts: nu...` | BattleScene → create | [37](../test-client/src/battle.ts#L37) |
| `monsterEmoji` | variable | `string` | BattleScene → create | [48](../test-client/src/battle.ts#L48) |
| `left` | variable | `HTMLDivElement` | BattleScene → create | [59](../test-client/src/battle.ts#L59) |
| `right` | variable | `HTMLDivElement` | BattleScene → create | [60](../test-client/src/battle.ts#L60) |
| `r` | variable | `TurnResult` | BattleScene → create | [65](../test-client/src/battle.ts#L65) |
| `last` | variable | `TurnResult \| undefined` | BattleScene → create | [67](../test-client/src/battle.ts#L67) |
| `run` | variable | `PublicRun \| null` | BattleScene → nextTurn | [78](../test-client/src/battle.ts#L78) |
| `r` | variable | `TurnResult \| undefined` | BattleScene → nextTurn | [80](../test-client/src/battle.ts#L80) |
| `r` | parameter | `TurnResult` | BattleScene → handle | [84](../test-client/src/battle.ts#L84) |
| `run` | variable | `PublicRun` | BattleScene → handle | [85](../test-client/src/battle.ts#L85) |
| `resolve` | parameter | `(value: void \| PromiseLike<void>) => void` | BattleScene → handle → (callback) | [98](../test-client/src/battle.ts#L98) |
| `phaseAfter` | parameter | `RunPhase` | BattleScene → afterDamage | [118](../test-client/src/battle.ts#L118) |
| `target` | parameter | `Text` | BattleScene → tw | [125](../test-client/src/battle.ts#L125) |
| `props` | parameter | `Record<string, number>` | BattleScene → tw | [125](../test-client/src/battle.ts#L125) |
| `duration` | parameter | `number` | BattleScene → tw | [125](../test-client/src/battle.ts#L125) |
| `yoyo` | parameter | `boolean` | BattleScene → tw | [125](../test-client/src/battle.ts#L125) |
| `resolve` | parameter | `(value: void \| PromiseLike<void>) => void` | BattleScene → tw → (callback) | [126](../test-client/src/battle.ts#L126) |
| `emoji` | parameter | `string` | BattleScene → pop | [131](../test-client/src/battle.ts#L131) |
| `at` | parameter | `Text` | BattleScene → pop | [131](../test-client/src/battle.ts#L131) |
| `resolve` | parameter | `(value: void \| PromiseLike<void>) => void` | BattleScene → pop → (callback) | [133](../test-client/src/battle.ts#L133) |
| `r` | parameter | `StudentAnswerTurn \| HelpResultTurn` | BattleScene → animate | [138](../test-client/src/battle.ts#L138) |
| `sx` | variable | `number` | BattleScene → animate | [139](../test-client/src/battle.ts#L139) |
| `g` | variable | `Graphics` | BattleScene → drawStats | [158](../test-client/src/battle.ts#L158) |
| `r` | parameter | `TurnResult` | BattleScene → addLog | [165](../test-client/src/battle.ts#L165) |
| `text` | variable | `string` | BattleScene → addLog | [167](../test-client/src/battle.ts#L167) |
| `r` | parameter | `TurnResult` | BattleScene → showDetail | [176](../test-client/src/battle.ts#L176) |
| `d` | variable | `HTMLElement` | BattleScene → showDetail | [177](../test-client/src/battle.ts#L177) |
| `n` | parameter | `string` | BattleScene → showDetail → (callback) | [186](../test-client/src/battle.ts#L186) |
| `passed` | parameter | `boolean` | BattleScene → showRoomEnd | [204](../test-client/src/battle.ts#L204) |
| `failed` | parameter | `{ question: PublicQuestion; reasoning: string; citedNotes: string[]; }[]` | BattleScene → showRoomEnd | [204](../test-client/src/battle.ts#L204) |
| `e` | variable | `HTMLElement` | BattleScene → showRoomEnd | [205](../test-client/src/battle.ts#L205) |
| `f` | variable | `{ question: PublicQuestion; reasoning: string; citedNotes: string[]; }` | BattleScene → showRoomEnd | [212](../test-client/src/battle.ts#L212) |
| `fn` | parameter | `() => Promise<PublicRun>` | BattleScene → move | [218](../test-client/src/battle.ts#L218) |
| `run` | variable | `PublicRun \| undefined` | BattleScene → move | [219](../test-client/src/battle.ts#L219) |
| `ev` | parameter | `HelpMeTurn` | BattleScene → openHelp | [227](../test-client/src/battle.ts#L227) |
| `built` | variable | `{ el: HTMLElement; stop: () => void; }` | BattleScene → openHelp | [230](../test-client/src/battle.ts#L230) |
| `a` | parameter | `Answer` | BattleScene → openHelp → (callback) | [230](../test-client/src/battle.ts#L230) |
| `wrap` | variable | `HTMLDivElement` | BattleScene → openHelp | [232](../test-client/src/battle.ts#L232) |
| `ev` | parameter | `HelpMeTurn` | BattleScene → submitHelp | [244](../test-client/src/battle.ts#L244) |
| `answer` | parameter | `Answer` | BattleScene → submitHelp | [244](../test-client/src/battle.ts#L244) |
| `run` | variable | `PublicRun \| null` | BattleScene → submitHelp | [245](../test-client/src/battle.ts#L245) |
| `r` | variable | `TurnResult \| undefined` | BattleScene → submitHelp | [247](../test-client/src/battle.ts#L247) |

## debug.ts

Page: Development overlay on every page.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `a` | variable | `HTMLElement \| null` | isTyping | [6](../test-client/src/debug.ts#L6) |
| `box` | parameter | `HTMLElement` | render | [10](../test-client/src/debug.ts#L10) |
| `head` | variable | `HTMLDivElement` | render | [12](../test-client/src/debug.ts#L12) |
| `refresh` | variable | `HTMLButtonElement` | render | [14](../test-client/src/debug.ts#L14) |
| `add` | variable | `(t: string, cls?: string) => void` | render | [20](../test-client/src/debug.ts#L20) |
| `t` | parameter | `string` | render → add | [20](../test-client/src/debug.ts#L20) |
| `cls` | parameter | `string` | render → add | [20](../test-client/src/debug.ts#L20) |
| `d` | variable | `HTMLDivElement` | render → add | [21](../test-client/src/debug.ts#L21) |
| `data` | variable | `unknown` | render | [29](../test-client/src/debug.ts#L29) |
| `k` | variable | `string` | render | [33](../test-client/src/debug.ts#L33) |
| `v` | variable | `unknown` | render | [33](../test-client/src/debug.ts#L33) |
| `d` | variable | `HTMLDetailsElement` | render | [34](../test-client/src/debug.ts#L34) |
| `s` | variable | `HTMLElement` | render | [36](../test-client/src/debug.ts#L36) |
| `pre` | variable | `HTMLPreElement` | render | [38](../test-client/src/debug.ts#L38) |
| `pre` | variable | `HTMLPreElement` | render | [44](../test-client/src/debug.ts#L44) |
| `err` | variable | `unknown` | render | [48](../test-client/src/debug.ts#L48) |
| `box` | variable | `HTMLElement \| null` | installDebug | [56](../test-client/src/debug.ts#L56) |
| `e` | parameter | `KeyboardEvent` | installDebug → (callback) | [58](../test-client/src/debug.ts#L58) |

## helpModal.ts

Page: Help overlay on Fight and Boss.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `LEVELS` | variable | `string[]` | module | [5](../test-client/src/helpModal.ts#L5) |
| `ev` | parameter | `HelpMeTurn` | buildHelp | [8](../test-client/src/helpModal.ts#L8) |
| `submit` | parameter | `(a: Answer) => void` | buildHelp | [8](../test-client/src/helpModal.ts#L8) |
| `a` | parameter | `Answer` | buildHelp | [8](../test-client/src/helpModal.ts#L8) |
| `q` | variable | `PublicQuestion` | buildHelp | [9](../test-client/src/helpModal.ts#L9) |
| `sent` | variable | `boolean` | buildHelp | [10](../test-client/src/helpModal.ts#L10) |
| `tick` | variable | `number` | buildHelp | [11](../test-client/src/helpModal.ts#L11) |
| `stop` | variable | `() => void` | buildHelp | [12](../test-client/src/helpModal.ts#L12) |
| `build` | variable | `(final: boolean) => Answer` | buildHelp | [15](../test-client/src/helpModal.ts#L15) |
| `final` | parameter | `boolean` | buildHelp | [15](../test-client/src/helpModal.ts#L15) |
| `input` | variable | `HTMLDivElement` | buildHelp | [16](../test-client/src/helpModal.ts#L16) |
| `pick` | variable | `number` | buildHelp | [20](../test-client/src/helpModal.ts#L20) |
| `bs` | variable | `HTMLButtonElement[]` | buildHelp | [21](../test-client/src/helpModal.ts#L21) |
| `o` | parameter | `string` | buildHelp → (callback) | [21](../test-client/src/helpModal.ts#L21) |
| `i` | parameter | `number` | buildHelp → (callback) | [21](../test-client/src/helpModal.ts#L21) |
| `b` | parameter | `HTMLButtonElement` | buildHelp → (callback) → (callback) → (callback) | [24](../test-client/src/helpModal.ts#L24) |
| `j` | parameter | `number` | buildHelp → (callback) → (callback) → (callback) | [24](../test-client/src/helpModal.ts#L24) |
| `b` | parameter | `HTMLButtonElement` | buildHelp → (callback) | [27](../test-client/src/helpModal.ts#L27) |
| `pick` | variable | `boolean \| null` | buildHelp | [32](../test-client/src/helpModal.ts#L32) |
| `t` | variable | `HTMLButtonElement` | buildHelp | [33](../test-client/src/helpModal.ts#L33) |
| `f` | variable | `HTMLButtonElement` | buildHelp | [34](../test-client/src/helpModal.ts#L34) |
| `set` | variable | `(v: boolean) => void` | buildHelp | [35](../test-client/src/helpModal.ts#L35) |
| `v` | parameter | `boolean` | buildHelp → set | [35](../test-client/src/helpModal.ts#L35) |
| `boxes` | variable | `HTMLInputElement[]` | buildHelp | [45](../test-client/src/helpModal.ts#L45) |
| `o` | parameter | `string` | buildHelp → (callback) | [45](../test-client/src/helpModal.ts#L45) |
| `cb` | variable | `HTMLInputElement` | buildHelp → (callback) | [46](../test-client/src/helpModal.ts#L46) |
| `cb` | parameter | `HTMLInputElement` | buildHelp → (callback) → (callback) | [51](../test-client/src/helpModal.ts#L51) |
| `i` | parameter | `number` | buildHelp → (callback) → (callback) | [51](../test-client/src/helpModal.ts#L51) |
| `n` | variable | `HTMLInputElement` | buildHelp | [55](../test-client/src/helpModal.ts#L55) |
| `order` | variable | `number[]` | buildHelp | [64](../test-client/src/helpModal.ts#L64) |
| `list` | variable | `HTMLDivElement` | buildHelp | [65](../test-client/src/helpModal.ts#L65) |
| `draw` | variable | `() => void` | buildHelp | [66](../test-client/src/helpModal.ts#L66) |
| `item` | parameter | `string` | buildHelp → draw → (callback) | [68](../test-client/src/helpModal.ts#L68) |
| `i` | parameter | `number` | buildHelp → draw → (callback) | [68](../test-client/src/helpModal.ts#L68) |
| `pos` | variable | `number` | buildHelp → draw → (callback) | [69](../test-client/src/helpModal.ts#L69) |
| `final` | parameter | `boolean` | buildHelp → (callback) | [79](../test-client/src/helpModal.ts#L79) |
| `rest` | variable | `number[]` | buildHelp → (callback) | [81](../test-client/src/helpModal.ts#L81) |
| `_` | parameter | `string` | buildHelp → (callback) → (callback) | [81](../test-client/src/helpModal.ts#L81) |
| `i` | parameter | `number` | buildHelp → (callback) → (callback) | [81](../test-client/src/helpModal.ts#L81) |
| `i` | parameter | `number` | buildHelp → (callback) → (callback) | [81](../test-client/src/helpModal.ts#L81) |
| `t` | variable | `HTMLInputElement` | buildHelp | [88](../test-client/src/helpModal.ts#L88) |
| `go` | variable | `(final: boolean) => void` | buildHelp | [96](../test-client/src/helpModal.ts#L96) |
| `final` | parameter | `boolean` | buildHelp → go | [96](../test-client/src/helpModal.ts#L96) |
| `submitBtn` | variable | `HTMLButtonElement` | buildHelp | [102](../test-client/src/helpModal.ts#L102) |
| `timer` | variable | `HTMLDivElement` | buildHelp | [104](../test-client/src/helpModal.ts#L104) |
| `end` | variable | `number` | buildHelp | [106](../test-client/src/helpModal.ts#L106) |
| `update` | variable | `() => void` | buildHelp | [107](../test-client/src/helpModal.ts#L107) |
| `left` | variable | `number` | buildHelp → update | [108](../test-client/src/helpModal.ts#L108) |
| `root` | variable | `HTMLDivElement` | buildHelp | [119](../test-client/src/helpModal.ts#L119) |

## main.ts

Page: Application startup.

No local variable/field/parameter declarations; see the base class.

## settings-preview.ts

Page: Standalone preview of the actual game API Settings component.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `params` | variable | `URLSearchParams` | module | [6](../test-client/src/settings-preview.ts#L6) |
| `origin` | variable | `string` | module | [7](../test-client/src/settings-preview.ts#L7) |
| `stage` | variable | `HTMLElement` | module | [9](../test-client/src/settings-preview.ts#L9) |
| `header` | variable | `HTMLElement` | module | [11](../test-client/src/settings-preview.ts#L11) |
| `sheet` | variable | `HTMLElement` | module | [12](../test-client/src/settings-preview.ts#L12) |
| `view` | variable | `{ el: HTMLElement; stop: () => void; }` | module | [13](../test-client/src/settings-preview.ts#L13) |
| `next` | parameter | `string` | onOriginChange | [14](../test-client/src/settings-preview.ts#L14) |
| `url` | variable | `URL` | onOriginChange | [16](../test-client/src/settings-preview.ts#L16) |
| `fit` | variable | `() => void` | module | [21](../test-client/src/settings-preview.ts#L21) |
| `scale` | variable | `number` | fit | [21](../test-client/src/settings-preview.ts#L21) |

## mockApi.ts

Page: Browser-only canned mock implementation (`?mock=1`).

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `wait` | variable | `(ms?: number) => Promise<unknown>` | module | [19](../test-client/src/mockApi.ts#L19) |
| `ms` | parameter | `number` | wait | [19](../test-client/src/mockApi.ts#L19) |
| `r` | parameter | `(value: unknown) => void` | wait → (callback) | [19](../test-client/src/mockApi.ts#L19) |
| `q` | variable | `(id: string, type: string, prompt: string, payload: object) => PublicQuestion` | module | [20](../test-client/src/mockApi.ts#L20) |
| `id` | parameter | `string` | q | [20](../test-client/src/mockApi.ts#L20) |
| `type` | parameter | `string` | q | [20](../test-client/src/mockApi.ts#L20) |
| `prompt` | parameter | `string` | q | [20](../test-client/src/mockApi.ts#L20) |
| `payload` | parameter | `object` | q | [20](../test-client/src/mockApi.ts#L20) |
| `HELP` | variable | `{ q: PublicQuestion; key: Answer; text: string; }[]` | module | [24](../test-client/src/mockApi.ts#L24) |
| `STUDENT_QS` | variable | `{ q: PublicQuestion; right: string; wrong: string; }[]` | module | [34](../test-client/src/mockApi.ts#L34) |
| `ROOMS` | variable | `{ id: string; title: string; concepts: { id: string; title: string; }[]; }[]` | module | [39](../test-client/src/mockApi.ts#L39) |
| `RESULTS` | variable | `Results` | module | [44](../test-client/src/mockApi.ts#L44) |
| `key` | parameter | `Answer` | isRight | [65](../test-client/src/mockApi.ts#L65) |
| `a` | parameter | `Answer` | isRight | [65](../test-client/src/mockApi.ts#L65) |
| `polls` | variable | `number` | createMockApi | [71](../test-client/src/mockApi.ts#L71) |
| `run` | variable | `PublicRun \| null` | createMockApi | [72](../test-client/src/mockApi.ts#L72) |
| `attempt` | variable | `number` | createMockApi | [73](../test-client/src/mockApi.ts#L73) |
| `helpCount` | variable | `number` | createMockApi | [74](../test-client/src/mockApi.ts#L74) |
| `pending` | variable | `{ ev: HelpMeTurn; item: { q: PublicQuestion; key: Answer; text: string; }; } \| null` | createMockApi | [75](../test-client/src/mockApi.ts#L75) |
| `over` | variable | `boolean` | createMockApi | [76](../test-client/src/mockApi.ts#L76) |
| `failed` | variable | `FailedTurn[]` | createMockApi | [77](../test-client/src/mockApi.ts#L77) |
| `questions` | variable | `PublicStudentQuestion[]` | createMockApi | [78](../test-client/src/mockApi.ts#L78) |
| `notebook` | variable | `string` | createMockApi | [79](../test-client/src/mockApi.ts#L79) |
| `need` | variable | `(...phases: RunPhase[]) => PublicRun` | createMockApi | [81](../test-client/src/mockApi.ts#L81) |
| `phases` | parameter | `RunPhase[]` | createMockApi → need | [81](../test-client/src/mockApi.ts#L81) |
| `fightLog` | variable | `() => TurnResult[]` | createMockApi | [86](../test-client/src/mockApi.ts#L86) |
| `view` | variable | `() => PublicRun` | createMockApi | [87](../test-client/src/mockApi.ts#L87) |
| `r` | variable | `PublicRun` | createMockApi → view | [88](../test-client/src/mockApi.ts#L88) |
| `x` | parameter | `PublicRunRoom` | createMockApi → view → (callback) | [89](../test-client/src/mockApi.ts#L89) |
| `i` | parameter | `number` | createMockApi → view → (callback) | [89](../test-client/src/mockApi.ts#L89) |
| `startFight` | variable | `(boss: boolean) => void` | createMockApi | [97](../test-client/src/mockApi.ts#L97) |
| `boss` | parameter | `boolean` | createMockApi → startFight | [97](../test-client/src/mockApi.ts#L97) |
| `settle` | variable | `(wrong: boolean) => { damage: number; hearts: number \| undefined; health: number \| undefined; phaseAfter: RunPhase; }` | createMockApi | [106](../test-client/src/mockApi.ts#L106) |
| `wrong` | parameter | `boolean` | createMockApi → settle | [106](../test-client/src/mockApi.ts#L106) |
| `r` | variable | `PublicRun` | createMockApi → settle | [107](../test-client/src/mockApi.ts#L107) |
| `boss` | variable | `boolean` | createMockApi → settle | [108](../test-client/src/mockApi.ts#L108) |
| `f` | variable | `{ turn: number; totalTurns: number; health: number; helpMeUsed: number; log: TurnResult[]; } \| { attempt: number; turn: number; totalTurns: number; hearts: number; maxHearts: nu...` | createMockApi → settle | [109](../test-client/src/mockApi.ts#L109) |
| `damage` | variable | `0 \| 1 \| 17` | createMockApi → settle | [111](../test-client/src/mockApi.ts#L111) |
| `done` | variable | `boolean` | createMockApi → settle | [114](../test-client/src/mockApi.ts#L114) |
| `api` | variable | `{ getApiSettings: () => Promise<ApiSettings>; updateApiSettings: (body: UpdateApiSettingsBody) => Promise<ApiSettings>; testApiSettings: (body: UpdateApiSettingsBody) => Promise...` | createMockApi | [120](../test-client/src/mockApi.ts#L120) |
| `stage` | variable | `"parsing" \| "outline" \| "concepts" \| "ready"` | createMockApi → (callback) | [136](../test-client/src/mockApi.ts#L136) |
| `ready` | variable | `(id: string) => boolean` | createMockApi → (callback) | [137](../test-client/src/mockApi.ts#L137) |
| `id` | parameter | `string` | createMockApi → (callback) → ready | [137](../test-client/src/mockApi.ts#L137) |
| `r` | parameter | `{ id: string; title: string; concepts: { id: string; title: string; }[]; }` | createMockApi → (callback) → (callback) | [140](../test-client/src/mockApi.ts#L140) |
| `c` | parameter | `{ id: string; title: string; }` | createMockApi → (callback) → (callback) → (callback) | [140](../test-client/src/mockApi.ts#L140) |
| `r` | parameter | `{ id: string; title: string; concepts: { id: string; title: string; }[]; }` | createMockApi → (callback) → (callback) | [141](../test-client/src/mockApi.ts#L141) |
| `c` | parameter | `{ id: string; title: string; }` | createMockApi → (callback) → (callback) → (callback) | [141](../test-client/src/mockApi.ts#L141) |
| `body` | parameter | `CreateRunBody` | createMockApi → (callback) | [146](../test-client/src/mockApi.ts#L146) |
| `ids` | variable | `string[]` | createMockApi → (callback) | [149](../test-client/src/mockApi.ts#L149) |
| `r` | parameter | `{ id: string; title: string; concepts: { id: string; title: string; }[]; }` | createMockApi → (callback) → (callback) | [149](../test-client/src/mockApi.ts#L149) |
| `rooms` | variable | `{ ready: boolean; state: "upcoming"; id: string; title: string; concepts: { id: string; title: string; }[]; }[]` | createMockApi → (callback) | [150](../test-client/src/mockApi.ts#L150) |
| `r` | parameter | `{ id: string; title: string; concepts: { id: string; title: string; }[]; }` | createMockApi → (callback) → (callback) | [150](../test-client/src/mockApi.ts#L150) |
| `r` | parameter | `{ id: string; title: string; concepts: { id: string; title: string; }[]; }` | createMockApi → (callback) → (callback) | [150](../test-client/src/mockApi.ts#L150) |
| `id` | parameter | `string` | createMockApi → (callback) | [161](../test-client/src/mockApi.ts#L161) |
| `_id` | parameter | `string` | createMockApi → (callback) | [167](../test-client/src/mockApi.ts#L167) |
| `explanation` | parameter | `string` | createMockApi → (callback) | [167](../test-client/src/mockApi.ts#L167) |
| `title` | variable | `string` | createMockApi → (callback) | [171](../test-client/src/mockApi.ts#L171) |
| `_id` | parameter | `string` | createMockApi → (callback) | [178](../test-client/src/mockApi.ts#L178) |
| `qid` | parameter | `string` | createMockApi → (callback) | [178](../test-client/src/mockApi.ts#L178) |
| `answer` | parameter | `string` | createMockApi → (callback) | [178](../test-client/src/mockApi.ts#L178) |
| `resolved` | variable | `boolean` | createMockApi → (callback) | [181](../test-client/src/mockApi.ts#L181) |
| `x` | parameter | `PublicStudentQuestion` | createMockApi → (callback) → (callback) | [182](../test-client/src/mockApi.ts#L182) |
| `_id` | parameter | `string` | createMockApi → (callback) | [186](../test-client/src/mockApi.ts#L186) |
| `qid` | parameter | `string` | createMockApi → (callback) | [186](../test-client/src/mockApi.ts#L186) |
| `x` | parameter | `PublicStudentQuestion` | createMockApi → (callback) → (callback) | [189](../test-client/src/mockApi.ts#L189) |
| `x` | parameter | `PublicStudentQuestion` | createMockApi → (callback) → (callback) | [195](../test-client/src/mockApi.ts#L195) |
| `r` | variable | `PublicRun` | createMockApi → (callback) | [204](../test-client/src/mockApi.ts#L204) |
| `boss` | variable | `boolean \| undefined` | createMockApi → (callback) | [205](../test-client/src/mockApi.ts#L205) |
| `f` | variable | `{ turn: number; totalTurns: number; health: number; helpMeUsed: number; log: TurnResult[]; } \| { attempt: number; turn: number; totalTurns: number; hearts: number; maxHearts: nu...` | createMockApi → (callback) | [214](../test-client/src/mockApi.ts#L214) |
| `item` | variable | `{ q: PublicQuestion; key: Answer; text: string; }` | createMockApi → (callback) | [216](../test-client/src/mockApi.ts#L216) |
| `ev` | variable | `HelpMeTurn` | createMockApi → (callback) | [217](../test-client/src/mockApi.ts#L217) |
| `lose` | variable | `boolean` | createMockApi → (callback) | [226](../test-client/src/mockApi.ts#L226) |
| `s` | variable | `{ q: PublicQuestion; right: string; wrong: string; }` | createMockApi → (callback) | [227](../test-client/src/mockApi.ts#L227) |
| `d` | variable | `{ damage: number; hearts: number \| undefined; health: number \| undefined; phaseAfter: RunPhase; }` | createMockApi → (callback) | [228](../test-client/src/mockApi.ts#L228) |
| `res` | variable | `TurnResult` | createMockApi → (callback) | [229](../test-client/src/mockApi.ts#L229) |
| `_id` | parameter | `string` | createMockApi → (callback) | [240](../test-client/src/mockApi.ts#L240) |
| `eventId` | parameter | `string` | createMockApi → (callback) | [240](../test-client/src/mockApi.ts#L240) |
| `answer` | parameter | `Answer` | createMockApi → (callback) | [240](../test-client/src/mockApi.ts#L240) |
| `ev` | variable | `HelpMeTurn` | createMockApi → (callback) | [244](../test-client/src/mockApi.ts#L244) |
| `item` | variable | `{ q: PublicQuestion; key: Answer; text: string; }` | createMockApi → (callback) | [244](../test-client/src/mockApi.ts#L244) |
| `late` | variable | `boolean` | createMockApi → (callback) | [245](../test-client/src/mockApi.ts#L245) |
| `correct` | variable | `boolean` | createMockApi → (callback) | [246](../test-client/src/mockApi.ts#L246) |
| `d` | variable | `{ damage: number; hearts: number \| undefined; health: number \| undefined; phaseAfter: RunPhase; }` | createMockApi → (callback) | [248](../test-client/src/mockApi.ts#L248) |
| `res` | variable | `TurnResult` | createMockApi → (callback) | [249](../test-client/src/mockApi.ts#L249) |
| `h` | parameter | `{ q: PublicQuestion; key: Answer; text: string; }` | createMockApi → (callback) → (callback) | [286](../test-client/src/mockApi.ts#L286) |

## ui.ts

Page: Shared presentation helpers on every page.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `GAME_W` | variable | `1100` | module | [4](../test-client/src/ui.ts#L4) |
| `GAME_H` | variable | `720` | module | [5](../test-client/src/ui.ts#L5) |
| `EMOJI_FONT` | variable | `"system-ui, \"Apple Color Emoji\", \"Segoe UI Emoji\", sans-serif"` | module | [6](../test-client/src/ui.ts#L6) |
| `tag` | parameter | `K` | el | [11](../test-client/src/ui.ts#L11) |
| `cls` | parameter | `string` | el | [11](../test-client/src/ui.ts#L11) |
| `kids` | parameter | `Kid[]` | el | [11](../test-client/src/ui.ts#L11) |
| `e` | variable | `HTMLElementTagNameMap[K]` | el | [12](../test-client/src/ui.ts#L12) |
| `k` | variable | `Kid` | el | [14](../test-client/src/ui.ts#L14) |
| `label` | parameter | `string` | btn | [18](../test-client/src/ui.ts#L18) |
| `onClick` | parameter | `() => void` | btn | [18](../test-client/src/ui.ts#L18) |
| `cls` | parameter | `string` | btn | [18](../test-client/src/ui.ts#L18) |
| `b` | variable | `HTMLButtonElement` | btn | [19](../test-client/src/ui.ts#L19) |
| `md` | parameter | `string` | mdToEl | [26](../test-client/src/ui.ts#L26) |
| `root` | variable | `HTMLDivElement` | mdToEl | [27](../test-client/src/ui.ts#L27) |
| `list` | variable | `HTMLUListElement \| null` | mdToEl | [28](../test-client/src/ui.ts#L28) |
| `raw` | variable | `string` | mdToEl | [29](../test-client/src/ui.ts#L29) |
| `line` | variable | `string` | mdToEl | [30](../test-client/src/ui.ts#L30) |
| `h` | variable | `RegExpExecArray \| null` | mdToEl | [38](../test-client/src/ui.ts#L38) |
| `q` | parameter | `PublicQuestion` | questionEl | [46](../test-client/src/ui.ts#L46) |
| `box` | variable | `HTMLDivElement` | questionEl | [47](../test-client/src/ui.ts#L47) |
| `opts` | variable | `(items: string[]) => void` | questionEl | [48](../test-client/src/ui.ts#L48) |
| `items` | parameter | `string[]` | questionEl → opts | [48](../test-client/src/ui.ts#L48) |
| `o` | parameter | `string` | questionEl → opts → (callback) | [48](../test-client/src/ui.ts#L48) |
| `scene` | parameter | `Scene` | panel | [71](../test-client/src/ui.ts#L71) |
| `x` | parameter | `number` | panel | [71](../test-client/src/ui.ts#L71) |
| `y` | parameter | `number` | panel | [71](../test-client/src/ui.ts#L71) |
| `w` | parameter | `number` | panel | [71](../test-client/src/ui.ts#L71) |
| `h` | parameter | `number` | panel | [71](../test-client/src/ui.ts#L71) |
| `content` | parameter | `HTMLElement` | panel | [71](../test-client/src/ui.ts#L71) |
| `wrap` | variable | `HTMLDivElement` | panel | [74](../test-client/src/ui.ts#L74) |
| `scene` | parameter | `Scene` | title | [82](../test-client/src/ui.ts#L82) |
| `text` | parameter | `string` | title | [82](../test-client/src/ui.ts#L82) |

## scenes/BootScene.ts

Page: Boot/resume.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `runId` | variable | `string \| null` | BootScene → create | [10](../test-client/src/scenes/BootScene.ts#L10) |
| `run` | variable | `PublicRun \| undefined` | BootScene → create | [12](../test-client/src/scenes/BootScene.ts#L12) |

## scenes/UploadScene.ts

Page: Course picker, upload, ingest, run setup.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `STAGES` | variable | `string[]` | module | [6](../test-client/src/scenes/UploadScene.ts#L6) |
| `courseId` | field | `string \| null` | UploadScene | [9](../test-client/src/scenes/UploadScene.ts#L9) |
| `course` | field | `PublicCourse \| null` | UploadScene | [10](../test-client/src/scenes/UploadScene.ts#L10) |
| `chosen` | field | `Set<string>` | UploadScene | [11](../test-client/src/scenes/UploadScene.ts#L11) |
| `known` | field | `Set<string>` | UploadScene | [12](../test-client/src/scenes/UploadScene.ts#L12) |
| `grade` | field | `TargetGrade` | UploadScene | [13](../test-client/src/scenes/UploadScene.ts#L13) |
| `emoji` | field | `"🤖" \| "🐙" \| "🦉" \| "🐸" \| "👾"` | UploadScene | [14](../test-client/src/scenes/UploadScene.ts#L14) |
| `timer` | field | `number` | UploadScene | [15](../test-client/src/scenes/UploadScene.ts#L15) |
| `polling` | field | `boolean` | UploadScene | [16](../test-client/src/scenes/UploadScene.ts#L16) |
| `sourceEl` | field | `HTMLElement` | UploadScene | [17](../test-client/src/scenes/UploadScene.ts#L17) |
| `courseEl` | field | `HTMLElement` | UploadScene | [18](../test-client/src/scenes/UploadScene.ts#L18) |
| `progressEl` | field | `HTMLElement` | UploadScene | [19](../test-client/src/scenes/UploadScene.ts#L19) |
| `roomsEl` | field | `HTMLElement` | UploadScene | [20](../test-client/src/scenes/UploadScene.ts#L20) |
| `startBtn` | field | `HTMLButtonElement` | UploadScene | [21](../test-client/src/scenes/UploadScene.ts#L21) |
| `hintEl` | field | `HTMLElement` | UploadScene | [22](../test-client/src/scenes/UploadScene.ts#L22) |
| `root` | variable | `HTMLDivElement` | UploadScene → create | [41](../test-client/src/scenes/UploadScene.ts#L41) |
| `setup` | variable | `HTMLAnchorElement` | UploadScene → create | [42](../test-client/src/scenes/UploadScene.ts#L42) |
| `samples` | variable | `HTMLDivElement` | UploadScene → buildSource | [56](../test-client/src/scenes/UploadScene.ts#L56) |
| `res` | parameter | `{ samples: { id: string; title: string; }[]; } \| undefined` | UploadScene → buildSource → (callback) | [57](../test-client/src/scenes/UploadScene.ts#L57) |
| `s` | variable | `{ id: string; title: string; }` | UploadScene → buildSource → (callback) | [60](../test-client/src/scenes/UploadScene.ts#L60) |
| `files` | variable | `HTMLInputElement` | UploadScene → buildSource | [66](../test-client/src/scenes/UploadScene.ts#L66) |
| `fileTitle` | variable | `HTMLInputElement` | UploadScene → buildSource | [70](../test-client/src/scenes/UploadScene.ts#L70) |
| `upload` | variable | `HTMLButtonElement` | UploadScene → buildSource | [73](../test-client/src/scenes/UploadScene.ts#L73) |
| `list` | variable | `File[]` | UploadScene → buildSource → (callback) | [74](../test-client/src/scenes/UploadScene.ts#L74) |
| `f` | parameter | `File` | UploadScene → buildSource → (callback) → (callback) → (callback) | [76](../test-client/src/scenes/UploadScene.ts#L76) |
| `text` | variable | `HTMLTextAreaElement` | UploadScene → buildSource | [79](../test-client/src/scenes/UploadScene.ts#L79) |
| `textTitle` | variable | `HTMLInputElement` | UploadScene → buildSource | [82](../test-client/src/scenes/UploadScene.ts#L82) |
| `create` | variable | `HTMLButtonElement` | UploadScene → buildSource | [85](../test-client/src/scenes/UploadScene.ts#L85) |
| `res` | parameter | `{ courseId: string; } \| undefined` | UploadScene → begin | [101](../test-client/src/scenes/UploadScene.ts#L101) |
| `grade` | variable | `HTMLSelectElement` | UploadScene → buildCourse | [113](../test-client/src/scenes/UploadScene.ts#L113) |
| `g` | variable | `TargetGrade` | UploadScene → buildCourse | [114](../test-client/src/scenes/UploadScene.ts#L114) |
| `emojis` | variable | `HTMLDivElement` | UploadScene → buildCourse | [117](../test-client/src/scenes/UploadScene.ts#L117) |
| `drawEmojis` | variable | `() => void` | UploadScene → buildCourse | [118](../test-client/src/scenes/UploadScene.ts#L118) |
| `e` | parameter | `"🤖" \| "🐙" \| "🦉" \| "🐸" \| "👾"` | UploadScene → buildCourse → drawEmojis → (callback) | [120](../test-client/src/scenes/UploadScene.ts#L120) |
| `setup` | variable | `HTMLDivElement` | UploadScene → buildCourse | [130](../test-client/src/scenes/UploadScene.ts#L130) |
| `r` | variable | `{ id: string; title: string; description?: string \| undefined; learningObjectives?: string[] \| undefined; conceptIds: string[]; ready: boolean; }` | UploadScene → poll | [148](../test-client/src/scenes/UploadScene.ts#L148) |
| `stage` | variable | `IngestStage` | UploadScene → poll | [156](../test-client/src/scenes/UploadScene.ts#L156) |
| `err` | variable | `unknown` | UploadScene → poll | [158](../test-client/src/scenes/UploadScene.ts#L158) |
| `c` | variable | `PublicCourse \| null` | UploadScene → renderProgress | [166](../test-client/src/scenes/UploadScene.ts#L166) |
| `mark` | variable | `(ok: boolean) => "✅" \| "⏳"` | UploadScene → renderProgress | [168](../test-client/src/scenes/UploadScene.ts#L168) |
| `ok` | parameter | `boolean` | UploadScene → renderProgress → mark | [168](../test-client/src/scenes/UploadScene.ts#L168) |
| `stage` | variable | `IngestStage` | UploadScene → renderProgress | [169](../test-client/src/scenes/UploadScene.ts#L169) |
| `stageLine` | variable | `HTMLDivElement` | UploadScene → renderProgress | [170](../test-client/src/scenes/UploadScene.ts#L170) |
| `s` | variable | `string` | UploadScene → renderProgress | [171](../test-client/src/scenes/UploadScene.ts#L171) |
| `u` | variable | `{ id: string; title: string; concepts: { id: string; title: string; summary?: string \| undefined; ready: boolean; }[]; }` | UploadScene → renderProgress | [175](../test-client/src/scenes/UploadScene.ts#L175) |
| `k` | variable | `{ id: string; title: string; summary?: string \| undefined; ready: boolean; }` | UploadScene → renderProgress | [177](../test-client/src/scenes/UploadScene.ts#L177) |
| `r` | variable | `{ id: string; title: string; description?: string \| undefined; learningObjectives?: string[] \| undefined; conceptIds: string[]; ready: boolean; }` | UploadScene → renderProgress | [180](../test-client/src/scenes/UploadScene.ts#L180) |
| `c` | variable | `PublicCourse \| null` | UploadScene → renderRooms | [184](../test-client/src/scenes/UploadScene.ts#L184) |
| `r` | variable | `{ id: string; title: string; description?: string \| undefined; learningObjectives?: string[] \| undefined; conceptIds: string[]; ready: boolean; }` | UploadScene → renderRooms | [187](../test-client/src/scenes/UploadScene.ts#L187) |
| `cb` | variable | `HTMLInputElement` | UploadScene → renderRooms | [188](../test-client/src/scenes/UploadScene.ts#L188) |
| `label` | variable | `HTMLLabelElement` | UploadScene → renderRooms | [196](../test-client/src/scenes/UploadScene.ts#L196) |
| `first` | variable | `{ id: string; title: string; description?: string \| undefined; learningObjectives?: string[] \| undefined; conceptIds: string[]; ready: boolean; } \| undefined` | UploadScene → renderRooms | [199](../test-client/src/scenes/UploadScene.ts#L199) |
| `r` | parameter | `{ id: string; title: string; description?: string \| undefined; learningObjectives?: string[] \| undefined; conceptIds: string[]; ready: boolean; }` | UploadScene → renderRooms → (callback) | [199](../test-client/src/scenes/UploadScene.ts#L199) |
| `roomIds` | variable | `string[]` | UploadScene → start | [210](../test-client/src/scenes/UploadScene.ts#L210) |
| `r` | parameter | `{ id: string; title: string; description?: string \| undefined; learningObjectives?: string[] \| undefined; conceptIds: string[]; ready: boolean; }` | UploadScene → start → (callback) | [210](../test-client/src/scenes/UploadScene.ts#L210) |
| `r` | parameter | `{ id: string; title: string; description?: string \| undefined; learningObjectives?: string[] \| undefined; conceptIds: string[]; ready: boolean; }` | UploadScene → start → (callback) | [210](../test-client/src/scenes/UploadScene.ts#L210) |
| `run` | variable | `PublicRun \| undefined` | UploadScene → start | [211](../test-client/src/scenes/UploadScene.ts#L211) |

## scenes/LearningScene.ts

Page: Learning/notebook.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `notebookEl` | field | `HTMLElement` | LearningScene | [12](../test-client/src/scenes/LearningScene.ts#L12) |
| `questionsEl` | field | `HTMLElement` | LearningScene | [13](../test-client/src/scenes/LearningScene.ts#L13) |
| `teachInfo` | field | `HTMLElement` | LearningScene | [14](../test-client/src/scenes/LearningScene.ts#L14) |
| `blocks` | field | `Map<string, QBlock>` | LearningScene | [15](../test-client/src/scenes/LearningScene.ts#L15) |
| `run` | variable | `PublicRun \| null` | LearningScene → create | [22](../test-client/src/scenes/LearningScene.ts#L22) |
| `room` | variable | `PublicRunRoom \| null` | LearningScene → create | [24](../test-client/src/scenes/LearningScene.ts#L24) |
| `explain` | variable | `HTMLTextAreaElement` | LearningScene → create | [32](../test-client/src/scenes/LearningScene.ts#L32) |
| `teach` | variable | `HTMLButtonElement` | LearningScene → create | [35](../test-client/src/scenes/LearningScene.ts#L35) |
| `res` | variable | `TeachResponse \| undefined` | LearningScene → create → (callback) | [37](../test-client/src/scenes/LearningScene.ts#L37) |
| `ready` | variable | `HTMLButtonElement` | LearningScene → create | [44](../test-client/src/scenes/LearningScene.ts#L44) |
| `next` | variable | `PublicRun \| undefined` | LearningScene → create → (callback) | [45](../test-client/src/scenes/LearningScene.ts#L45) |
| `concepts` | variable | `HTMLUListElement` | LearningScene → create | [51](../test-client/src/scenes/LearningScene.ts#L51) |
| `c` | parameter | `{ id: string; title: string; summary?: string \| undefined; }` | LearningScene → create → (callback) | [51](../test-client/src/scenes/LearningScene.ts#L51) |
| `left` | variable | `HTMLDivElement` | LearningScene → create | [52](../test-client/src/scenes/LearningScene.ts#L52) |
| `right` | variable | `HTMLDivElement` | LearningScene → create | [59](../test-client/src/scenes/LearningScene.ts#L59) |
| `md` | parameter | `string` | LearningScene → setNotebook | [67](../test-client/src/scenes/LearningScene.ts#L67) |
| `list` | parameter | `PublicStudentQuestion[]` | LearningScene → syncQuestions | [73](../test-client/src/scenes/LearningScene.ts#L73) |
| `q` | variable | `PublicStudentQuestion` | LearningScene → syncQuestions | [74](../test-client/src/scenes/LearningScene.ts#L74) |
| `known` | variable | `QBlock \| undefined` | LearningScene → syncQuestions | [75](../test-client/src/scenes/LearningScene.ts#L75) |
| `status` | variable | `HTMLDivElement` | LearningScene → syncQuestions | [80](../test-client/src/scenes/LearningScene.ts#L80) |
| `controls` | variable | `HTMLDivElement` | LearningScene → syncQuestions | [81](../test-client/src/scenes/LearningScene.ts#L81) |
| `input` | variable | `HTMLTextAreaElement` | LearningScene → syncQuestions | [82](../test-client/src/scenes/LearningScene.ts#L82) |
| `res` | variable | `{ resolved: boolean; notebookMd: string; } \| undefined` | LearningScene → syncQuestions → (callback) | [89](../test-client/src/scenes/LearningScene.ts#L89) |
| `res` | variable | `{ notebookMd: string; } \| undefined` | LearningScene → syncQuestions → (callback) | [96](../test-client/src/scenes/LearningScene.ts#L96) |
| `id` | parameter | `string` | LearningScene → setStatus | [108](../test-client/src/scenes/LearningScene.ts#L108) |
| `st` | parameter | `"open" \| "answered" \| "skipped"` | LearningScene → setStatus | [108](../test-client/src/scenes/LearningScene.ts#L108) |
| `resolved` | parameter | `boolean \| undefined` | LearningScene → setStatus | [108](../test-client/src/scenes/LearningScene.ts#L108) |
| `b` | variable | `QBlock \| undefined` | LearningScene → setStatus | [109](../test-client/src/scenes/LearningScene.ts#L109) |

## scenes/FightScene.ts

Page: Fight (state inherited from BattleScene).

No local variable/field/parameter declarations; see the base class.

## scenes/BossScene.ts

Page: Boss (state inherited from BattleScene).

No local variable/field/parameter declarations; see the base class.

## scenes/ResultsScene.ts

Page: Results/study guide.

| Name | Kind | Type | Scope | Line |
|---|---|---|---|---|
| `run` | variable | `PublicRun \| null` | ResultsScene → create | [12](../test-client/src/scenes/ResultsScene.ts#L12) |
| `results` | variable | `Results \| null \| undefined` | ResultsScene → create | [15](../test-client/src/scenes/ResultsScene.ts#L15) |
| `r` | parameter | `Results` | ResultsScene → render | [22](../test-client/src/scenes/ResultsScene.ts#L22) |
| `root` | variable | `HTMLDivElement` | ResultsScene → render | [23](../test-client/src/scenes/ResultsScene.ts#L23) |
| `c` | variable | `{ conceptId: string; title: string; correct: number; total: number; accuracy: number; }` | ResultsScene → render | [29](../test-client/src/scenes/ResultsScene.ts#L29) |
| `bar` | variable | `HTMLSpanElement` | ResultsScene → render | [30](../test-client/src/scenes/ResultsScene.ts#L30) |
| `h` | variable | `{ offered: number; correct: number; wrong: number; late: number; avgSolveTimeSec: number \| null; }` | ResultsScene → render | [34](../test-client/src/scenes/ResultsScene.ts#L34) |
| `m` | variable | `CostlyMisconception` | ResultsScene → render | [41](../test-client/src/scenes/ResultsScene.ts#L41) |
| `ref` | variable | `MaterialRef` | ResultsScene → render | [42](../test-client/src/scenes/ResultsScene.ts#L42) |

Total: 379 declarations.
