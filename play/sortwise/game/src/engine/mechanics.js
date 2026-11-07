/** In the order a player should learn them. */
export const MECHANICS = ["gaps", "loop", "locks", "chain", "gate"];
function gridOf(level) {
    const rows = level.target.length;
    const cols = level.target[0].length;
    const chars = level.target.join("");
    const lockChars = level.locks?.join("") ?? "";
    return {
        rows,
        cols,
        cell: [...chars].map((ch) => ch !== "."),
        locked: [...chars].map((_, i) => lockChars[i] === "#"),
    };
}
function neighbours(g, i) {
    const r = Math.floor(i / g.cols);
    const c = i % g.cols;
    const out = [];
    if (r > 0)
        out.push(i - g.cols);
    if (r < g.rows - 1)
        out.push(i + g.cols);
    if (c > 0)
        out.push(i - 1);
    if (c < g.cols - 1)
        out.push(i + 1);
    return out;
}
/** True when the cells (minus `removed`) form one connected area. */
function connected(g, removed) {
    const cells = g.cell.map((ok, i) => (ok && i !== removed ? i : -1)).filter((i) => i >= 0);
    if (cells.length === 0)
        return true;
    const seen = new Set([cells[0]]);
    const queue = [cells[0]];
    while (queue.length) {
        for (const j of neighbours(g, queue.pop())) {
            if (g.cell[j] && j !== removed && !seen.has(j)) {
                seen.add(j);
                queue.push(j);
            }
        }
    }
    return seen.size === cells.length;
}
/** Holes that cannot reach the edge of the grid through other holes: they are ringed by cells. */
function enclosedHoles(g) {
    const onEdge = (i) => {
        const r = Math.floor(i / g.cols);
        const c = i % g.cols;
        return r === 0 || c === 0 || r === g.rows - 1 || c === g.cols - 1;
    };
    const reachesEdge = new Set();
    const queue = [];
    g.cell.forEach((ok, i) => {
        if (!ok && onEdge(i)) {
            reachesEdge.add(i);
            queue.push(i);
        }
    });
    while (queue.length) {
        for (const j of neighbours(g, queue.pop())) {
            if (!g.cell[j] && !reachesEdge.has(j)) {
                reachesEdge.add(j);
                queue.push(j);
            }
        }
    }
    return g.cell.map((_, i) => i).filter((i) => !g.cell[i] && !reachesEdge.has(i));
}
export function mechanicsOf(level) {
    return new Set(MECHANICS.filter((m) => mechanicCells(level, m).length > 0));
}
/**
 * The board cells (row-major indexes) that show a rule on this level: the gaps, the gaps a loop
 * runs round, the locked tiles, the locks that touch another lock, or the locks that are gates.
 * Empty when the level does not use the rule.
 */
export function mechanicCells(level, mechanic) {
    const g = gridOf(level);
    const all = g.cell.map((_, i) => i);
    const locks = all.filter((i) => g.locked[i]);
    switch (mechanic) {
        case "gaps":
            return all.filter((i) => !g.cell[i]);
        case "loop":
            return enclosedHoles(g);
        case "locks":
            return locks;
        case "chain":
            return locks.filter((i) => neighbours(g, i).some((j) => g.locked[j]));
        case "gate":
            return locks.filter((i) => !connected(g, i));
    }
}
