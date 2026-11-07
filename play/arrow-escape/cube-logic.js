/* Arrow Escape rules (from the Tivexa five-game intake, cube-logic.js, sha256 4ee50d10...): arrow directions, the
   clear-ray test, blocked-tap lives and the interstitial play clock. Level generation moved to tools/ (the PC builds
   the campaign; the app only plays it). No SDK or network. */
(function (root) {
  'use strict';
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const names = ['right', 'left', 'up', 'down', 'front', 'back'];
  /** A block may leave when no remaining block sits on its outward ray to the cube edge. */
  function clear(block, active, n) {
    const d = directions[block.d];
    for (let x = block.x + d[0], y = block.y + d[1], z = block.z + d[2]; x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n; x += d[0], y += d[1], z += d[2])
      if (active.some(b => b.x === x && b.y === y && b.z === z)) return false;
    return true;
  }
  /** Interstitial opportunity clock: counts only active foreground play; a level break may use it once it is due. */
  function createAdClock(interval = 180000) {
    let elapsed = 0;
    return {
      tick(ms, playing) { if (playing && Number.isFinite(ms) && ms > 0) elapsed = Math.min(interval, elapsed + ms); },
      get elapsed() { return elapsed; }, get due() { return elapsed >= interval; },
      atBreak(eligible) { return Boolean(eligible && elapsed >= interval); },
      /** Only an interstitial shown at a level break resets the clock (a rewarded refill never does). */
      shown() { elapsed = 0; },
    };
  }
  // M2 lives model (owner 2026-11-04): 10 lives, ONE per blocked tap, so a fresh level allows 10 wrong taps before
  // it is out of lives. Rotation, zoom, undo and taps on clear blocks never cost a life; undo never refunds one.
  // 1.0.1 B2 LIFE BANK (owner relay 0060): one persistent bank across levels, starting at LIVES (10). A blocked tap
  // costs one (never below 0); a completed level adds one; each rewarded ad watched adds one (REWARD_LIVES, was +5).
  // Restart level from the out-of-lives card is the free way on: it tops an empty bank back up to LIVES.
  const LIVES = 10, REWARD_LIVES = 1, WIN_LIVES = 1;
  const bankOf = (b) => (Number.isFinite(b) && b >= 0 ? Math.floor(b) : LIVES);
  /** A blocked tap: -1 (never below 0). */
  function loseLife(bank) { return Math.max(0, bankOf(bank) - 1); }
  /** A completed level: +1. */
  function winLife(bank) { return bankOf(bank) + WIN_LIVES; }
  /** A rewarded ad watched to the end: +1. */
  function adLife(bank) { return bankOf(bank) + REWARD_LIVES; }
  /** Restart level at 0 lives (free alternative to the ad): back to the starting count, never lower than the bank. */
  function restartLives(bank) { return Math.max(LIVES, bankOf(bank)); }
  const api = { directions, names, clear, bankOf, loseLife, winLife, adLife, restartLives, createAdClock, LIVES, REWARD_LIVES, WIN_LIVES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CubeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
