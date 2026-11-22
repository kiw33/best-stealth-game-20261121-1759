// Emberlight — keyboard and pointer input. Held keys give a steering vector and
// the sneak/sprint modifiers; one-shot presses (confirm, pause) are queued as
// bit flags and taken once by the loop, so a press between two frames is never
// lost and never counted twice. A mouse click is a move order, not a confirm.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const SNEAK = new Set(['KeyC', 'ControlLeft', 'ControlRight']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  let click = null;

  window.addEventListener('keydown', (event) => {
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
      event.preventDefault();
      return;
    }
    if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
      event.preventDefault();
      return;
    }
    if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)
      || SNEAK.has(event.code) || SPRINT.has(event.code)) {
      held.add(event.code);
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
  });
  target.addEventListener('pointerdown', (event) => {
    click = { x: event.clientX, y: event.clientY };
  });

  function anyOf(keys) {
    for (const code of keys) if (held.has(code)) return true;
    return false;
  }

  return {
    /** Steering vector from the held keys, each axis -1, 0 or 1. */
    direction() {
      return {
        x: (anyOf(RIGHT) ? 1 : 0) - (anyOf(LEFT) ? 1 : 0),
        y: (anyOf(DOWN) ? 1 : 0) - (anyOf(UP) ? 1 : 0),
      };
    },
    sneak() {
      return anyOf(SNEAK);
    },
    sprint() {
      return anyOf(SPRINT);
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** The last click's client coordinates, or null; consumed on read. */
    takeClick() {
      const taken = click;
      click = null;
      return taken;
    },
  };
}
