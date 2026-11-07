/**
 * Sortwise puzzle rules - pure logic, no DOM.
 *
 * The board is a small grid of tiles. Each level shows a target pattern; the player rearranges
 * the tiles to match it. The only move is swapping two tiles that touch (share an edge).
 *
 * Locked tiles cannot be swapped. A locked tile unlocks permanently as soon as every cell that
 * touches it holds the tile kind the target asks for there. Unlocking is checked after every
 * move, so a lock can never re-close.
 *
 * Levels are written as rows of characters:
 *   A-D  a tile kind
 *   .    a hole (no cell; nothing can enter it)
 * Lock positions use a parallel grid where "#" marks a locked starting cell.
 */
export const KINDS = ["A", "B", "C", "D"];
export class LevelFormatError extends Error {
}
export class IllegalMoveError extends Error {
    constructor(message, reason) {
        super(message);
        this.reason = reason;
    }
}
function isKind(ch) {
    return KINDS.includes(ch);
}
function parseGrid(rows, label) {
    if (rows.length === 0)
        throw new LevelFormatError(`${label}: grid is empty`);
    const cols = rows[0].length;
    if (rows.some((r) => r.length !== cols))
        throw new LevelFormatError(`${label}: ragged grid`);
    return { rows: rows.length, cols, chars: rows.join("").split("") };
}
export function buildBoard(level) {
    const t = parseGrid(level.target, `level ${level.id} target`);
    const s = parseGrid(level.start, `level ${level.id} start`);
    if (t.rows !== s.rows || t.cols !== s.cols) {
        throw new LevelFormatError(`level ${level.id}: start and target sizes differ`);
    }
    const lockChars = level.locks ? parseGrid(level.locks, `level ${level.id} locks`).chars : null;
    if (lockChars && lockChars.length !== t.chars.length) {
        throw new LevelFormatError(`level ${level.id}: lock grid size differs`);
    }
    const target = [];
    const cells = [];
    for (let i = 0; i < t.chars.length; i++) {
        const tc = t.chars[i];
        const sc = s.chars[i];
        const tHole = tc === ".";
        const sHole = sc === ".";
        if (tHole !== sHole)
            throw new LevelFormatError(`level ${level.id}: hole mismatch at cell ${i}`);
        if (tHole) {
            target.push(null);
            cells.push(null);
            continue;
        }
        if (!isKind(tc) || !isKind(sc))
            throw new LevelFormatError(`level ${level.id}: bad char at cell ${i}`);
        const locked = lockChars?.[i] === "#";
        target.push(tc);
        cells.push({ id: i + 1, kind: sc, locked });
    }
    const count = (arr) => {
        const m = new Map();
        for (const k of arr)
            if (k)
                m.set(k, (m.get(k) ?? 0) + 1);
        return m;
    };
    const tc = count(target);
    const sc = count(cells.map((c) => c?.kind ?? null));
    for (const k of KINDS) {
        if ((tc.get(k) ?? 0) !== (sc.get(k) ?? 0)) {
            throw new LevelFormatError(`level ${level.id}: start and target use different tiles`);
        }
    }
    const neighbours = [];
    for (let i = 0; i < cells.length; i++) {
        const list = [];
        if (cells[i] !== null) {
            const r = Math.floor(i / t.cols);
            const c = i % t.cols;
            const candidates = [[r - 1, c], [r, c + 1], [r + 1, c], [r, c - 1]];
            for (const [nr, nc] of candidates) {
                if (nr < 0 || nc < 0 || nr >= t.rows || nc >= t.cols)
                    continue;
                const j = nr * t.cols + nc;
                if (cells[j] !== null)
                    list.push(j);
            }
        }
        neighbours.push(list);
    }
    const board = { rows: t.rows, cols: t.cols, cells, target, neighbours };
    // A level must not start with a lock already satisfied - that lock would teach nothing.
    for (let i = 0; i < cells.length; i++) {
        if (cells[i]?.locked && lockSatisfied(board, cells, i)) {
            throw new LevelFormatError(`level ${level.id}: lock at cell ${i} starts already open`);
        }
    }
    return board;
}
/** True when every cell touching `index` holds its target kind. */
export function lockSatisfied(board, cells, index) {
    return board.neighbours[index].every((j) => cells[j]?.kind === board.target[j]);
}
export function isCorrect(board, cells, index) {
    const tile = cells[index];
    return tile != null && tile.kind === board.target[index];
}
export function isSolved(board, cells = board.cells) {
    return cells.every((tile, i) => tile === null || tile.kind === board.target[i]);
}
export function newGame(level) {
    const board = buildBoard(level);
    return { level, board, moves: 0, hintsUsed: 0, history: [{ cells: board.cells, moves: 0 }] };
}
export function areTouching(board, a, b) {
    return board.neighbours[a]?.includes(b) ?? false;
}
/** Why a swap is illegal, or null if it is legal. */
export function checkSwap(board, a, b) {
    if (a === b)
        return new IllegalMoveError("Pick two different tiles.", "same");
    const ta = board.cells[a];
    const tb = board.cells[b];
    if (!ta || !tb)
        return new IllegalMoveError("That spot is empty.", "hole");
    if (!areTouching(board, a, b))
        return new IllegalMoveError("Only touching tiles can swap.", "not-touching");
    if (ta.locked || tb.locked)
        return new IllegalMoveError("Locked tiles can't move yet.", "locked");
    return null;
}
export function applySwap(state, a, b) {
    const err = checkSwap(state.board, a, b);
    if (err)
        throw err;
    const cells = state.board.cells.slice();
    const ta = cells[a];
    cells[a] = cells[b];
    cells[b] = ta;
    const unlocked = [];
    for (let i = 0; i < cells.length; i++) {
        const tile = cells[i];
        if (tile?.locked && lockSatisfied(state.board, cells, i)) {
            cells[i] = { ...tile, locked: false };
            unlocked.push(tile.id);
        }
    }
    const moves = state.moves + 1;
    return {
        state: {
            ...state,
            board: { ...state.board, cells },
            moves,
            history: [...state.history, { cells, moves }],
        },
        unlocked,
    };
}
/** Step back one move. Hints already taken stay counted. */
export function undo(state) {
    if (state.history.length <= 1)
        return state;
    const history = state.history.slice(0, -1);
    const prev = history[history.length - 1];
    return { ...state, board: { ...state.board, cells: prev.cells }, moves: prev.moves, history };
}
/** Back to the level's starting layout. Hints already taken stay counted for this attempt. */
export function restart(state) {
    return { ...newGame(state.level), hintsUsed: state.hintsUsed };
}
export function legalSwaps(board, cells = board.cells) {
    const out = [];
    for (let a = 0; a < cells.length; a++) {
        const ta = cells[a];
        if (!ta || ta.locked)
            continue;
        for (const b of board.neighbours[a]) {
            if (b <= a)
                continue;
            const tb = cells[b];
            if (tb && !tb.locked)
                out.push([a, b]);
        }
    }
    return out;
}
/** Default moves allowed for silver: a little slack over the perfect solution. */
export function silverLimit(optimal) {
    return optimal + Math.max(2, Math.ceil(optimal / 4));
}
/** The silver threshold for a level: its tuned value, or the default allowance. */
export function silverFor(level) {
    return level.silver ?? silverLimit(level.optimal);
}
/**
 * Gold needs a perfect solve without hints. Hints are always available but cap the medal at
 * silver, so asking for help never ends the attempt or hides the next level.
 */
export function medalFor(optimal, moves, hintsUsed, silver = silverLimit(optimal)) {
    if (moves <= optimal && hintsUsed === 0)
        return "gold";
    if (moves <= silver)
        return "silver";
    return "bronze";
}
export const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };
