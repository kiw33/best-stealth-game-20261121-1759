// Emberlight — the game's rules and state, with no drawing and no browser in
// it: the tile map, the player, the Lantern Wardens and their sight, the
// ember shards and the moon gate. step() advances one fixed step and returns
// what happened as bit flags, so the caller can react (sound, screens)
// without the world knowing about screens or sound.
import {
  ALERT_DECAY,
  ALERT_FILL_BASE,
  BUSH_HIDE_RANGE,
  CATCH_RANGE,
  CHASE_LOSE_SIGHT_SECONDS,
  COLS,
  CONE_HALF_ANGLE,
  CONE_RANGE,
  GUARD_CHASE_SPEED,
  GUARD_INVESTIGATE_SPEED,
  GUARD_PATROL_SPEED,
  INVESTIGATE_WAIT_SECONDS,
  LEVEL_TIME_BONUS,
  MAP_X,
  MAP_Y,
  NOISE_SPRINT_RADIUS,
  NOISE_WALK_RADIUS,
  PLAYER_RADIUS,
  GUARD_RADIUS,
  ROWS,
  SHARD_SCORE,
  SNEAK_SPEED,
  SPRINT_SPEED,
  STEP,
  SUSPICIOUS_AT,
  TILE,
  UNSEEN_BONUS,
  WALK_SPEED,
} from './config.js';
import { LEVELS } from './levels.js';

export const EVENT_PICKUP = 1;
export const EVENT_SUSPICIOUS = 2;
export const EVENT_SPOTTED = 4;
export const EVENT_CAUGHT = 8;
export const EVENT_LEVEL_CLEAR = 16;
export const EVENT_WIN = 32;
export const EVENT_STEP = 64;
export const EVENT_GUARD_STEP = 128;
export const EVENT_DENIED = 256;
export const EVENT_NOISE = 512;

const GUARD_PATROL = 'patrol';
const GUARD_SUSPICIOUS = 'suspicious';
const GUARD_CHASE = 'chase';
const GUARD_INVESTIGATE = 'investigate';

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function angleLerp(a, b, t) {
  return a + angleDiff(b, a) * t;
}

export function createWorld(random) {
  const state = {
    levelIndex: 0,
    levelName: '',
    map: [],
    player: { x: 0, y: 0, angle: 0, moving: false, sneaking: false, sprinting: false, hidden: false, stepTimer: 0 },
    guards: [],
    shards: [],
    exit: { x: 0, y: 0, open: false },
    time: 0,
    levelTime: 0,
    score: 0,
    levelScore: 0,
    shardsTaken: 0,
    shardsTotal: 0,
    detections: 0,
    levelDetections: 0,
    alarm: false,
    message: '',
    messageT: 0,
    deniedT: 0,
    noisePulse: 0,
    nearestGuardStep: 9999,
    floorShade: [],
  };

  function tileAt(col, row) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return '#';
    return state.map[row][col];
  }

  function isSolid(col, row) {
    const tile = tileAt(col, row);
    return tile === '#' || tile === 'o';
  }

  function isBush(col, row) {
    return tileAt(col, row) === ',';
  }

  function tileOf(x, y) {
    return [Math.floor((x - MAP_X) / TILE), Math.floor((y - MAP_Y) / TILE)];
  }

  function tileCenter(col, row) {
    return { x: MAP_X + col * TILE + TILE / 2, y: MAP_Y + row * TILE + TILE / 2 };
  }

  /** True when no wall or crate stands between the two points. */
  function lineOfSight(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 5));
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const [col, row] = tileOf(x0 + dx * t, y0 + dy * t);
      if (isSolid(col, row)) return false;
    }
    return true;
  }

  /** Distance from (x, y) along `angle` until a solid tile, at most maxDist. */
  function raycast(x, y, angle, maxDist) {
    const step = 5;
    for (let d = step; d <= maxDist; d += step) {
      const [col, row] = tileOf(x + Math.cos(angle) * d, y + Math.sin(angle) * d);
      if (isSolid(col, row)) return d - step / 2;
    }
    return maxDist;
  }

  /** Breadth-first path over walkable tiles; returns pixel waypoints. */
  function findPath(fromX, fromY, toX, toY) {
    const [sc, sr] = tileOf(fromX, fromY);
    const [tc, tr] = tileOf(toX, toY);
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
        if (isSolid(nc, nr) || prev.has(key(nc, nr))) continue;
        prev.set(key(nc, nr), [c, r]);
        queue.push([nc, nr]);
      }
    }
    if (!prev.has(key(tc, tr))) return [];
    const tiles = [];
    let cur = [tc, tr];
    while (cur) {
      tiles.unshift(cur);
      cur = prev.get(key(cur[0], cur[1]));
    }
    return tiles.map(([c, r]) => tileCenter(c, r));
  }

  function loadLevel(index) {
    const level = LEVELS[index];
    state.levelIndex = index;
    state.levelName = level.name;
    state.map = level.map.map((row) => row.split(''));
    state.shards = [];
    state.guards = [];
    state.levelTime = 0;
    state.levelDetections = 0;
    state.levelScore = 0;
    state.alarm = false;
    state.message = '';
    state.messageT = 0;
    state.floorShade = [];
    for (let row = 0; row < ROWS; row += 1) {
      state.floorShade.push([]);
      for (let col = 0; col < COLS; col += 1) {
        state.floorShade[row].push(random.range(-6, 6));
      }
    }
    level.map.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const centre = tileCenter(x, y);
        if (ch === 'P') {
          state.player.x = centre.x;
          state.player.y = centre.y;
          state.player.angle = 0;
        } else if (ch === '*') {
          state.shards.push({ x: centre.x, y: centre.y, taken: false, phase: random.range(0, Math.PI * 2) });
        } else if (ch === 'E') {
          state.exit.x = centre.x;
          state.exit.y = centre.y;
        }
      });
    });
    state.shardsTotal = state.shards.length;
    state.shardsTaken = 0;
    state.exit.open = false;
    level.guards.forEach((def) => {
      const spawn = tileCenter(def.spawn[0], def.spawn[1]);
      const first = tileCenter(def.waypoints[0][0], def.waypoints[0][1]);
      const second = tileCenter(def.waypoints[1][0], def.waypoints[1][1]);
      state.guards.push({
        x: spawn.x,
        y: spawn.y,
        angle: Math.atan2(second.y - first.y, second.x - first.x),
        mode: GUARD_PATROL,
        alert: 0,
        waypoints: def.waypoints.map(([c, r]) => tileCenter(c, r)),
        wpIndex: 1,
        pauseT: 0,
        pauseDuration: def.pause,
        scanPhase: random.range(0, Math.PI * 2),
        path: [],
        repathT: 0,
        lastSeen: null,
        loseT: 0,
        waitT: 0,
        stepTimer: random.range(0, 0.4),
        spotted: false,
      });
    });
  }

  function say(text, seconds = 2.5) {
    state.message = text;
    state.messageT = seconds;
  }

  function moveCircle(body, radius, dx, dy) {
    const nextX = body.x + dx;
    if (!circleHitsSolid(nextX, body.y, radius)) body.x = nextX;
    const nextY = body.y + dy;
    if (!circleHitsSolid(body.x, nextY, radius)) body.y = nextY;
  }

  function circleHitsSolid(x, y, radius) {
    const [c0, r0] = tileOf(x - radius, y - radius);
    const [c1, r1] = tileOf(x + radius, y + radius);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        if (!isSolid(col, row)) continue;
        const left = MAP_X + col * TILE;
        const top = MAP_Y + row * TILE;
        const nearX = Math.max(left, Math.min(x, left + TILE));
        const nearY = Math.max(top, Math.min(y, top + TILE));
        if ((x - nearX) ** 2 + (y - nearY) ** 2 < radius * radius) return true;
      }
    }
    return false;
  }

  /** Can this guard see the player right now? Bushes hide, crates and walls block. */
  function guardSeesPlayer(guard) {
    const player = state.player;
    const dx = player.x - guard.x;
    const dy = player.y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist > CONE_RANGE) return false;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), guard.angle)) > CONE_HALF_ANGLE) return false;
    if (player.hidden && dist > BUSH_HIDE_RANGE) return false;
    return lineOfSight(guard.x, guard.y, player.x, player.y);
  }

  function guardFollowPath(guard, dt, speed) {
    if (guard.path.length === 0) return true;
    const target = guard.path[0];
    const dx = target.x - guard.x;
    const dy = target.y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      guard.path.shift();
      return guard.path.length === 0;
    }
    const want = Math.atan2(dy, dx);
    guard.angle = angleLerp(guard.angle, want, Math.min(1, dt * 10));
    const stepDist = speed * dt;
    guard.x += (dx / dist) * stepDist;
    guard.y += (dy / dist) * stepDist;
    guard.stepTimer -= dt;
    if (guard.stepTimer <= 0) {
      guard.stepTimer = 0.42;
      const pdx = guard.x - state.player.x;
      const pdy = guard.y - state.player.y;
      state.nearestGuardStep = Math.min(state.nearestGuardStep, Math.hypot(pdx, pdy));
    }
    return false;
  }

  function guardToTile(guard, col, row, dt, speed) {
    if (guard.repathT <= 0) {
      const centre = tileCenter(col, row);
      guard.path = findPath(guard.x, guard.y, centre.x, centre.y);
      guard.repathT = 0.4;
    } else {
      guard.repathT -= dt;
    }
    return guardFollowPath(guard, dt, speed);
  }

  function updateGuard(guard, dt, demo) {
    const player = state.player;
    const sees = !demo && guardSeesPlayer(guard);
    if (sees) {
      const dist = Math.hypot(player.x - guard.x, player.y - guard.y);
      const closeness = 1 - (dist / CONE_RANGE) * 0.6;
      let rate = ALERT_FILL_BASE * closeness;
      if (player.sneaking) rate *= 0.45;
      if (player.sprinting) rate *= 1.4;
      if (!player.moving) rate *= 0.7;
      guard.alert = Math.min(1, guard.alert + rate * dt);
      guard.lastSeen = { x: player.x, y: player.y };
      guard.loseT = 0;
    } else {
      guard.alert = Math.max(0, guard.alert - ALERT_DECAY * dt);
      guard.loseT += dt;
    }

    if (!demo && guard.alert >= 1 && guard.mode !== GUARD_CHASE) {
      guard.mode = GUARD_CHASE;
      guard.path = [];
      guard.repathT = 0;
      guard.spotted = true;
      state.detections += 1;
      state.levelDetections += 1;
      state.alarm = true;
    } else if (!demo && guard.alert >= SUSPICIOUS_AT && guard.mode === GUARD_PATROL) {
      guard.mode = GUARD_SUSPICIOUS;
    }

    if (guard.mode === GUARD_PATROL) {
      if (guard.pauseT > 0) {
        guard.pauseT -= dt;
        // Scan the room while waiting: slow sweep of the lantern.
        guard.angle += Math.sin(state.time * 0.9 + guard.scanPhase) * dt * 0.55;
        if (guard.pauseT <= 0) {
          guard.wpIndex = (guard.wpIndex + 1) % guard.waypoints.length;
          const target = guard.waypoints[guard.wpIndex];
          guard.path = findPath(guard.x, guard.y, target.x, target.y);
        }
      } else {
        if (guard.path.length === 0) {
          const target = guard.waypoints[guard.wpIndex];
          guard.path = findPath(guard.x, guard.y, target.x, target.y);
        }
        if (guardFollowPath(guard, dt, GUARD_PATROL_SPEED)) {
          guard.pauseT = guard.pauseDuration;
        }
      }
    } else if (guard.mode === GUARD_SUSPICIOUS) {
      if (guard.lastSeen) {
        const want = Math.atan2(guard.lastSeen.y - guard.y, guard.lastSeen.x - guard.x);
        guard.angle = angleLerp(guard.angle, want, Math.min(1, dt * 6));
      }
      if (guard.alert < SUSPICIOUS_AT * 0.5) {
        guard.mode = GUARD_PATROL;
        guard.path = [];
      } else if (sees) {
        // Keep staring: walk slowly toward the glimpse.
        const [col, row] = tileOf(guard.lastSeen.x, guard.lastSeen.y);
        guardToTile(guard, col, row, dt, GUARD_INVESTIGATE_SPEED);
      }
    } else if (guard.mode === GUARD_CHASE) {
      const [col, row] = tileOf(player.x, player.y);
      guardToTile(guard, col, row, dt, GUARD_CHASE_SPEED);
      if (!sees && guard.loseT > CHASE_LOSE_SIGHT_SECONDS) {
        guard.mode = GUARD_INVESTIGATE;
        guard.waitT = 0;
        guard.path = [];
        guard.repathT = 0;
      }
    } else if (guard.mode === GUARD_INVESTIGATE) {
      if (guard.lastSeen) {
        const [col, row] = tileOf(guard.lastSeen.x, guard.lastSeen.y);
        const arrived = guardToTile(guard, col, row, dt, GUARD_INVESTIGATE_SPEED);
        if (arrived) {
          guard.waitT += dt;
          guard.angle += dt * 1.4; // look around the spot
          if (guard.waitT > INVESTIGATE_WAIT_SECONDS) {
            guard.mode = GUARD_PATROL;
            guard.path = [];
            guard.alert = Math.min(guard.alert, SUSPICIOUS_AT * 0.5);
          }
        }
      } else {
        guard.mode = GUARD_PATROL;
      }
    }

    if (guard.mode !== GUARD_CHASE && guard.alert < 1) guard.spotted = false;
    if (state.guards.every((g) => g.mode !== GUARD_CHASE)) state.alarm = false;
  }

  function reset() {
    state.score = 0;
    state.time = 0;
    loadLevel(0);
  }

  /**
   * One fixed step. `move` is {x, y} (unit-ish, keyboard or click-to-move),
   * `sneak`/`sprint` are held modifiers. With `demo` set the guards patrol
   * and nothing can be seen, taken or won (the title screen's backdrop).
   */
  function step(dt, move, sneak, sprint, demo) {
    let events = 0;
    state.time += dt;
    state.levelTime += dt;
    if (state.messageT > 0) state.messageT = Math.max(0, state.messageT - dt);
    if (state.deniedT > 0) state.deniedT = Math.max(0, state.deniedT - dt);
    state.nearestGuardStep = 9999;

    const player = state.player;
    const speed = sneak ? SNEAK_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED;
    player.sneaking = sneak;
    player.sprinting = sprint && !sneak;
    player.moving = Math.hypot(move.x, move.y) > 0.01;
    if (player.moving && !demo) {
      const len = Math.hypot(move.x, move.y);
      const nx = move.x / len;
      const ny = move.y / len;
      moveCircle(player, PLAYER_RADIUS, nx * speed * dt, ny * speed * dt);
      player.angle = Math.atan2(ny, nx);
      player.stepTimer -= dt;
      if (player.stepTimer <= 0) {
        player.stepTimer = sneak ? 0.52 : sprint ? 0.26 : 0.38;
        events |= EVENT_STEP;
      }
      // Sprinting is loud: wardens nearby come to look.
      if (player.sprinting) {
        state.noisePulse -= dt;
        if (state.noisePulse <= 0) {
          state.noisePulse = 0.5;
          events |= EVENT_NOISE;
          for (const guard of state.guards) {
            const dist = Math.hypot(guard.x - player.x, guard.y - player.y);
            if (dist < NOISE_SPRINT_RADIUS && guard.mode === GUARD_PATROL) {
              guard.mode = GUARD_INVESTIGATE;
              guard.lastSeen = { x: player.x, y: player.y };
              guard.path = [];
              guard.repathT = 0;
            }
          }
        }
      }
    }

    const [pcol, prow] = tileOf(player.x, player.y);
    player.hidden = isBush(pcol, prow);

    for (const guard of state.guards) {
      const before = guard.mode;
      updateGuard(guard, dt, demo);
      if (guard.mode === GUARD_SUSPICIOUS && before === GUARD_PATROL) events |= EVENT_SUSPICIOUS;
      if (guard.spotted) {
        events |= EVENT_SPOTTED;
        guard.spotted = false;
      }
      if (!demo && guard.mode === GUARD_CHASE) {
        const dist = Math.hypot(guard.x - player.x, guard.y - player.y);
        if (dist < CATCH_RANGE + GUARD_RADIUS - 8) events |= EVENT_CAUGHT;
      }
    }
    if (state.nearestGuardStep < 9999) events |= EVENT_GUARD_STEP;

    if (!demo) {
      for (const shard of state.shards) {
        if (!shard.taken && Math.hypot(shard.x - player.x, shard.y - player.y) < 26) {
          shard.taken = true;
          state.shardsTaken += 1;
          state.score += SHARD_SCORE;
          state.levelScore += SHARD_SCORE;
          events |= EVENT_PICKUP;
          if (state.shardsTaken === state.shardsTotal) {
            state.exit.open = true;
            say('All shards taken — the moon gate stands open.', 3);
          } else {
            say(`Ember shard ${state.shardsTaken} of ${state.shardsTotal}.`, 2);
          }
        }
      }
      const exitDist = Math.hypot(state.exit.x - player.x, state.exit.y - player.y);
      if (exitDist < 26) {
        if (state.exit.open) {
          const timeBonus = Math.max(0, LEVEL_TIME_BONUS - Math.floor(state.levelTime) * 2);
          const unseen = state.levelDetections === 0 ? UNSEEN_BONUS : 0;
          state.score += timeBonus + unseen;
          state.levelScore += timeBonus + unseen;
          if (state.levelIndex + 1 >= LEVELS.length) {
            events |= EVENT_WIN;
          } else {
            events |= EVENT_LEVEL_CLEAR;
            loadLevel(state.levelIndex + 1);
            say(`${LEVELS[state.levelIndex].name} — slip past the wardens.`, 3);
          }
        } else if (state.deniedT === 0) {
          state.deniedT = 1.5;
          events |= EVENT_DENIED;
          say(`The moon gate is sealed — ${state.shardsTotal - state.shardsTaken} shard${state.shardsTotal - state.shardsTaken === 1 ? '' : 's'} remain.`, 2.5);
        }
      }
    }
    return events;
  }

  reset();
  return {
    state,
    reset,
    step,
    tileAt,
    isSolid,
    isBush,
    tileOf,
    tileCenter,
    lineOfSight,
    raycast,
    findPath,
    guardSeesPlayer,
  };
}
