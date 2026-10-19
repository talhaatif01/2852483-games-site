export const DIRS = ["up", "right", "down", "left"];
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const ARROWS = { "^": "up", v: "down", "<": "left", ">": "right" };
export function parseLayout(rows) {
    const h = rows.length;
    const w = rows[0]?.length ?? 0;
    if (!h || !w || rows.some((r) => r.length !== w))
        throw new Error("layout rows must be non-empty and equal length");
    const walls = new Set();
    const holes = new Map();
    const pieces = [];
    const specials = new Map();
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const i = y * w + x;
        const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        if (ch === "#")
            walls.add(i);
        else if (border)
            throw new Error(`border cell ${x},${y} must be a wall`);
        else if (ch === ".")
            return;
        else if (ch === "a" || ch === "b" || ch === "c")
            pieces.push({ id: pieces.length, kind: "marble", color: ch, pos: i });
        else if (ch === "A" || ch === "B" || ch === "C")
            holes.set(i, ch.toLowerCase());
        else if (ch === "x")
            pieces.push({ id: pieces.length, kind: "crate", color: null, pos: i });
        else if (ch === "o")
            specials.set(i, "sticky");
        else if (ARROWS[ch])
            specials.set(i, ARROWS[ch]);
        else
            throw new Error(`unknown layout character "${ch}"`);
    }));
    for (const c of ["a", "b", "c"]) {
        const m = pieces.filter((p) => p.color === c).length;
        const hs = [...holes.values()].filter((v) => v === c).length;
        if (m !== hs)
            throw new Error(`colour ${c}: ${m} marbles but ${hs} holes`);
    }
    if (!pieces.some((p) => p.kind === "marble"))
        throw new Error("no marbles");
    return { w, h, walls, holes, pieces, sunk: [], specials };
}
export function tilt(board, dir) {
    const [dx, dy] = DELTA[dir];
    const { w } = board;
    // Front pieces first, so each piece rolls up against the ones already settled.
    const lead = (p) => {
        const x = p.pos % w;
        const y = Math.floor(p.pos / w);
        return -(x * dx + y * dy);
    };
    const order = [...board.pieces].sort((a, b) => lead(a) - lead(b) || a.id - b.id);
    const occupied = new Set();
    const holes = new Map(board.holes);
    const pieces = [];
    const sunk = [...board.sunk];
    const paths = [];
    for (const p of order) {
        let pos = p.pos;
        let sunkAt = null;
        for (;;) {
            const x = (pos % w) + dx;
            const y = Math.floor(pos / w) + dy;
            const next = y * w + x;
            if (board.walls.has(next) || occupied.has(next))
                break;
            const special = board.specials.get(next);
            if (special && special !== "sticky" && special !== dir)
                break; // an arrow pointing another way
            pos = next;
            if (p.kind === "marble" && holes.get(pos) === p.color) {
                holes.delete(pos);
                sunkAt = pos;
                break;
            }
            if (special === "sticky")
                break;
        }
        paths.push({ id: p.id, from: p.pos, to: pos, sunkAt });
        if (sunkAt !== null)
            sunk.push({ id: p.id, color: p.color, hole: sunkAt });
        else {
            occupied.add(pos);
            pieces.push({ ...p, pos });
        }
    }
    pieces.sort((a, b) => a.id - b.id);
    const moved = paths.some((q) => q.from !== q.to || q.sunkAt !== null);
    return { board: { ...board, holes, pieces, sunk }, moved, paths: paths.sort((a, b) => a.id - b.id) };
}
export const isSolved = (b) => !b.pieces.some((p) => p.kind === "marble");
/** Canonical state key: piece positions (by kind/colour, order-independent) and remaining holes. */
export function stateKey(b) {
    const parts = b.pieces.map((p) => `${p.color ?? "x"}${p.pos}`).sort();
    return `${parts.join(",")}|${[...b.holes.keys()].sort((x, y) => x - y).join(",")}`;
}
/** Breadth-first search: exact fewest moves (small boards; bounded by maxStates). */
export function solve(start, maxStates = 200000) {
    if (isSolved(start))
        return { moves: 0, path: [], explored: 1 };
    const seen = new Map([[stateKey(start), { prev: null, dir: null }]]);
    let frontier = [start];
    let depth = 0;
    while (frontier.length && seen.size < maxStates) {
        depth++;
        const next = [];
        for (const b of frontier) {
            const key = stateKey(b);
            for (const d of DIRS) {
                const r = tilt(b, d);
                if (!r.moved)
                    continue;
                const k = stateKey(r.board);
                if (seen.has(k))
                    continue;
                seen.set(k, { prev: key, dir: d });
                if (isSolved(r.board)) {
                    const path = [];
                    for (let cur = k; cur;) {
                        const s = seen.get(cur);
                        if (s.dir)
                            path.unshift(s.dir);
                        cur = s.prev;
                    }
                    return { moves: depth, path, explored: seen.size };
                }
                next.push(r.board);
            }
        }
        frontier = next;
    }
    return { moves: null, path: [], explored: seen.size };
}
/** The first tilt of a shortest solution from here (the hint), or null if none exists. */
export function hint(b) {
    return solve(b).path[0] ?? null;
}
/** Can the level still be solved from here? (A marble can get stuck in a corner it cannot leave.) */
export const solvable = (b) => solve(b).moves !== null;
