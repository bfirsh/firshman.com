// The one place the player's controls are defined. The demo can document them from here.
// Buttons are jsnes Controller names (A, B, SELECT, START, UP, DOWN, LEFT, RIGHT), all for player 1.

// Keyboard: KeyboardEvent.code (physical key position), so Z/X sit side by side on every layout.
export const KEYS = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyZ: 'B',
  KeyX: 'A',
  Enter: 'START',
  NumpadEnter: 'START',
  ShiftLeft: 'SELECT',
  ShiftRight: 'SELECT',
};

// Standard-mapping gamepads (button index -> NES button). South/west are B, east/north are A,
// matching where B and A sit on an NES pad.
export const PAD_BUTTONS = {
  0: 'B',
  2: 'B',
  1: 'A',
  3: 'A',
  8: 'SELECT',
  9: 'START',
  12: 'UP',
  13: 'DOWN',
  14: 'LEFT',
  15: 'RIGHT',
};
// Left stick: past this deflection it acts as the d-pad.
export const PAD_DEADZONE = 0.5;

// Touch: a tap anywhere holds A for as long as the finger is down. A quick swipe presses
// the d-pad in that direction for a few frames.
export const TOUCH = { tap: 'A', swipe: true, swipeMinPx: 36, swipeFrames: 8 };

// For people: shown nowhere on the page, but handy for the demo's own notes.
export const DESCRIPTION = 'Arrows: d-pad. X: A. Z: B. Enter: Start. Shift: Select. Gamepads work. Touch: tap = A, swipe = d-pad. M: mute. F: full screen.';

// Player shortcuts (not sent to the NES).
export const PLAYER_KEYS = { KeyM: 'mute', KeyF: 'fullscreen' };
