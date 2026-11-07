/**
 * 1.3.4: rebuilding a saved puzzle in progress. The stored attempt holds only the swaps; replaying
 * them through the game's own rules rebuilds the board, the move count and the undo history, and
 * rejects anything that is not a legal sequence for this level (the level then simply starts fresh).
 */
import { applySwap, checkSwap, isSolved, newGame } from "./puzzle.js";
export function replayAttempt(level, attempt) {
    if (attempt.levelKey !== level.key)
        return null;
    let state = { ...newGame(level), hintsUsed: attempt.hintsUsed };
    for (const [a, b] of attempt.path) {
        if (a >= state.board.cells.length || b >= state.board.cells.length)
            return null;
        if (checkSwap(state.board, a, b))
            return null;
        state = applySwap(state, a, b).state;
        // A solved board is never stored (solving clears the attempt), so one here means a stale record.
        if (isSolved(state.board))
            return null;
    }
    return state;
}
