/** Board geometry shared by layout and input. Pure functions - no DOM - so they are unit-tested. */
/** Top-left corner of a cell, relative to the board. */
export function cellOrigin(g, index) {
    const r = Math.floor(index / g.cols);
    const c = index % g.cols;
    return { x: c * (g.cell + g.gap), y: r * (g.cell + g.gap) };
}
/**
 * The cell index under a point relative to the board's top-left, or null outside the board.
 * Points in a gap snap to the nearest cell, so near-miss taps still count. Callers check
 * whether that cell holds a tile.
 */
export function cellAtPoint(g, x, y) {
    const width = g.cols * g.cell + (g.cols - 1) * g.gap;
    const height = g.rows * g.cell + (g.rows - 1) * g.gap;
    if (x < 0 || y < 0 || x > width || y > height)
        return null;
    const c = Math.min(g.cols - 1, Math.floor((x + g.gap / 2) / (g.cell + g.gap)));
    const r = Math.min(g.rows - 1, Math.floor((y + g.gap / 2) / (g.cell + g.gap)));
    return r * g.cols + c;
}
/**
 * During a swap animation a tile is drawn away from its cell. Returns the cell of the moving tile
 * drawn under the point (the one whose centre is nearest if two overlap), or null if none is.
 */
export function movingTileAt(tiles, x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const t of tiles) {
        if (x < t.left || y < t.top || x > t.left + t.width || y > t.top + t.height)
            continue;
        const dist = Math.hypot(x - (t.left + t.width / 2), y - (t.top + t.height / 2));
        if (dist < bestDist) {
            best = t.cell;
            bestDist = dist;
        }
    }
    return best;
}
/** Largest tile that fits a board of rows x cols in the given area (CSS px), capped at 112. */
export function fitCell(availW, availH, rows, cols, gap) {
    const w = Math.min(availW, 460);
    const h = Math.max(availH, 150);
    return Math.floor(Math.min((w - gap * (cols - 1)) / cols, (h - gap * (rows - 1)) / rows, 112));
}
