/**
 * Simulated rewarded ads for the public browser preview only (the preview build adds
 * <meta name="tiltway-ads" content="simulated">). No ad is requested and nothing leaves the
 * browser: a clearly labelled panel stands in for the ad, so the founder can try the whole
 * reward flow (finish = reward, close early = nothing, offline = unavailable). The Android app
 * uses the native Google Mobile Ads plugin instead; a plain browser build has no ads at all.
 */
import { NO_BANNER } from "../core/ads.js";
const WATCH_SECONDS = 3;
export function simulatedAdsEnabled(doc = document) {
    return doc.querySelector('meta[name="tiltway-ads"]')?.getAttribute("content") === "simulated";
}
function rewardId() {
    try {
        return crypto.randomUUID();
    }
    catch {
        return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}
export function simulatedAdsProvider(doc = document) {
    const pending = [];
    let showing = false;
    const state = { canRequestAds: true, privacyOptionsRequired: false, testAds: true };
    return {
        prepare: async () => state,
        showPrivacyOptions: async () => state,
        bannerPrepare: async () => NO_BANNER,
        bannerSet: async () => NO_BANNER,
        pendingRewards: async () => pending.map((r) => ({ ...r })),
        ackRewards: async (ids) => {
            for (let i = pending.length - 1; i >= 0; i--)
                if (ids.includes(pending[i].id))
                    pending.splice(i, 1);
        },
        showRewarded(context) {
            if (showing)
                return Promise.resolve({ status: "busy" });
            if (typeof navigator !== "undefined" && navigator.onLine === false)
                return Promise.resolve({ status: "unavailable" });
            showing = true;
            return new Promise((resolve) => {
                const panel = doc.createElement("div");
                panel.className = "sim-ad";
                panel.setAttribute("role", "dialog");
                panel.setAttribute("aria-modal", "true");
                panel.setAttribute("aria-labelledby", "sim-ad-title");
                const tag = doc.createElement("div");
                tag.className = "sim-ad-tag";
                tag.textContent = "PREVIEW · SIMULATED AD";
                const title = doc.createElement("h2");
                title.id = "sim-ad-title";
                title.textContent = "This stands in for a rewarded ad";
                const text = doc.createElement("p");
                text.textContent = "No real ad is shown and nothing is sent anywhere. In the Android app, a short Google ad plays here.";
                const timer = doc.createElement("p");
                timer.className = "sim-ad-timer";
                const finish = doc.createElement("button");
                finish.type = "button";
                finish.className = "primary sim-ad-finish";
                finish.textContent = "Finish the ad";
                finish.disabled = true;
                const close = doc.createElement("button");
                close.type = "button";
                close.className = "secondary sim-ad-close";
                close.textContent = "Close early (no hint)";
                panel.append(tag, title, text, timer, finish, close);
                doc.body.append(panel);
                let left = WATCH_SECONDS;
                const tick = () => {
                    timer.textContent = left > 0 ? `Reward available in ${left} s` : "Reward available";
                    finish.disabled = left > 0;
                };
                tick();
                const iv = setInterval(() => {
                    left--;
                    tick();
                    if (left <= 0)
                        clearInterval(iv);
                }, 1000);
                const done = (status) => {
                    clearInterval(iv);
                    // Like the native plugin: the reward is recorded before the game is told.
                    if (status === "rewarded")
                        pending.push({ id: rewardId(), context });
                    panel.remove();
                    showing = false;
                    resolve({ status });
                };
                finish.addEventListener("click", () => done("rewarded"));
                close.addEventListener("click", () => done("closed"));
            });
        },
    };
}
