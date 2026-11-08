/* Number Forge rules (M1, rules version nf-m1-1). The ONE implementation the app plays and the PC generator searches,
   so the generator models the app's real random sequence exactly:
   - rng: the starter's LCG (s = s*1664525 + 1013904223 mod 2^32; value s / 2^32), seeded with the level seed;
   - start: two spawns on an empty n x n board (no fixed override);
   - each move that changes the board: merge, then ONE spawn; a spawn uses exactly two draws (cell, then 2 or 4 with
     p 0.9 / 0.1); a move that changes nothing uses no draw and is not counted.
   The RNG state is a plain number, so a game can be frozen and resumed exactly. */
(function (root) {
  'use strict';
  const RULES = 'nf-m1-1';
  const next = (s) => (Math.imul(s, 1664525) + 1013904223) >>> 0;
  /** draw(s) -> [value in [0,1), next state] */
  const draw = (s) => { const t = next(s); return [t / 4294967296, t]; };
  function spawn(board, s) {
    const empty = []; for (let i = 0; i < board.length; i++) if (!board[i]) empty.push(i);
    const b = board.slice(); let r;
    [r, s] = draw(s); const cell = empty.length ? empty[Math.floor(r * empty.length)] : -1;
    [r, s] = draw(s); if (cell >= 0) b[cell] = r < 0.9 ? 2 : 4;
    return { board: b, s };
  }
  /** dir: 0 up, 1 right, 2 down, 3 left (the starter's convention) */
  function slide(board, dir, n) {
    const out = new Array(n * n).fill(0); let gain = 0; const merged = [];
    for (let line = 0; line < n; line++) {
      const ids = []; for (let i = 0; i < n; i++) ids.push(dir === 0 ? i * n + line : dir === 1 ? line * n + n - 1 - i : dir === 2 ? (n - 1 - i) * n + line : line * n + i);
      const v = ids.map((i) => board[i]).filter(Boolean), a = [];
      for (let i = 0; i < v.length; i++) { if (v[i] === v[i + 1]) { a.push(v[i] * 2); gain += v[i] * 2; merged.push(ids[a.length - 1]); i++; } else a.push(v[i]); }
      ids.forEach((id, i) => { out[id] = a[i] || 0; });
    }
    return { board: out, gain, merged, changed: out.some((x, i) => x !== board[i]) };
  }
  function start(n, seed) { let g = { board: new Array(n * n).fill(0), s: seed >>> 0 }; g = spawn(g.board, g.s); g = spawn(g.board, g.s); return g; }
  /** One player move on a game {board, s, score, moves}; returns the new game and what happened (or null if no change). */
  function move(game, dir, n) {
    const m = slide(game.board, dir, n); if (!m.changed) return null;
    const sp = spawn(m.board, game.s), spawned = sp.board.findIndex((v, i) => v !== m.board[i]);
    return { game: { board: sp.board, s: sp.s, score: game.score + m.gain, moves: game.moves + 1 }, gain: m.gain, merged: m.merged, spawned };
  }
  const canMove = (board, n) => [0, 1, 2, 3].some((d) => slide(board, d, n).changed);
  const best = (board) => board.reduce((a, b) => Math.max(a, b), 0);
  const api = { RULES, next, draw, spawn, slide, start, move, canMove, best };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ForgeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
