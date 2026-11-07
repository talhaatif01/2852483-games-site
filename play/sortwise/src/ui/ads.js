/**
 * Optional rewarded ads for extra hints, and a bottom banner. The game works fully without them:
 * every outcome other than a completed rewarded ad grants nothing, consumes nothing and leaves
 * play as it was; a banner that is not loaded simply takes no space.
 *
 * Providers:
 * - Android app: the native SortwiseAds plugin (Google Mobile Ads + Google's consent SDK, UMP).
 * - Automated tests: a simulated provider the test harness installs as window.sortwiseTestAds
 *   before the page loads (no network, no Google code).
 * - A plain browser: none; the offer then reports that no ad is available.
 *
 * Rewards are never credited from a single in-memory callback. The provider records each earned
 * reward (id + the level it was watched for) durably; the game claims pending rewards, credits
 * each id once (progress.rewards remembers credited ids), saves, then acknowledges them.
 */
/** The native plugin's prepare answer as an AdsState; anything missing or malformed reads as "no". */
export function adsStateFrom(r) {
    const s = (r ?? {});
    const out = { canRequestAds: s.canRequestAds === true, privacyOptionsRequired: s.privacyOptionsRequired === true, testAds: s.testAds === true };
    // AdsPlugin.prepare adds "error" only when the consent update failed (its message may be empty or null).
    if (Object.prototype.hasOwnProperty.call(s, "error") && s.error !== false)
        out.consentCheckFailed = true;
    return out;
}
export const NO_BANNER = { ready: false, visible: false, heightDp: 0, gapDp: 0 };
function asBanner(r) {
    const b = (r ?? {});
    const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
    const out = { ready: b.ready === true, visible: b.visible === true, heightDp: num(b.heightDp), gapDp: num(b.gapDp) };
    if (b.resizesView === true)
        out.resizesView = true;
    if (typeof b.adTopPx === "number")
        out.adTopPx = b.adTopPx;
    if (typeof b.adHeightPx === "number")
        out.adHeightPx = b.adHeightPx;
    if (typeof b.adWidthPx === "number")
        out.adWidthPx = b.adWidthPx;
    if (typeof b.adBottomPx === "number")
        out.adBottomPx = b.adBottomPx;
    if (typeof b.webBottomPx === "number")
        out.webBottomPx = b.webBottomPx;
    return out;
}
function nativeProvider(call) {
    const asState = adsStateFrom;
    return {
        prepare: async (showForm) => asState(await call("SortwiseAds", "prepare", { showForm })),
        showRewarded: async (levelKey) => {
            const r = (await call("SortwiseAds", "showRewarded", { levelKey }));
            return { status: r?.status ?? "failed" };
        },
        pendingRewards: async () => {
            const r = (await call("SortwiseAds", "pendingRewards"));
            return Array.isArray(r?.rewards)
                ? r.rewards.filter((x) => typeof x?.id === "string" && typeof x?.levelKey === "string")
                : [];
        },
        ackRewards: async (ids) => void (await call("SortwiseAds", "ackRewards", { ids })),
        showPrivacyOptions: async () => asState(await call("SortwiseAds", "showPrivacyOptions")),
        bannerPrepare: async () => asBanner(await call("SortwiseAds", "bannerPrepare")),
        bannerSet: async (visible) => asBanner(await call("SortwiseAds", "bannerSet", { visible })),
    };
}
/** The provider for this build, or null when rewarded ads are not offered (plain browser). */
export function createAdsProvider(nativeCall) {
    const test = window.sortwiseTestAds;
    if (test)
        return test;
    return nativeCall ? nativeProvider(nativeCall) : null;
}
