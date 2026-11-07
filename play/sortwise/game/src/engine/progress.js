/**
 * Local-only progress and settings. Stored on the device through a Storage-like object
 * (window.localStorage in the app, plus a durable native copy on Android); nothing is sent
 * anywhere. Storage failures (private mode, cleared data, quota) fall back to defaults so the
 * game always runs.
 *
 * Format version 2 keys results by each level's stable key (e.g. "4-3fa9c1", "orig-8"), so the
 * campaign can be reordered or extended without corrupting saves. A key always names the same
 * puzzle (scripts/levelgen/key-ledger.json), so a changed puzzle never inherits a medal. Results
 * for puzzles no longer in the campaign stay in the file but are not counted. Version 1 (0.2.0,
 * ten levels keyed 1-10) is migrated: old level N is the board now keyed "orig-N".
 *
 * 1.1.0 added `seen` (one-time introductions already shown). It is optional on read, so saves
 * from 1.0.0 load unchanged, and older versions ignore it.
 *
 * 1.2.0 added `hints`: per level key, hints used and hints earned by watching a rewarded ad.
 * Each level starts with FREE_HINTS_PER_LEVEL, so a level without an entry (any level in a
 * 1.1.x save, or one never opened) has exactly that many; that is the one-time migration. Both
 * counters only grow, so restarting, replaying, leaving or relaunching never refills a level,
 * and merging two saved copies takes the larger of each. `rewards` remembers the ids of rewarded
 * ads already credited, so a reward is never credited twice.
 */
import { MEDAL_RANK, medalFor, silverFor } from "./puzzle.js";
export const FREE_HINTS_PER_LEVEL = 5;
const MAX_HINT_COUNT = 100000;
export const MAX_ATTEMPT_PATH = 500;
export const STORAGE_KEY = "sortwise.progress.v1";
export function emptyProgress() {
    return { version: 2, levels: {}, soundOn: true, seen: [], hints: {}, rewards: [] };
}
const MEDALS = new Set(["gold", "silver", "bronze"]);
const KEY_PATTERN = /^(orig-\d{1,3}|\d{1,3}-[0-9a-f]{6})$/;
const SEEN_PATTERN = /^[a-z][a-z+-]{0,23}$/;
const REWARD_ID_PATTERN = /^[0-9A-Za-z-]{1,64}$/;
const MAX_REWARD_IDS = 50;
const count = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_HINT_COUNT ? v : null;
/** A stored attempt, or null if anything about it is malformed (the level then simply starts fresh). */
export function validCurrent(v) {
    const c = v;
    if (!c || typeof c !== "object" || Array.isArray(c))
        return null;
    if (typeof c.levelKey !== "string" || !KEY_PATTERN.test(c.levelKey))
        return null;
    const hintsUsed = count(c.hintsUsed);
    if (hintsUsed === null || !Array.isArray(c.path) || c.path.length > MAX_ATTEMPT_PATH)
        return null;
    const path = [];
    for (const s of c.path) {
        if (!Array.isArray(s) || s.length !== 2)
            return null;
        const [a, b] = s;
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 400 || b > 400 || a === b)
            return null;
        path.push([a, b]);
    }
    return { levelKey: c.levelKey, path, hintsUsed };
}
function validHints(v) {
    const rec = v;
    if (!rec || typeof rec !== "object")
        return null;
    const used = count(rec.used);
    const earned = count(rec.earned);
    return used === null || earned === null ? null : { used, earned };
}
export function loadProgress(store) {
    try {
        return parseProgress(store?.getItem(STORAGE_KEY) ?? null);
    }
    catch {
        return emptyProgress();
    }
}
function validRecord(v) {
    const rec = v;
    return rec &&
        typeof rec.medal === "string" && MEDALS.has(rec.medal) &&
        typeof rec.bestMoves === "number" && Number.isInteger(rec.bestMoves) && rec.bestMoves > 0
        ? { medal: rec.medal, bestMoves: rec.bestMoves }
        : null;
}
/** Validates saved progress JSON (v1 or v2); anything unreadable becomes a fresh start. */
export function parseProgress(raw) {
    try {
        if (!raw)
            return emptyProgress();
        const data = JSON.parse(raw);
        if (typeof data !== "object" || data === null || Array.isArray(data))
            return emptyProgress();
        const d = data;
        if (d.version !== 1 && d.version !== 2)
            return emptyProgress();
        const levels = {};
        if (typeof d.levels === "object" && d.levels !== null && !Array.isArray(d.levels)) {
            for (const [k, v] of Object.entries(d.levels)) {
                const rec = validRecord(v);
                if (!rec)
                    continue;
                if (d.version === 1) {
                    // 0.2.0 saves: numeric ids 1-10 of the original ten levels.
                    const id = Number(k);
                    if (Number.isInteger(id) && id >= 1 && id <= 10)
                        levels[`orig-${id}`] = rec;
                }
                else if (KEY_PATTERN.test(k)) {
                    levels[k] = rec;
                }
            }
        }
        const seen = Array.isArray(d.seen) ? d.seen.filter((x) => typeof x === "string" && SEEN_PATTERN.test(x)) : [];
        const hints = {};
        if (d.version === 2 && typeof d.hints === "object" && d.hints !== null && !Array.isArray(d.hints)) {
            for (const [k, v] of Object.entries(d.hints)) {
                const rec = validHints(v);
                if (rec && KEY_PATTERN.test(k))
                    hints[k] = rec;
            }
        }
        const rewards = Array.isArray(d.rewards) ? d.rewards.filter((x) => typeof x === "string" && REWARD_ID_PATTERN.test(x)) : [];
        const out = {
            version: 2,
            levels,
            soundOn: d.soundOn !== false,
            seen: [...new Set(seen)].slice(0, 32),
            hints,
            rewards: [...new Set(rewards)].slice(-MAX_REWARD_IDS),
        };
        // 1.3.4 fields stay absent unless present and valid, so older saves parse exactly as before.
        const current = d.version === 2 ? validCurrent(d.current) : null;
        if (current)
            out.current = current;
        const seq = count(d.attemptSeq);
        if (seq)
            out.attemptSeq = seq;
        const epoch = count(d.resetEpoch);
        if (epoch)
            out.resetEpoch = epoch;
        return out;
    }
    catch {
        return emptyProgress();
    }
}
export function saveProgress(store, progress) {
    try {
        store?.setItem(STORAGE_KEY, JSON.stringify(progress));
        return store !== null;
    }
    catch {
        return false;
    }
}
/**
 * Combine two saved copies (the WebView store and the app's durable store), keeping the best
 * medal and fewest moves per level from either, and every introduction either has seen. The sound
 * setting follows `preferred`.
 */
export function mergeProgress(preferred, other) {
    // 1.3.4: a copy from before a reset contributes only its credited reward ids (so a reward can never
    // be credited twice); the sound setting follows `preferred` as always.
    const pe = preferred.resetEpoch ?? 0;
    const oe = other.resetEpoch ?? 0;
    if (pe !== oe) {
        const newer = pe > oe ? preferred : other;
        return { ...newer, soundOn: preferred.soundOn, rewards: [...new Set([...other.rewards, ...preferred.rewards])].slice(-MAX_REWARD_IDS) };
    }
    const hints = { ...preferred.hints };
    for (const [key, rec] of Object.entries(other.hints)) {
        const mine = hints[key];
        hints[key] = mine ? { used: Math.max(mine.used, rec.used), earned: Math.max(mine.earned, rec.earned) } : rec;
    }
    let merged = {
        ...preferred,
        levels: { ...preferred.levels },
        seen: [...new Set([...preferred.seen, ...other.seen])],
        hints,
        rewards: [...new Set([...other.rewards, ...preferred.rewards])].slice(-MAX_REWARD_IDS),
    };
    for (const [key, rec] of Object.entries(other.levels))
        merged = recordResult(merged, key, rec.medal, rec.bestMoves);
    // The puzzle in progress follows whichever copy wrote it last (a cleared attempt counts as a write).
    if ((other.attemptSeq ?? 0) > (preferred.attemptSeq ?? 0)) {
        merged = { ...merged, attemptSeq: other.attemptSeq };
        delete merged.current;
        if (other.current)
            merged.current = other.current;
    }
    return merged;
}
/** Record the puzzle in progress (every move, undo, restart and hint). */
export function setCurrent(progress, levelKey, path, hintsUsed) {
    return { ...progress, current: { levelKey, path: path.map(([a, b]) => [a, b]), hintsUsed }, attemptSeq: (progress.attemptSeq ?? 0) + 1 };
}
/**
 * 1.3.4 "Reset all progress": erases solved levels, medals and best moves, hints used and earned
 * (every level is back to its free hints), the introductions seen and the puzzle in progress. Keeps
 * the sound setting and the ids of rewards already credited (a redelivered reward is never credited
 * twice). Consent is not part of the save and is never touched. The reset counter goes up, so the
 * reset wins over any older copy when the two saved copies are merged.
 */
export function resetProgress(progress) {
    const out = { ...emptyProgress(), soundOn: progress.soundOn, rewards: [...progress.rewards], resetEpoch: (progress.resetEpoch ?? 0) + 1 };
    if (progress.attemptSeq)
        out.attemptSeq = progress.attemptSeq + 1;
    return out;
}
/** Forget the puzzle in progress (on solve). */
export function clearCurrent(progress) {
    const out = { ...progress, attemptSeq: (progress.attemptSeq ?? 0) + 1 };
    delete out.current;
    return out;
}
/** Merge a finished attempt, keeping the better medal and the fewest moves independently. */
export function recordResult(progress, levelKey, medal, moves) {
    const prev = progress.levels[levelKey];
    const next = prev
        ? {
            medal: MEDAL_RANK[medal] > MEDAL_RANK[prev.medal] ? medal : prev.medal,
            bestMoves: Math.min(prev.bestMoves, moves),
        }
        : { medal, bestMoves: moves };
    return { ...progress, levels: { ...progress.levels, [levelKey]: next } };
}
export function hasSeen(progress, item) {
    return progress.seen.includes(item);
}
export function markSeen(progress, item) {
    return hasSeen(progress, item) ? progress : { ...progress, seen: [...progress.seen, item] };
}
/** Index of the furthest level in the campaign the player has a result for, or -1. */
function furthestSolved(progress, keys) {
    for (let i = keys.length - 1; i >= 0; i--)
        if (progress.levels[keys[i]])
            return i;
    return -1;
}
/**
 * Levels open in order: the first is always open, each later one once the one before it is
 * complete. Everything up to the furthest level the player has solved stays open too, so a
 * puzzle added earlier in the campaign by an update never blocks a returning player.
 * `keys` is the campaign's level keys in play order.
 */
export function isUnlocked(progress, keys, index) {
    return index <= furthestSolved(progress, keys) + 1;
}
/**
 * 1.3.4 (owner decision D-unlocks): the level Continue offers is the lowest-numbered unsolved level
 * that is open, in campaign order. Every earned unlock is kept, so after a gap (a migrated 0.2.0
 * save, or a level added earlier in the campaign) the player is sent back to the first one missed.
 * If unsolved levels exist but none is open (impossible under isUnlocked, kept as a guard), the
 * level after the furthest solved. Null once every level is solved.
 */
export function nextLevelIndex(progress, keys) {
    for (let i = 0; i < keys.length; i++)
        if (!progress.levels[keys[i]] && isUnlocked(progress, keys, i))
            return i;
    for (let i = furthestSolved(progress, keys) + 1; i < keys.length; i++)
        if (!progress.levels[keys[i]])
            return i;
    return null;
}
/**
 * 1.3.4 (review 918 D3): correct impossible stored results for display. Nobody can beat a level's
 * optimum, so bestMoves is raised to it; the medal is lowered to the best one those moves allow
 * (gold needs bestMoves = optimal). Records for keys not in the campaign are kept as they are, and
 * no record is ever removed. Returns the same object when nothing needed correcting.
 */
export function sanitizeLevels(progress, levels) {
    let out = null;
    for (const l of levels) {
        const rec = l.key ? progress.levels[l.key] : undefined;
        if (!rec)
            continue;
        const bestMoves = Math.max(rec.bestMoves, l.optimal);
        const possible = medalFor(l.optimal, bestMoves, 0, silverFor(l));
        const medal = MEDAL_RANK[rec.medal] > MEDAL_RANK[possible] ? possible : rec.medal;
        if (bestMoves === rec.bestMoves && medal === rec.medal)
            continue;
        out ?? (out = { ...progress.levels });
        out[l.key] = { medal, bestMoves };
    }
    return out ? { ...progress, levels: out } : progress;
}
export function chapterProgress(progress, keys, firstIndex, count) {
    let solved = 0;
    let gold = 0;
    for (let i = firstIndex; i < firstIndex + count; i++) {
        const rec = progress.levels[keys[i]];
        if (rec)
            solved++;
        if (rec?.medal === "gold")
            gold++;
    }
    return { solved, gold, total: count, open: isUnlocked(progress, keys, firstIndex) };
}
/** Hints left on a level: the free ones plus those earned, minus those used. Never negative. */
export function hintsLeft(progress, levelKey) {
    const rec = progress.hints[levelKey];
    return rec ? Math.max(0, FREE_HINTS_PER_LEVEL + rec.earned - rec.used) : FREE_HINTS_PER_LEVEL;
}
/** Spend one hint on a level, or null if it has none left. Only this level changes. */
export function spendHint(progress, levelKey) {
    if (hintsLeft(progress, levelKey) <= 0)
        return null;
    const rec = progress.hints[levelKey] ?? { used: 0, earned: 0 };
    return { ...progress, hints: { ...progress.hints, [levelKey]: { ...rec, used: rec.used + 1 } } };
}
/**
 * Credit one hint earned by a completed rewarded ad to the level it was watched for. A reward id
 * already credited is ignored, so a duplicated callback or a re-delivered pending reward never
 * counts twice.
 */
export function creditReward(progress, rewardId, levelKey) {
    if (!REWARD_ID_PATTERN.test(rewardId) || !KEY_PATTERN.test(levelKey) || progress.rewards.includes(rewardId))
        return progress;
    const rec = progress.hints[levelKey] ?? { used: 0, earned: 0 };
    return {
        ...progress,
        hints: { ...progress.hints, [levelKey]: { ...rec, earned: Math.min(MAX_HINT_COUNT, rec.earned + 1) } },
        rewards: [...progress.rewards, rewardId].slice(-MAX_REWARD_IDS),
    };
}
