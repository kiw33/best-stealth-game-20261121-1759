// Emberlight — drawing only: the world's state and the current screen in,
// pixels out. The 1280x720 playfield is scaled to fit the window and centred.
// The night is drawn first, then a darkness layer with holes of light cut
// around the player, the wardens, the shards and the gate, so the light
// itself tells the player what is safe.
import {
  COLS,
  CONE_HALF_ANGLE,
  CONE_RANGE,
  MAP_H,
  MAP_W,
  MAP_X,
  MAP_Y,
  PALETTE,
  ROWS,
  STEP,
  SUSPICIOUS_AT,
  TILE,
  VIEW_H,
  VIEW_W,
} from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_CAUGHT = 'caught';
export const SCREEN_WIN = 'win';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const CONE_RAYS = 18;

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const light = document.createElement('canvas');
  light.width = VIEW_W;
  light.height = VIEW_H;
  const lightCtx = light.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW_W, height / VIEW_H);
    view.x = (width - VIEW_W * view.scale) / 2;
    view.y = (height - VIEW_H * view.scale) / 2;
  }

  function text(value, x, y, size, color, align = 'left', baseline = 'alphabetic') {
    if (!fonts.has(size)) fonts.set(size, `600 ${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline;
    context.fillText(value, x, y);
  }

  /** Client (mouse) coordinates back into the 1280x720 playfield. */
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x / (window.devicePixelRatio || 1)) / (view.scale / (window.devicePixelRatio || 1)),
      y: (clientY - rect.top - view.y / (window.devicePixelRatio || 1)) / (view.scale / (window.devicePixelRatio || 1)),
    };
  }

  function drawFloor(state) {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const x = MAP_X + col * TILE;
        const y = MAP_Y + row * TILE;
        const base = (col + row) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB;
        context.fillStyle = shade(base, state.floorShade[row][col]);
        context.fillRect(x, y, TILE, TILE);
        context.strokeStyle = PALETTE.floorLine;
        context.lineWidth = 1;
        context.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }
    }
  }

  function drawBush(x, y, time) {
    const sway = Math.sin(time * 1.3 + x * 0.05 + y * 0.07) * 1.5;
    context.fillStyle = PALETTE.bush;
    for (const [dx, dy, r] of [[-12, 6, 13], [10, 8, 12], [0, -8, 14], [12, -6, 10], [-8, -10, 10]]) {
      context.beginPath();
      context.arc(x + dx + sway, y + dy, r, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = PALETTE.bushLight;
    for (const [dx, dy, r] of [[-6, 0, 6], [8, -4, 5], [2, 8, 5]]) {
      context.beginPath();
      context.arc(x + dx + sway, y + dy, r, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawCrate(x, y) {
    context.fillStyle = PALETTE.crate;
    context.fillRect(x - 20, y - 20, 40, 40);
    context.strokeStyle = PALETTE.crateEdge;
    context.lineWidth = 2;
    context.strokeRect(x - 20, y - 20, 40, 40);
    context.beginPath();
    context.moveTo(x - 20, y - 20);
    context.lineTo(x + 20, y + 20);
    context.moveTo(x + 20, y - 20);
    context.lineTo(x - 20, y + 20);
    context.stroke();
  }

  function drawWall(x, y) {
    context.fillStyle = PALETTE.wallSide;
    context.fillRect(x, y, TILE, TILE);
    context.fillStyle = PALETTE.wallTop;
    context.fillRect(x + 2, y + 2, TILE - 4, TILE - 10);
    context.fillStyle = PALETTE.wallEdge;
    context.fillRect(x + 2, y + TILE - 8, TILE - 4, 3);
  }

  function drawShard(shard, time) {
    if (shard.taken) return;
    const pulse = 1 + Math.sin(time * 3 + shard.phase) * 0.15;
    const glow = context.createRadialGradient(shard.x, shard.y, 2, shard.x, shard.y, 34 * pulse);
    glow.addColorStop(0, 'rgba(255, 179, 71, 0.55)');
    glow.addColorStop(1, 'rgba(255, 179, 71, 0)');
    context.fillStyle = glow;
    context.fillRect(shard.x - 36, shard.y - 36, 72, 72);
    context.save();
    context.translate(shard.x, shard.y);
    context.rotate(Math.PI / 4);
    context.fillStyle = PALETTE.shard;
    const s = 11 * pulse;
    context.fillRect(-s, -s, s * 2, s * 2);
    context.fillStyle = PALETTE.shardCore;
    context.fillRect(-s * 0.45, -s * 0.45, s * 0.9, s * 0.9);
    context.restore();
  }

  function drawExit(exit, time) {
    const open = exit.open;
    const glowR = open ? 70 + Math.sin(time * 2) * 8 : 34;
    const glow = context.createRadialGradient(exit.x, exit.y, 4, exit.x, exit.y, glowR);
    glow.addColorStop(0, open ? 'rgba(159, 216, 255, 0.7)' : 'rgba(120, 140, 160, 0.35)');
    glow.addColorStop(1, 'rgba(120, 140, 160, 0)');
    context.fillStyle = glow;
    context.fillRect(exit.x - glowR, exit.y - glowR, glowR * 2, glowR * 2);
    // The moon gate: two posts and a crescent lintel.
    context.fillStyle = open ? PALETTE.exitOpen : PALETTE.exitLocked;
    context.fillRect(exit.x - 20, exit.y - 18, 6, 36);
    context.fillRect(exit.x + 14, exit.y - 18, 6, 36);
    context.beginPath();
    context.arc(exit.x, exit.y - 14, 20, Math.PI, 0);
    context.lineWidth = 6;
    context.strokeStyle = open ? PALETTE.exitOpen : PALETTE.exitLocked;
    context.stroke();
    context.beginPath();
    context.arc(exit.x - 3, exit.y + 2, 7, 0, Math.PI * 2);
    context.fillStyle = open ? '#dff3ff' : '#8b9aa8';
    context.fill();
    if (!open) {
      context.strokeStyle = '#3a4550';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(exit.x - 14, exit.y + 14);
      context.lineTo(exit.x + 14, exit.y - 10);
      context.moveTo(exit.x + 14, exit.y + 14);
      context.lineTo(exit.x - 14, exit.y - 10);
      context.stroke();
    }
  }

  function drawCone(guard, world) {
    const alerted = guard.mode === 'chase';
    const points = [];
    for (let i = 0; i <= CONE_RAYS; i += 1) {
      const angle = guard.angle - CONE_HALF_ANGLE + (2 * CONE_HALF_ANGLE * i) / CONE_RAYS;
      const dist = world.raycast(guard.x, guard.y, angle, CONE_RANGE);
      points.push([guard.x + Math.cos(angle) * dist, guard.y + Math.sin(angle) * dist]);
    }
    context.beginPath();
    context.moveTo(guard.x, guard.y);
    for (const [x, y] of points) context.lineTo(x, y);
    context.closePath();
    const grad = context.createRadialGradient(guard.x, guard.y, 8, guard.x, guard.y, CONE_RANGE);
    grad.addColorStop(0, alerted ? 'rgba(255, 84, 60, 0.34)' : 'rgba(255, 214, 110, 0.30)');
    grad.addColorStop(1, alerted ? 'rgba(255, 84, 60, 0.05)' : 'rgba(255, 214, 110, 0.04)');
    context.fillStyle = grad;
    context.fill();
    context.strokeStyle = alerted ? 'rgba(255, 84, 60, 0.5)' : PALETTE.coneEdge;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) context.lineTo(points[i][0], points[i][1]);
    context.stroke();
  }

  function drawGuard(guard, world, time) {
    drawCone(guard, world);
    // Body: a warden in a rust-red coat with a brass helmet and a lantern.
    context.fillStyle = PALETTE.guard;
    context.beginPath();
    context.arc(guard.x, guard.y, 15, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = PALETTE.guardHelmet;
    context.beginPath();
    context.arc(guard.x, guard.y - 2, 9, Math.PI, 0);
    context.fill();
    context.fillRect(guard.x - 11, guard.y - 4, 22, 3);
    // Lantern light at the facing edge.
    const lx = guard.x + Math.cos(guard.angle) * 17;
    const ly = guard.y + Math.sin(guard.angle) * 17;
    context.fillStyle = '#ffd66e';
    context.beginPath();
    context.arc(lx, ly, 4, 0, Math.PI * 2);
    context.fill();
    // Alert state over the head: ? when suspicious, ! when chasing.
    if (guard.mode === 'suspicious') {
      text('?', guard.x, guard.y - 24, 22, '#ffd66e', 'center');
    } else if (guard.mode === 'chase') {
      text('!', guard.x, guard.y - 24, 26, PALETTE.danger, 'center');
    } else if (guard.alert > 0.05) {
      // A filling ring shows suspicion growing before the ? appears.
      context.strokeStyle = 'rgba(255, 214, 110, 0.9)';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(guard.x, guard.y, 20, -Math.PI / 2, -Math.PI / 2 + guard.alert * Math.PI * 2);
      context.stroke();
    }
  }

  function drawPlayer(player, time) {
    const hidden = player.hidden;
    context.save();
    if (hidden) context.globalAlpha = 0.55;
    // A hooded cloak: purple hood, pale face, a small ember lantern.
    context.fillStyle = PALETTE.playerHood;
    context.beginPath();
    context.arc(player.x, player.y, 13, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(player.x + Math.cos(player.angle) * 14, player.y + Math.sin(player.angle) * 14);
    context.lineTo(player.x + Math.cos(player.angle + 2.5) * 10, player.y + Math.sin(player.angle + 2.5) * 10);
    context.lineTo(player.x + Math.cos(player.angle - 2.5) * 10, player.y + Math.sin(player.angle - 2.5) * 10);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.player;
    context.beginPath();
    context.arc(player.x + Math.cos(player.angle) * 5, player.y + Math.sin(player.angle) * 5, 5.5, 0, Math.PI * 2);
    context.fill();
    const lx = player.x - Math.cos(player.angle) * 12;
    const ly = player.y - Math.sin(player.angle) * 12;
    context.fillStyle = '#ffb347';
    context.beginPath();
    context.arc(lx, ly, 3.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
    if (hidden) {
      text('HIDDEN', player.x, player.y - 22, 12, PALETTE.ok, 'center');
    }
    if (player.sprinting) {
      // Sprinting is loud: a ring shows the noise reaching out.
      const r = 20 + ((time * 60) % 20);
      context.strokeStyle = 'rgba(233, 226, 207, 0.25)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(player.x, player.y, r, 0, Math.PI * 2);
      context.stroke();
    }
  }

  function drawLighting(state) {
    lightCtx.setTransform(1, 0, 0, 1, 0, 0);
    lightCtx.globalCompositeOperation = 'source-over';
    lightCtx.clearRect(0, 0, VIEW_W, VIEW_H);
    lightCtx.fillStyle = PALETTE.dark;
    lightCtx.fillRect(0, 0, VIEW_W, VIEW_H);
    lightCtx.globalCompositeOperation = 'destination-out';
    function hole(x, y, radius, strength) {
      const grad = lightCtx.createRadialGradient(x, y, 4, x, y, radius);
      grad.addColorStop(0, `rgba(0,0,0,${strength})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lightCtx.fillStyle = grad;
      lightCtx.beginPath();
      lightCtx.arc(x, y, radius, 0, Math.PI * 2);
      lightCtx.fill();
    }
    hole(state.player.x, state.player.y, 175, 0.95);
    for (const guard of state.guards) hole(guard.x, guard.y, 150, 0.9);
    for (const shard of state.shards) if (!shard.taken) hole(shard.x, shard.y, 60, 0.7);
    hole(state.exit.x, state.exit.y, 95, 0.8);
    context.drawImage(light, 0, 0);
  }

  function drawHud(state, screen, best) {
    context.fillStyle = PALETTE.hud;
    context.fillRect(0, 0, VIEW_W, 48);
    context.fillStyle = '#1c262b';
    context.fillRect(0, 48, VIEW_W, 2);
    text(`Level ${state.levelIndex + 1} — ${state.levelName}`, 20, 30, 18, PALETTE.text);
    // Shards as diamonds, filled as they are taken.
    for (let i = 0; i < state.shardsTotal; i += 1) {
      const x = 330 + i * 30;
      const y = 24;
      context.save();
      context.translate(x, y);
      context.rotate(Math.PI / 4);
      context.fillStyle = i < state.shardsTaken ? PALETTE.shard : '#3a4550';
      context.fillRect(-7, -7, 14, 14);
      context.restore();
    }
    // The eye: the highest alert of any guard, green to red.
    const maxAlert = state.guards.reduce((m, g) => Math.max(m, g.alert), 0);
    const eyeX = 560;
    const eyeColor = maxAlert >= 1 ? PALETTE.danger : maxAlert >= SUSPICIOUS_AT ? '#ffb347' : PALETTE.ok;
    context.fillStyle = '#22303a';
    context.fillRect(eyeX - 70, 12, 140, 24);
    context.fillStyle = eyeColor;
    context.fillRect(eyeX - 70, 12, 140 * maxAlert, 24);
    text('SEEN', eyeX, 30, 15, PALETTE.text, 'center');
    const mins = Math.floor(state.levelTime / 60);
    const secs = Math.floor(state.levelTime % 60);
    text(`${mins}:${String(secs).padStart(2, '0')}`, 780, 30, 18, PALETTE.textDim);
    text(`Score ${state.score}`, 900, 30, 18, PALETTE.text);
    text(`Best ${best}`, 1080, 30, 18, PALETTE.textDim);
    // Bottom hints while playing.
    if (screen === SCREEN_PLAY) {
      text('WASD / arrows move · Shift sprint (loud) · C sneak (quiet) · click to walk · P pause', VIEW_W / 2, VIEW_H - 12, 14, PALETTE.textDim, 'center');
    }
    if (state.alarm) {
      context.fillStyle = 'rgba(255, 90, 60, 0.16)';
      context.fillRect(0, 48, VIEW_W, 30);
      text('SPOTTED — break line of sight!', VIEW_W / 2, 70, 18, PALETTE.danger, 'center');
    }
    if (state.messageT > 0) {
      context.fillStyle = 'rgba(13, 20, 23, 0.85)';
      const w = context.measureText(state.message).width + 36;
      context.fillRect((VIEW_W - w) / 2, VIEW_H - 64, w, 34);
      text(state.message, VIEW_W / 2, VIEW_H - 41, 17, PALETTE.text, 'center');
    }
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const lineH = 32;
    const height = 150 + lines.length * lineH + 64;
    const x = (VIEW_W - width) / 2;
    const y = (VIEW_H - height) / 2;
    context.fillStyle = 'rgba(10, 16, 20, 0.92)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = accent || '#3a4550';
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    text(title, VIEW_W / 2, y + 62, 44, PALETTE.text, 'center');
    lines.forEach((line, i) => {
      text(line, VIEW_W / 2, y + 118 + i * lineH, 19, PALETTE.textDim, 'center');
    });
    text(prompt, VIEW_W / 2, y + height - 30, 20, PALETTE.shard, 'center');
  }

  /** Paint one frame: the night, the light, the HUD, then a panel for the screen. */
  function draw(state, screen, ui) {
    const time = state.time;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#0a0f14';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    context.clearRect(0, 0, VIEW_W, VIEW_H);
    drawFloor(state);
    // Static tiles first, then the things that move.
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const tile = state.map[row][col];
        const cx = MAP_X + col * TILE + TILE / 2;
        const cy = MAP_Y + row * TILE + TILE / 2;
        if (tile === '#') drawWall(MAP_X + col * TILE, MAP_Y + row * TILE);
        else if (tile === ',') drawBush(cx, cy, time);
        else if (tile === 'o') drawCrate(cx, cy);
      }
    }
    drawExit(state.exit, time);
    for (const shard of state.shards) drawShard(shard, time);
    if (ui.moveTarget && screen === SCREEN_PLAY) {
      const t = ui.moveTarget;
      context.strokeStyle = 'rgba(233, 226, 207, 0.7)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(t.x, t.y, 8 + Math.sin(time * 5) * 2, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(t.x - 5, t.y);
      context.lineTo(t.x + 5, t.y);
      context.moveTo(t.x, t.y - 5);
      context.lineTo(t.x, t.y + 5);
      context.stroke();
    }
    for (const guard of state.guards) drawGuard(guard, ui.world, time);
    drawPlayer(state.player, time);
    drawLighting(state);
    drawHud(state, screen, ui.best);

    if (screen === SCREEN_TITLE) {
      drawPanel(
        'EMBERLIGHT',
        [
          'Wren the moth-thief slips into the wardens’ garden to steal',
          'the ember shards and leave by the moon gate — unseen.',
          '',
          'Dodge the lantern cones. Hide in the moonbush.',
          'Crates block a warden’s sight. Sprinting is loud.',
          'Steal every shard, then reach the moon gate.',
          '',
          'Move: WASD / arrows or click · Sprint: Shift · Sneak: C',
        ],
        'Press Space or click to begin',
        '#7a4a8f',
      );
    } else if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The wardens wait in the dark.'], 'Press P or Space to keep sneaking');
    } else if (screen === SCREEN_CAUGHT) {
      drawPanel(
        'Caught!',
        [`The wardens found Wren on level ${state.levelIndex + 1}.`, `Score ${state.score} · Best ${ui.best}`, 'The garden keeps its shards… this time.'],
        'Press Space or click to try again',
        PALETTE.danger,
      );
    } else if (screen === SCREEN_WIN) {
      drawPanel(
        'The Vault Is Empty',
        [
          'Every shard stolen, every warden outwitted.',
          `Final score ${state.score} · Best ${ui.best}`,
          state.detections === 0 ? 'Never once seen. A perfect ghost.' : `Spotted ${state.detections} time${state.detections === 1 ? '' : 's'}.`,
        ],
        'Press Space or click to steal again',
        PALETTE.ok,
      );
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toWorld };
}
