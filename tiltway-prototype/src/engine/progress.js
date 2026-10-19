import { creditOnce, mergeLedgers } from "../core/rewards.js";
export const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };
export const FREE_HINTS_PER_LEVEL = 2;
export const HINT_MODEL = 2;
export const LEVEL_KEY = /^\d{1,2}-[0-9a-f]{6}$/;
const MEDALS = new Set(["gold", "silver", "bronze"]);
const count = (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : null);
export const PROGRESS_SPEC = {
    key: "tiltway.save.v1",
    version: 1,
    empty: () => ({ levels: {}, hints: {}, seen: [], soundOn: true, dirButtons: false, prefsRev: 0, rewardIds: [], hintModel: HINT_MODEL }),
    migrate(data, version) {
        if (version !== 1 || !data || typeof data !== "object")
            return null;
        const d = data;
        const regrant = d.hintModel !== HINT_MODEL;
        const out = {
            levels: {},
            hints: {},
            seen: [],
            soundOn: d.soundOn !== false,
            // Only an explicitly saved preference turns the buttons on.
            dirButtons: d.dirButtons === true,
            prefsRev: count(d.prefsRev) ?? 0,
            rewardIds: Array.isArray(d.rewardIds) ? mergeLedgers([], d.rewardIds.filter((x) => typeof x === "string")) : [],
            hintModel: HINT_MODEL,
        };
        if (d.levels && typeof d.levels === "object") {
            for (const [k, v] of Object.entries(d.levels)) {
                const best = count(v?.best);
                if (LEVEL_KEY.test(k) && typeof v?.medal === "string" && MEDALS.has(v.medal) && best)
                    out.levels[k] = { medal: v.medal, best };
            }
        }
        if (d.hints && typeof d.hints === "object") {
            for (const [k, v] of Object.entries(d.hints)) {
                const used = count(v?.used);
                const earned = count(v?.earned);
                if (LEVEL_KEY.test(k) && used !== null && earned !== null)
                    out.hints[k] = { used: regrant ? 0 : used, earned };
            }
        }
        if (Array.isArray(d.seen))
            out.seen = d.seen.filter((s) => typeof s === "string" && /^[a-z-]{1,24}$/.test(s));
        return out;
    },
    merge(a, b) {
        const prefs = b.prefsRev > a.prefsRev ? b : a;
        const out = {
            ...a,
            soundOn: prefs.soundOn,
            dirButtons: prefs.dirButtons,
            prefsRev: prefs.prefsRev,
            levels: { ...a.levels },
            hints: { ...a.hints },
            seen: [...new Set([...a.seen, ...b.seen])],
            rewardIds: mergeLedgers(a.rewardIds, b.rewardIds),
        };
        for (const [k, r] of Object.entries(b.levels))
            out.levels[k] = better(out.levels[k], r);
        for (const [k, h] of Object.entries(b.hints)) {
            const m = out.hints[k];
            out.hints[k] = m ? { used: Math.max(m.used, h.used), earned: Math.max(m.earned, h.earned) } : h;
        }
        return out;
    },
};
function better(prev, next) {
    if (!prev)
        return next;
    return { medal: MEDAL_RANK[next.medal] > MEDAL_RANK[prev.medal] ? next.medal : prev.medal, best: Math.min(prev.best, next.best) };
}
export function medalFor(optimal, moves, hintsUsed) {
    if (moves <= optimal && hintsUsed === 0)
        return "gold";
    if (moves <= optimal + 2)
        return "silver";
    return "bronze";
}
export function recordResult(p, key, medal, moves) {
    return { ...p, levels: { ...p.levels, [key]: better(p.levels[key], { medal, best: moves }) } };
}
export function hintsLeft(p, key) {
    const h = p.hints[key];
    return Math.max(0, FREE_HINTS_PER_LEVEL + (h?.earned ?? 0) - (h?.used ?? 0));
}
export function spendHint(p, key) {
    if (hintsLeft(p, key) <= 0)
        return null;
    const h = p.hints[key] ?? { used: 0, earned: 0 };
    return { ...p, hints: { ...p.hints, [key]: { ...h, used: h.used + 1 } } };
}
/** Credit one completed rewarded ad to the level it was requested on, once per reward id. */
export function creditReward(p, id, key) {
    if (!LEVEL_KEY.test(key))
        return p;
    const r = creditOnce(p.rewardIds, id);
    if (!r.credit)
        return p;
    const h = p.hints[key] ?? { used: 0, earned: 0 };
    return { ...p, rewardIds: r.ledger, hints: { ...p.hints, [key]: { ...h, earned: h.earned + 1 } } };
}
export function setPrefs(p, change) {
    return { ...p, ...change, prefsRev: p.prefsRev + 1 };
}
