/**
 * Exact breadth-first search over Sortwise boards.
 *
 * Tiles of the same kind are interchangeable, and a locked tile never moves while locked, so a
 * position is fully described by the kind in each cell plus which starting locks are still shut.
 * A position is packed into one integer: 2 bits per playable cell (kind A-D) followed by one bit
 * per starting lock. Boards are limited to 20 playable cells and 6 locks, which keeps every code
 * below 2^46 - exact in a JavaScript number.
 *
 * Tests use this to prove every level's optimal move count and that no reachable position is a
 * dead end; the game uses it for hints; the level generator uses it to measure candidates.
 */
import { KINDS } from "./puzzle.js";
export const MAX_PLAYABLE_CELLS = 20;
export const MAX_LOCKS = 6;
const KIND_INDEX = new Map(KINDS.map((k, i) => [k, i]));
function shapeOf(board, cells, initialCells) {
    const playable = [];
    const slotOf = new Array(cells.length).fill(-1);
    cells.forEach((c, i) => {
        if (c !== null) {
            slotOf[i] = playable.length;
            playable.push(i);
        }
    });
    const n = playable.length;
    if (n > MAX_PLAYABLE_CELLS)
        throw new Error(`board has ${n} cells; solver limit is ${MAX_PLAYABLE_CELLS}`);
    const adj = playable.map((i) => board.neighbours[i].map((j) => slotOf[j]));
    const edges = [];
    adj.forEach((list, a) => list.forEach((b) => a < b && edges.push([a, b])));
    const lockSlots = playable.filter((i) => initialCells[i]?.locked).map((i) => slotOf[i]);
    if (lockSlots.length > MAX_LOCKS)
        throw new Error(`board has ${lockSlots.length} locks; limit ${MAX_LOCKS}`);
    const lockBitOf = new Array(n).fill(-1);
    lockSlots.forEach((slot, bit) => (lockBitOf[slot] = bit));
    const pow = [];
    for (let i = 0, p = 1; i < n; i++, p *= 4)
        pow.push(p);
    const lockBase = 4 ** n;
    const targetDigits = playable.map((i) => KIND_INDEX.get(board.target[i]));
    const targetCode = targetDigits.reduce((sum, d, i) => sum + d * pow[i], 0);
    return { n, playable, edges, adj, lockSlots, lockBitOf, pow, lockBase, targetDigits, targetCode };
}
function encode(shape, cells) {
    let code = 0;
    shape.playable.forEach((i, slot) => (code += KIND_INDEX.get(cells[i].kind) * shape.pow[slot]));
    let mask = 0;
    shape.lockSlots.forEach((slot, bit) => {
        if (cells[shape.playable[slot]].locked)
            mask |= 1 << bit;
    });
    return code + mask * shape.lockBase;
}
const digit = (kinds, pow) => Math.floor(kinds / pow) % 4;
const kindsPart = (shape, code) => code % shape.lockBase;
/**
 * Calls `visit(next, edgeIndex)` for every legal move from `code`. Swapping identical tiles is
 * skipped (it changes nothing).
 */
function forEachSuccessor(shape, code, visit) {
    const mask = Math.floor(code / shape.lockBase);
    const kinds = code - mask * shape.lockBase;
    const { edges, pow, lockBitOf, lockSlots, adj, targetDigits } = shape;
    for (let e = 0; e < edges.length; e++) {
        const [a, b] = edges[e];
        const la = lockBitOf[a];
        const lb = lockBitOf[b];
        if ((la >= 0 && mask & (1 << la)) || (lb >= 0 && mask & (1 << lb)))
            continue;
        const ka = digit(kinds, pow[a]);
        const kb = digit(kinds, pow[b]);
        if (ka === kb)
            continue;
        const nk = kinds + (kb - ka) * pow[a] + (ka - kb) * pow[b];
        let nm = mask;
        for (let bit = 0; nm && bit < lockSlots.length; bit++) {
            if (!(nm & (1 << bit)))
                continue;
            let open = true;
            for (const j of adj[lockSlots[bit]]) {
                if (digit(nk, pow[j]) !== targetDigits[j]) {
                    open = false;
                    break;
                }
            }
            if (open)
                nm &= ~(1 << bit);
        }
        visit(nk + nm * shape.lockBase, e);
    }
}
/**
 * The breadth-first search, pausing (yield) every few hundred positions so callers can slice it.
 * It gives up (distance null) once more than `limit` positions have been explored.
 */
function* searchSteps(board, cells, initialCells, limit = Infinity) {
    const shape = shapeOf(board, cells, initialCells);
    const start = encode(shape, cells);
    if (kindsPart(shape, start) === shape.targetCode)
        return { distance: 0, firstMove: null, explored: 1 };
    // firstEdge[state] = the edge index of the first move on the path that reached it.
    const firstEdge = new Map([[start, -1]]);
    let frontier = [start];
    let depth = 0;
    let sincePause = 0;
    while (frontier.length > 0) {
        depth++;
        const next = [];
        let found = -1;
        for (const s of frontier) {
            const inherited = firstEdge.get(s);
            forEachSuccessor(shape, s, (child, edge) => {
                if (found >= 0 || firstEdge.has(child))
                    return;
                const first = inherited >= 0 ? inherited : edge;
                firstEdge.set(child, first);
                if (kindsPart(shape, child) === shape.targetCode)
                    found = first;
                else
                    next.push(child);
            });
            if (found >= 0) {
                const [a, b] = shape.edges[found];
                return { distance: depth, firstMove: [shape.playable[a], shape.playable[b]], explored: firstEdge.size };
            }
            if (firstEdge.size > limit)
                return { distance: null, firstMove: null, explored: firstEdge.size };
            if (++sincePause >= 256) {
                sincePause = 0;
                yield;
            }
        }
        frontier = next;
    }
    return { distance: null, firstMove: null, explored: firstEdge.size };
}
/**
 * Shortest solution from the given cells. `initialCells` identifies which cells were lock cells
 * at the level start (locks only ever open, so this bounds the state). With `limit`, the search
 * stops (distance null, explored > limit) after that many positions - the level generator uses
 * this to drop over-budget candidates without exploring them in full.
 */
export function solve(board, cells = board.cells, initialCells = cells, limit = Infinity) {
    const steps = searchSteps(board, cells, initialCells, limit);
    let step = steps.next();
    while (!step.done)
        step = steps.next();
    return step.value;
}
/**
 * The same search, but it hands control back to the event loop every `sliceMs` so the UI never
 * freezes while a hint is being worked out, even on slow phones.
 */
export async function solveAsync(board, cells = board.cells, initialCells = cells, sliceMs = 8) {
    const steps = searchSteps(board, cells, initialCells);
    let sliceStart = performance.now();
    let step = steps.next();
    while (!step.done) {
        if (performance.now() - sliceStart >= sliceMs) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            sliceStart = performance.now();
        }
        step = steps.next();
    }
    return step.value;
}
/**
 * Explores every position reachable from the start and checks each can still reach the target.
 * Used by tests to prove locks can never strand the player, and by the level generator.
 */
export function analyseSpace(board) {
    const shape = shapeOf(board, board.cells, board.cells);
    const start = encode(shape, board.cells);
    const index = new Map([[start, 0]]);
    const states = [start];
    const edgeFrom = [];
    const edgeTo = [];
    for (let i = 0; i < states.length; i++) {
        forEachSuccessor(shape, states[i], (child) => {
            let j = index.get(child);
            if (j === undefined) {
                j = states.length;
                index.set(child, j);
                states.push(child);
            }
            edgeFrom.push(i);
            edgeTo.push(j);
        });
    }
    // Reverse adjacency in compressed form.
    const offset = new Int32Array(states.length + 1);
    for (const t of edgeTo)
        offset[t + 1]++;
    for (let i = 0; i < states.length; i++)
        offset[i + 1] += offset[i];
    const rev = new Int32Array(edgeTo.length);
    const fill = offset.slice(0, states.length);
    for (let e = 0; e < edgeTo.length; e++)
        rev[fill[edgeTo[e]]++] = edgeFrom[e];
    const dist = new Int32Array(states.length).fill(-1);
    const queue = [];
    states.forEach((s, i) => {
        if (kindsPart(shape, s) === shape.targetCode) {
            dist[i] = 0;
            queue.push(i);
        }
    });
    for (let q = 0; q < queue.length; q++) {
        const i = queue[q];
        for (let k = offset[i]; k < offset[i + 1]; k++) {
            const p = rev[k];
            if (dist[p] === -1) {
                dist[p] = dist[i] + 1;
                queue.push(p);
            }
        }
    }
    let deadEnds = 0;
    let worstDistance = 0;
    for (const d of dist) {
        if (d === -1)
            deadEnds++;
        else if (d > worstDistance)
            worstDistance = d;
    }
    const optimal = dist[0] === -1 ? null : dist[0];
    let optimalFirstMoves = 0;
    let firstMoves = 0;
    forEachSuccessor(shape, start, (child) => {
        firstMoves++;
        if (optimal !== null && dist[index.get(child)] === optimal - 1)
            optimalFirstMoves++;
    });
    return {
        reachable: states.length,
        deadEnds,
        optimal,
        worstDistance,
        branching: edgeFrom.length / states.length,
        optimalFirstMoves,
        firstMoves,
        distanceOf: (code) => {
            const i = index.get(code);
            return i === undefined || dist[i] === -1 ? undefined : dist[i];
        },
    };
}
/** Packed code of a board position, for use with `SpaceReport.distanceOf`. */
export function positionCode(board, cells, initialCells = board.cells) {
    return encode(shapeOf(board, cells, initialCells), cells);
}
/** Kinds string of a board, for tests and tools. */
export function kindsOf(cells) {
    return cells.map((c) => (c ? c.kind : ".")).join("");
}
