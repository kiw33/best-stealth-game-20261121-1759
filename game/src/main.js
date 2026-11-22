// Emberlight — boot and the one loop: input is read every frame, the world
// advances in fixed 1/60 s steps (several in a slow frame, none in a fast
// one), and the renderer paints what is there. The game moves between five
// screens: title, play, paused, caught and win.
//
// ?seed=N fixes the level's cosmetic details. ?shot=title|patrol|hide|
// spotted|win (with &seed=N) stages that scene instead of running the loop,
// paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_CAUGHT, EVENT_DENIED, EVENT_GUARD_STEP, EVENT_LEVEL_CLEAR, EVENT_NOISE, EVENT_PICKUP, EVENT_SPOTTED, EVENT_STEP, EVENT_SUSPICIOUS, EVENT_WIN } from './world.js';
import { ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_CAUGHT, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
/** How close a click-to-move order must get before it is done (pixels). */
const CLICK_ARRIVE = 10;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  window.__emberlight = { world, screen: () => scene.screen };
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, { best: scene.best, world, moveTarget: null });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  window.__emberlight = { world, screen: () => screen };
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let moveTarget = null;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each pickup.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    moveTarget = null;
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    announce('Playing. Steal every ember shard, then reach the moon gate unseen.');
  }

  function endGame(won) {
    screen = won ? SCREEN_WIN : SCREEN_CAUGHT;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    if (won) audio.win();
    else audio.caught();
    announce(won
      ? `You stole every shard. Final score ${world.state.score}.`
      : `Caught by the wardens. Score ${world.state.score}.`);
  }

  function handleEvents(events) {
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_SUSPICIOUS) audio.suspicious();
    if (events & EVENT_SPOTTED) audio.alarm();
    if (events & EVENT_DENIED) audio.denied();
    if (events & EVENT_STEP) audio.footstep(world.state.player.sneaking, 0);
    if (events & EVENT_GUARD_STEP) audio.guardStep(world.state.nearestGuardStep);
    if (events & EVENT_LEVEL_CLEAR) {
      audio.levelClear();
      moveTarget = null;
      announce(`Level clear. ${world.state.levelName}.`);
    }
    if (events & EVENT_NOISE) announce('Your sprinting echoes — a warden heard it.');
    if (events & EVENT_WIN) endGame(true);
    else if (events & EVENT_CAUGHT) endGame(false);
  }

  function handleActions() {
    const actions = input.takeActions();
    const click = input.takeClick();
    if (click) {
      audio.unlock();
      if (screen === SCREEN_PLAY) {
        moveTarget = renderer.toWorld(click.x, click.y);
      } else if (screen === SCREEN_TITLE || screen === SCREEN_CAUGHT || screen === SCREEN_WIN) {
        startGame();
        return;
      }
    }
    if (actions & ACTION_CONFIRM && (screen === SCREEN_TITLE || screen === SCREEN_CAUGHT || screen === SCREEN_WIN)) {
      startGame();
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function moveFromInput() {
    const keys = input.direction();
    if (keys.x !== 0 || keys.y !== 0) {
      moveTarget = null;
      return keys;
    }
    if (moveTarget) {
      const dx = moveTarget.x - world.state.player.x;
      const dy = moveTarget.y - world.state.player.y;
      if (Math.hypot(dx, dy) < CLICK_ARRIVE) {
        moveTarget = null;
        return { x: 0, y: 0 };
      }
      const len = Math.hypot(dx, dy);
      return { x: dx / len, y: dy / len };
    }
    return { x: 0, y: 0 };
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      // The title screen's backdrop: wardens patrol, nothing can be seen.
      world.step(STEP, { x: 0, y: 0 }, false, false, true);
      return;
    }
    const events = world.step(STEP, moveFromInput(), input.sneak(), input.sprint(), false);
    handleEvents(events);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, { best, world, moveTarget });
  }

  // Leaving the tab pauses a running game rather than letting wardens close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Emberlight. Press Space or click to begin.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
