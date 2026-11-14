import Phaser from 'phaser';
import { state } from './app';
import { installDebug } from './debug';
import { GAME_H, GAME_W } from './ui';
import { BootScene } from './scenes/BootScene';
import { UploadScene } from './scenes/UploadScene';
import { LearningScene } from './scenes/LearningScene';
import { FightScene } from './scenes/FightScene';
import { BossScene } from './scenes/BossScene';
import { ResultsScene } from './scenes/ResultsScene';

state.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#10162a',
  dom: { createContainer: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, UploadScene, LearningScene, FightScene, BossScene, ResultsScene],
});
installDebug();

// A handle for poking at the harness from the browser console: `__top.state.run`, `__top.game`.
(window as unknown as { __top: unknown }).__top = { game: state.game, state };
