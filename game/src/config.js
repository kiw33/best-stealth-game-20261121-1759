// Emberlight — tuning constants. One place for every number the game balances on:
// sizes, speeds, the guards' sight, the player's noise, and the palette.
export const TILE = 48;
export const COLS = 24;
export const ROWS = 13;
export const MAP_W = COLS * TILE;
export const MAP_H = ROWS * TILE;
export const VIEW_W = 1280;
export const VIEW_H = 720;
// The map is centred with a bar at the top for the HUD and a strip at the bottom.
export const MAP_X = (VIEW_W - MAP_W) / 2;
export const MAP_Y = 56;
export const STEP = 1 / 60;

export const PLAYER_RADIUS = 13;
export const GUARD_RADIUS = 15;
export const WALK_SPEED = 150;
export const SNEAK_SPEED = 82;
export const SPRINT_SPEED = 225;
export const GUARD_PATROL_SPEED = 62;
export const GUARD_CHASE_SPEED = 168;
export const GUARD_INVESTIGATE_SPEED = 105;

export const CONE_RANGE = 205;
export const CONE_HALF_ANGLE = Math.PI / 4.6; // about 39 degrees each side
export const BUSH_HIDE_RANGE = 46; // a guard this close still spots a hidden player
export const CATCH_RANGE = 17;
export const NOISE_SPRINT_RADIUS = 265;
export const NOISE_WALK_RADIUS = 55;

export const ALERT_FILL_BASE = 1.15; // per second, at point blank, walking
export const ALERT_DECAY = 0.32;
export const SUSPICIOUS_AT = 0.55;
export const CHASE_LOSE_SIGHT_SECONDS = 4.5;
export const INVESTIGATE_WAIT_SECONDS = 2.2;

export const SHARD_SCORE = 500;
export const LEVEL_TIME_BONUS = 400;
export const UNSEEN_BONUS = 300;

export const PALETTE = {
  floorA: '#1d2b26',
  floorB: '#1a2622',
  floorLine: '#16211d',
  wallTop: '#4a4238',
  wallSide: '#2e2822',
  wallEdge: '#6b5f4e',
  bush: '#2c4a2a',
  bushLight: '#3d6335',
  crate: '#7a5a33',
  crateEdge: '#a67c44',
  shard: '#ffb347',
  shardCore: '#ffe9b0',
  exitLocked: '#5a6b7a',
  exitOpen: '#9fd8ff',
  player: '#e8dcc0',
  playerHood: '#7a4a8f',
  guard: '#c94f3d',
  guardHelmet: '#e8c96a',
  cone: 'rgba(255, 214, 110, 0.20)',
  coneEdge: 'rgba(255, 214, 110, 0.45)',
  coneAlert: 'rgba(255, 84, 60, 0.28)',
  dark: 'rgba(4, 8, 14, 0.82)',
  hud: '#0d1417',
  text: '#e9e2cf',
  textDim: '#9aa78f',
  danger: '#ff5a3c',
  ok: '#8fd98a',
};

export const BEST_KEY = 'emberlight-best';
