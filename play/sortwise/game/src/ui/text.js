/** Display text shared by the screens. Pure functions - no DOM - so they are unit-tested. */
/** "1 move", "2 moves". */
export function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}
