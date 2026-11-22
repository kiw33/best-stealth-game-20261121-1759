// Emberlight — the screenshot scenes behind ?shot=title|patrol|hide|spotted|win.
// Each one plays the real rules forward from a fresh world, steered by an
// autopilot that pathfinds to the next shard (or the gate) on the tile grid,
// avoids the wardens' cones where it can, and sneaks where it cannot — so a
// frame is what a short game really looks like, and the same seed always
// gives the same frame.
import { COLS, CONE_HALF_ANGLE, CONE_RANGE, MAP_X, MAP_Y, ROWS, STEP, TILE } from './config.js';
import { EVENT_CAUGHT, EVENT_WIN } from './world.js';
import { SCREEN_CAUGHT, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';

const SAMPLE = STEP;
const TITLE_SECONDS = 6;
const PATROL_SECONDS = 22;
const HIDE_WAIT_SECONDS = 14;
const WIN_LIMIT_SECONDS = 300;
const REPATH_SECONDS = 1.0;

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Would any warden see a player standing at this point right now? */
function pointSeen(world, x, y) {
  const state = world.state;
  for (const guard of state.guards) {
    const dx = x - guard.x;
    const dy = y - guard.y;
    if (Math.hypot(dx, dy) > CONE_RANGE) continue;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), guard.angle)) > CONE_HALF_ANGLE) continue;
    if (world.lineOfSight(guard.x, guard.y, x, y)) return true;
  }
  return false;
}

function tileOfWorld(world, x, y) {
  return [Math.floor((x - MAP_X) / TILE), Math.floor((y - MAP_Y) / TILE)];
}

function tileCenterWorld(col, row) {
  return { x: MAP_X + col * TILE + TILE / 2, y: MAP_Y + row * TILE + TILE / 2 };
}

/** The moonbush farthest from the chasing warden that it cannot see into:
 * a hiding spot the chase cannot follow the player to. */
function fleeGoal(world) {
  const state = world.state;
  const chaser = state.guards.find((g) => g.mode === 'chase')
    ?? state.guards.reduce((a, b) => (a.alert > b.alert ? a : b));
  let best = null;
  let bestDist = -1;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (state.map[row][col] !== ',') continue;
      const centre = tileCenterWorld(col, row);
      if (world.lineOfSight(chaser.x, chaser.y, centre.x, centre.y)) continue;
      const dist = Math.hypot(centre.x - chaser.x, centre.y - chaser.y);
      if (dist > bestDist) {
        bestDist = dist;
        best = centre;
      }
    }
  }
  return best ?? startTile(state);
}

/** Breadth-first path over walkable tiles (the shortest route, cones ignored:
 * the pilot times its crossings instead, so the route never flickers). */
function autopilotPath(world, fromX, fromY, toX, toY) {
  const [sc, sr] = tileOfWorld(world, fromX, fromY);
  const [tc, tr] = tileOfWorld(world, toX, toY);
  if (sc === tc && sr === tr) return [{ x: toX, y: toY }];
  const key = (c, r) => r * COLS + c;
  const prev = new Map();
  const queue = [[sc, sr]];
  prev.set(key(sc, sr), null);
  while (queue.length > 0) {
    const [c, r] = queue.shift();
    if (c === tc && r === tr) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      if (world.isSolid(nc, nr) || prev.has(key(nc, nr))) continue;
      prev.set(key(nc, nr), [c, r]);
      queue.push([nc, nr]);
    }
  }
  if (!prev.has(key(tc, tr))) return null;
  const tiles = [];
  let cur = [tc, tr];
  while (cur) {
    tiles.unshift(cur);
    cur = prev.get(key(cur[0], cur[1]));
  }
  return tiles.map(([c, r]) => tileCenterWorld(c, r));
}

function nearestShard(state) {
  let best = null;
  let bestDist = Infinity;
  for (const shard of state.shards) {
    if (shard.taken) continue;
    const d = Math.hypot(shard.x - state.player.x, shard.y - state.player.y);
    if (d < bestDist) {
      bestDist = d;
      best = shard;
    }
  }
  return best;
}

function startTile(state) {
  for (let row = 0; row < 13; row += 1) {
    for (let col = 0; col < 24; col += 1) {
      if (state.map[row][col] === 'P') return tileCenterWorld(col, row);
    }
  }
  return { x: state.player.x, y: state.player.y };
}

function nearestBush(state) {
  let best = null;
  let bestDist = Infinity;
  for (let row = 0; row < 13; row += 1) {
    for (let col = 0; col < 24; col += 1) {
      if (state.map[row][col] !== ',') continue;
      const centre = tileCenterWorld(col, row);
      const d = Math.hypot(centre.x - state.player.x, centre.y - state.player.y);
      if (d < bestDist) {
        bestDist = d;
        best = centre;
      }
    }
  }
  return best;
}

/** Steer one step toward `target` along the shortest route. When chased it
 * sprints for a moonbush the warden cannot see into and waits there, hidden,
 * until the wardens give up; when the way ahead is under a cone it waits for
 * the cone to sweep past, and only sneaks through after waiting too long.
 * The route is recomputed at most once a second and keyed by its goal, so it
 * never flickers between two equal routes. */
function pilotStep(world, target, repath, reckless) {
  const state = world.state;
  const player = state.player;
  const chased = state.guards.some((g) => g.mode === 'chase');
  const threatened = state.guards.some((g) => g.alert > 0.6);
  const goal = chased || threatened ? fleeGoal(world) : target;
  const goalKey = `${goal.x},${goal.y}`;
  if (repath.t <= 0 || repath.goalKey !== goalKey) {
    repath.t = REPATH_SECONDS;
    repath.goalKey = goalKey;
    repath.path = autopilotPath(world, player.x, player.y, goal.x, goal.y) ?? [];
    repath.index = 0;
  }
  repath.t -= SAMPLE;
  while (repath.index < repath.path.length) {
    const wp = repath.path[repath.index];
    if (Math.hypot(wp.x - player.x, wp.y - player.y) < 12) repath.index += 1;
    else break;
  }
  if (repath.index >= repath.path.length) return { x: 0, y: 0, sneak: true, sprint: false };
  const wp = repath.path[repath.index];
  const dx = wp.x - player.x;
  const dy = wp.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  const nextSeen = pointSeen(world, wp.x, wp.y);
  const nervous = state.guards.some((g) => g.alert > 0.25) || nextSeen;
  if (nextSeen && !reckless && !chased && !pointSeen(world, player.x, player.y)) {
    // Wait for the cone to sweep past — but never wait while standing in one:
    // a warden closing in on a waiting thief catches them. Give up waiting
    // after a while and sneak through instead.
    repath.waitT = (repath.waitT ?? 0) + SAMPLE;
    if (repath.waitT < 6) return { x: 0, y: 0, sneak: true, sprint: false };
  } else {
    repath.waitT = 0;
  }
  return { x: dx / len, y: dy / len, sneak: nervous && !chased, sprint: chased || (reckless && !chased) };
}

/** Stand the player in a guard's cone, on open floor with a clear sight line. */
function placeInCone(world, guard) {
  for (const dist of [130, 100, 160, 90, 180]) {
    const x = guard.x + Math.cos(guard.angle) * dist;
    const y = guard.y + Math.sin(guard.angle) * dist;
    const [col, row] = tileOfWorld(world, x, y);
    if (world.isSolid(col, row)) continue;
    if (!world.lineOfSight(guard.x, guard.y, x, y)) continue;
    world.state.player.x = x;
    world.state.player.y = y;
    return true;
  }
  return false;
}

function playCarefully(world, seconds) {
  const repath = { t: 0, goal: null, path: [], index: 0 };
  return runSteps(world, seconds, () => pilotStep(world, pickTarget(world, repath), repath, false));
}

function runSteps(world, seconds, drive) {
  let events = 0;
  for (let i = 0; i < seconds / SAMPLE; i += 1) {
    const input = drive(i);
    events |= world.step(SAMPLE, { x: input.x, y: input.y }, input.sneak, input.sprint, false);
    if (events & EVENT_CAUGHT) return { events, caught: true };
    if (events & EVENT_WIN) return { events, won: true };
  }
  return { events, caught: false, won: false };
}

/** The pilot's goal, kept sticky: the nearest shard is re-picked only once
 * the one it chases is taken (or the level changes), so two shards at nearly
 * the same distance can never flip the goal back and forth each step. */
function pickTarget(world, repath) {
  const state = world.state;
  if (repath.target && repath.targetLevel === state.levelIndex) {
    if (repath.target.kind === 'exit') {
      if (state.exit.open) return state.exit;
    } else {
      const shard = state.shards[repath.target.index];
      if (shard && !shard.taken) return shard;
    }
  }
  const target = state.exit.open ? state.exit : nearestShard(state) ?? state.exit;
  const index = state.shards.indexOf(target);
  repath.target = { kind: index >= 0 ? 'shard' : 'exit', index };
  repath.targetLevel = state.levelIndex;
  return target;
}

export { pilotStep, nearestShard, pointSeen, pickTarget };

/**
 * Set `world` to the named scene and return the screen to draw over it.
 * Scenes: title, patrol, hide, spotted, win (any other name is title).
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'patrol' && name !== 'hide' && name !== 'spotted' && name !== 'win') {
    for (let i = 0; i < TITLE_SECONDS / SAMPLE; i += 1) world.step(SAMPLE, { x: 0, y: 0 }, false, false, true);
    return { screen: SCREEN_TITLE, best: 0 };
  }

  if (name === 'patrol') {
    const repath = { t: 0, goal: null, path: [], index: 0 };
    runSteps(world, PATROL_SECONDS, () => pilotStep(world, pickTarget(world, repath), repath, false));
    return { screen: SCREEN_PLAY, best: 0 };
  }

  if (name === 'hide') {
    const repath = { t: 0, goal: null, path: [], index: 0 };
    const bush = nearestBush(world.state);
    runSteps(world, 20, () => pilotStep(world, bush, repath, false));
    // Wait in the bush until a warden's cone sweeps close by.
    for (let i = 0; i < HIDE_WAIT_SECONDS / SAMPLE; i += 1) {
      world.step(SAMPLE, { x: 0, y: 0 }, true, false, false);
      const near = world.state.guards.some((g) => {
        const d = Math.hypot(g.x - world.state.player.x, g.y - world.state.player.y);
        return d < CONE_RANGE * 0.8;
      });
      if (world.state.player.hidden && near) break;
    }
    return { screen: SCREEN_PLAY, best: 0 };
  }

  if (name === 'spotted') {
    // Play carefully for a while to reach a natural mid-game state, then stalk
    // the nearest warden: stand in its cone until it spots Wren, and freeze
    // the frame as the chase closes in — red cone, "!" overhead, alarm up.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) world.reset();
      const intro = playCarefully(world, 8);
      if (intro.caught) continue;
      const guard = world.state.guards.reduce((a, b) => {
        const da = Math.hypot(a.x - world.state.player.x, a.y - world.state.player.y);
        const db = Math.hypot(b.x - world.state.player.x, b.y - world.state.player.y);
        return da < db ? a : b;
      });
      let caught = false;
      for (let i = 0; i < 8 / SAMPLE && !caught; i += 1) {
        if (!placeInCone(world, guard)) break;
        const events = world.step(SAMPLE, { x: 0, y: 0 }, false, false, false);
        if (events & EVENT_CAUGHT) {
          caught = true;
          break;
        }
        if (world.state.guards.some((g) => g.mode === 'chase')) {
          for (let j = 0; j < 18; j += 1) world.step(SAMPLE, { x: 0, y: 0 }, false, false, false);
          return { screen: SCREEN_PLAY, best: 0 };
        }
      }
      if (world.state.guards.some((g) => g.mode === 'chase')) return { screen: SCREEN_PLAY, best: 0 };
    }
    return { screen: SCREEN_PLAY, best: 0 };
  }

  // win: play all three levels for real; retry from the top if caught.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const repath = { t: 0, goal: null, path: [], index: 0 };
    const result = runSteps(world, WIN_LIMIT_SECONDS, () => pilotStep(world, pickTarget(world, repath), repath, false));
    if (result.won) return { screen: SCREEN_WIN, best: 0 };
    if (!result.caught) break;
    world.reset();
  }
  return { screen: SCREEN_CAUGHT, best: 0 };
}
