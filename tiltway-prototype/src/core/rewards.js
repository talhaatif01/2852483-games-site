/**
 * Credit each rewarded-ad reward exactly once (pattern proven in Sortwise).
 *
 * The native layer records every earned reward durably as { id, context } BEFORE telling the game;
 * the game credits each id once, remembers the last MAX_REWARD_IDS credited ids in its save,
 * saves, and only then acknowledges them. So a reward earned while the app was killed is credited
 * on the next launch, and a re-delivered reward is never counted twice.
 */
export const MAX_REWARD_IDS = 50;
const REWARD_ID = /^[0-9A-Za-z-]{1,64}$/;
/** Returns the new ledger and whether this id should be credited now. */
export function creditOnce(ledger, id) {
    if (!REWARD_ID.test(id) || ledger.includes(id))
        return { ledger: [...ledger], credit: false };
    return { ledger: [...ledger, id].slice(-MAX_REWARD_IDS), credit: true };
}
export function mergeLedgers(a, b) {
    return [...new Set([...b, ...a])].filter((id) => REWARD_ID.test(id)).slice(-MAX_REWARD_IDS);
}
