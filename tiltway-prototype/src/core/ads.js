export const NO_BANNER = { ready: false, visible: false, heightDp: 0, gapDp: 0 };
const asState = (r) => {
    const s = (r ?? {});
    return { canRequestAds: s.canRequestAds === true, privacyOptionsRequired: s.privacyOptionsRequired === true, testAds: s.testAds === true };
};
const asBanner = (r) => {
    const b = (r ?? {});
    const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
    return { ready: b.ready === true, visible: b.visible === true, heightDp: num(b.heightDp), gapDp: num(b.gapDp) };
};
export function nativeAdsProvider(call, plugin) {
    return {
        prepare: async (showForm) => asState(await call(plugin, "prepare", { showForm })),
        showRewarded: async (context) => {
            const r = (await call(plugin, "showRewarded", { context }));
            return { status: r?.status ?? "failed" };
        },
        pendingRewards: async () => {
            const r = (await call(plugin, "pendingRewards"));
            return Array.isArray(r?.rewards) ? r.rewards.filter((x) => typeof x?.id === "string" && typeof x?.context === "string") : [];
        },
        ackRewards: async (ids) => void (await call(plugin, "ackRewards", { ids })),
        showPrivacyOptions: async () => asState(await call(plugin, "showPrivacyOptions")),
        bannerPrepare: async () => asBanner(await call(plugin, "bannerPrepare")),
        bannerSet: async (visible) => asBanner(await call(plugin, "bannerSet", { visible })),
    };
}
/** The provider for this build: the test provider if installed, the native one on Android, else none. */
export function createAdsProvider(nativeCall, plugin) {
    const test = globalThis.studioTestAds;
    if (test)
        return test;
    return nativeCall ? nativeAdsProvider(nativeCall, plugin) : null;
}
