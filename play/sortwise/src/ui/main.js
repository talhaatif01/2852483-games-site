/**
 * Sortwise UI - DOM wiring only. Puzzle rules live in src/engine and are unit-tested there.
 *
 * Screens: the chapter list, a chapter's levels, the play screen, How to play, and the tutorial
 * (the play screen with a coach). The play screen's tiles are persistent elements positioned with
 * transforms, so a swap animates the two tiles between cells.
 */
import { CHAPTERS, LEVELS } from "../engine/levels.js";
import { mechanicCells, mechanicsOf, MECHANICS } from "../engine/mechanics.js";
import { applySwap, checkSwap, isCorrect, isSolved, medalFor, MEDAL_RANK, newGame, restart, silverFor, undo, } from "../engine/puzzle.js";
import { solveAsync } from "../engine/solver.js";
import { chapterProgress, clearCurrent, creditReward, FREE_HINTS_PER_LEVEL, hasSeen, hintsLeft, spendHint, isUnlocked, loadProgress, markSeen, mergeProgress, parseProgress, nextLevelIndex, recordResult, resetProgress, sanitizeLevels, saveProgress, setCurrent, } from "../engine/progress.js";
import { replayAttempt } from "../engine/attempt.js";
import { TUTORIAL_GUIDED_SWAP, TUTORIAL_LEVEL } from "../engine/tutorial.js";
import { createAdsProvider, NO_BANNER } from "./ads.js";
import { play, setSoundEnabled, suspendAudio } from "./audio.js";
import { cellAtPoint, cellOrigin, fitCell, movingTileAt } from "./geometry.js";
import { plural } from "./text.js";
import { APP_VERSION } from "./version.js";
import { NO_AD_MESSAGE, PRIVACY_PARAGRAPHS } from "./privacy-text.js";
import { migrateSoundPrefs } from "./sound-prefs.js";
const LEVEL_KEYS = LEVELS.map((l) => l.key);
const LEVEL_MECHANICS = LEVELS.map((l) => mechanicsOf(l));
const KIND_NAMES = { A: "sun", B: "leaf", C: "wave", D: "berry" };
const MEDAL_TEXT = { gold: "Gold", silver: "Silver", bronze: "Bronze" };
const MEDAL_STARS = { gold: "★★★", silver: "★★☆", bronze: "★☆☆" };
/** How each rule is introduced the first time a level uses it, and in How to play. */
const RULES = {
    gaps: { title: "Gaps", text: "Gaps aren't part of the board. Tiles can't enter or cross them - plan the way round." },
    loop: { title: "Loops", text: "This board runs round a gap, so tiles can travel either way. Pick the shorter way." },
    locks: { title: "Locks", text: "A padlocked tile can't move. It opens for good once every tile touching it matches the target." },
    chain: { title: "Lock chains", text: "These locks touch, so each is one of the other's neighbours. Work out which can open first." },
    gate: { title: "Gates", text: "This lock is the only way between two parts of the board. Nothing crosses until it opens." },
};
/** A rule counts as met once its introduction was shown or the player solved a level using it. */
function ruleMet(rule) {
    return hasSeen(progress, rule) || LEVELS.some((l, i) => progress.levels[l.key] !== undefined && LEVEL_MECHANICS[i].has(rule));
}
/** Only brand-new players are taken through the tutorial automatically. */
function needsTutorial() {
    return !hasSeen(progress, "tutorial") && Object.keys(progress.levels).length === 0;
}
function noteSeen(item) {
    if (hasSeen(progress, item))
        return;
    progress = markSeen(progress, item);
    persistProgress();
}
const storage = (() => {
    try {
        return window.localStorage;
    }
    catch {
        return null;
    }
})();
// 1.3.4: impossible stored results (fewer moves than the optimum, gold above it) are shown corrected.
let progress = sanitizeLevels(loadProgress(storage), LEVELS);
setSoundEnabled(progress.soundOn);
migrateSoundPrefs(storage, progress.soundOn);
const launchAudio = typeof TivexaLaunchAudio !== "undefined"
    ? TivexaLaunchAudio.init({
        gameId: "sortwise",
        title: "Sortwise",
        chime: "audio/tivexa-chime.wav",
        music: "audio/sortwise-ambient.wav",
        musicVolume: 0.22,
        vibration: true,
        onBegin: () => afterBegin(),
    })
    : null;
window.__launchAudio = launchAudio;
/** Sound effects in the game and in the module are one setting (the saved soundOn). */
function setSfx(on) {
    progress = { ...progress, soundOn: on };
    setSoundEnabled(on);
    launchAudio?.setPref("sfx", on);
    persistProgress();
}
if (launchAudio && launchAudio.prefs.sfx !== progress.soundOn)
    launchAudio.setPref("sfx", progress.soundOn);
const begun = () => !launchAudio || launchAudio.core.begun;
/** After Begin: the banner (never over the launch screen) and the banner consent check (its form never over it either). */
function afterBegin() {
    void updateBanner();
    if (view.kind === "home")
        askBannerConsentOnce();
}
const bridge = window.Capacitor;
const durableStore = bridge?.isNativePlatform?.() && bridge.nativePromise ? bridge.nativePromise : null;
/** Save to both copies; the promise settles once the durable copy (if any) is written. */
function persistProgress() {
    saveProgress(storage, progress);
    return durableStore
        ? durableStore("ProgressStore", "set", { value: JSON.stringify(progress) }).then(() => { }, () => { })
        : Promise.resolve();
}
// ---------------------------------------------------------------------------------------------
// Optional rewarded ads (see ads.ts): only for an extra hint on a level whose hints are used up.
const ads = createAdsProvider(durableStore);
let adsState = { canRequestAds: false, privacyOptionsRequired: false };
/** The open play screen repaints its hint count when a reward is credited. */
let onHintsChanged = null;
/**
 * Update Google consent information and the ads state. Google's consent form (where required) is
 * shown only with showForm, i.e. when the player has asked for an ad.
 */
async function prepareAds(showForm = false) {
    if (!ads)
        return adsState;
    const before = adsState.privacyOptionsRequired;
    try {
        adsState = await ads.prepare(showForm);
    }
    catch {
        // Consent could not be checked: ads stay unavailable; the game is unaffected.
    }
    if (adsState.privacyOptionsRequired !== before && view.kind === "help")
        renderHelp();
    if (adsState.privacyOptionsRequired !== before && view.kind === "settings")
        renderSettings();
    return adsState;
}
// ----- the bottom banner (see ads.ts): only on the menus - chapter list, chapter screens and How
// to play (1.3.2). Never on a level, the tutorial or over a consent form.
let banner = NO_BANNER;
let bannerConsentAsked = false;
/** CSS px the banner currently takes from the game's view (0 when hidden). */
const bannerTakes = () => (banner.visible && banner.resizesView ? banner.heightDp + banner.gapDp : 0);
/** styles.css compacts every screen at max-height 640px. */
const SHORT_SCREEN = 640;
function bannerWanted() {
    if (view.kind === "tutorial" || view.kind === "level")
        return false;
    // Never let the banner switch a screen to its compact (short-phone) styling.
    const fullH = window.innerHeight + bannerTakes();
    if (fullH <= SHORT_SCREEN !== fullH - (banner.heightDp + banner.gapDp) <= SHORT_SCREEN)
        return false;
    return true; // chapter list, a chapter, How to play: scrolling pages with no gameplay
}
let bannerQueue = Promise.resolve();
/** Fix round 1 (review j1130 D2) diagnosis trace, read by the automated checks: every banner request with the screen it was made on. */
function traceBanner(why, asked, visible) {
    const w = window;
    (w.__bannerTrace ?? (w.__bannerTrace = [])).push({ t: Math.round(performance.now()), why, view: view.kind, asked, visible });
}
/** Bring the banner in line with the current screen (called on every screen change). */
function updateBanner() {
    if (!begun())
        return bannerQueue; // 1.3.5: no banner over the launch screen; afterBegin() brings it in
    bannerQueue = bannerQueue.then(async () => {
        if (!ads)
            return;
        try {
            if (!adsState.canRequestAds || view.kind === "tutorial" || view.kind === "level") {
                // fix round 1 (review j1130 D2): on a level or the tutorial always ask the native side to hide the banner, not only
                // when the cached state says it is visible (the cache could lag a native change); same placement rule as 1.3.4.
                if (banner.visible || view.kind === "level" || view.kind === "tutorial") {
                    banner = await ads.bannerSet(false);
                    traceBanner("hide", false, banner.visible);
                }
                return;
            }
            // Requested only on a menu page, where it is shown as soon as it arrives (never held hidden).
            banner = await ads.bannerPrepare();
            const wanted = bannerWanted();
            // The last decision and its inputs (read by the automated tests).
            window.__bannerDecision = {
                view: view.kind,
                ready: banner.ready,
                wanted,
                reserve: banner.heightDp + banner.gapDp,
                wasVisible: banner.visible,
                board: document.querySelector(".board-wrap") ? [document.querySelector(".board-wrap").clientWidth, document.querySelector(".board-wrap").clientHeight] : null,
            };
            banner = await ads.bannerSet(banner.ready && wanted);
            traceBanner("update", banner.ready && wanted, banner.visible);
            if (!banner.ready && wanted)
                revealWhenLoaded();
        }
        catch {
            // No banner; the game is unaffected.
        }
    });
    return bannerQueue;
}
let bannerWait = 0;
/**
 * Show a banner requested on a scrolling page (chapter list, chapter, How to play) as soon as it
 * has loaded, while the player is still on that page: Google expects a requested banner to be
 * displayed right away. These pages only gain a gap and the banner below them; nothing on them
 * moves or shrinks. Gives up after 30 s (offline, no fill) or when the screen changes, whose own
 * update then decides.
 */
function revealWhenLoaded() {
    const screen = view;
    const token = ++bannerWait;
    let tries = 0;
    const tick = () => {
        bannerQueue = bannerQueue.then(async () => {
            if (!ads || token !== bannerWait || view !== screen || !adsState.canRequestAds)
                return;
            try {
                banner = await ads.bannerPrepare();
                if (banner.ready) {
                    if (bannerWanted()) {
                        banner = await ads.bannerSet(true);
                        traceBanner("reveal", true, banner.visible);
                    }
                    return;
                }
            }
            catch {
                return;
            }
            if (++tries < 30)
                setTimeout(tick, 1000);
        });
    };
    setTimeout(tick, 1000);
}
/**
 * Banners need consent where the law requires it. Ask (Google's form, where required) the first
 * time the player reaches the chapter list each session - never during the tutorial.
 */
function askBannerConsentOnce() {
    // 1.3.5: Google's consent form (where required) comes only after Begin, never over the launch screen.
    if (!ads || bannerConsentAsked || adsState.canRequestAds || !begun())
        return;
    bannerConsentAsked = true;
    void prepareAds(true).then(() => updateBanner());
}
let claiming = Promise.resolve();
/**
 * Credit rewards the ad provider recorded, each reward id once, to the level it was earned on;
 * acknowledge them only after the progress holding the credit has been saved.
 */
function claimRewards() {
    claiming = claiming.then(async () => {
        if (!ads)
            return;
        try {
            const pending = await ads.pendingRewards();
            if (!pending.length)
                return;
            for (const r of pending)
                progress = creditReward(progress, r.id, r.levelKey);
            await persistProgress();
            await ads.ackRewards(pending.map((r) => r.id));
            onHintsChanged?.();
        }
        catch {
            // Left pending; claimed again on the next launch or resume.
        }
    });
    return claiming;
}
async function restoreDurableProgress() {
    if (!durableStore)
        return;
    try {
        const saved = (await durableStore("ProgressStore", "get"));
        const merged = sanitizeLevels(mergeProgress(progress, parseProgress(saved?.value ?? null)), LEVELS);
        const changed = JSON.stringify(merged.levels) !== JSON.stringify(progress.levels);
        progress = merged;
        if (launchAudio && launchAudio.prefs.sfx !== progress.soundOn)
            launchAudio.setPref("sfx", progress.soundOn); // 1.3.5: keep the mirror
        persistProgress();
        // The durable copy can show this is a returning player after all: don't keep them in the
        // first-play tutorial.
        if (view.kind === "tutorial" && view.from === "first" && !needsTutorial())
            goHome();
        else if (changed && view.kind === "home")
            renderHome();
        else if (changed && view.kind === "chapter")
            renderChapter(view.chapter);
        else if (changed && view.kind === "help")
            renderHelp();
    }
    catch {
        // The WebView copy remains in use.
    }
}
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
/**
 * Move focus to a screen's main button only for keyboard users; on touch screens a programmatic
 * focus ring looks like a stuck selection.
 */
let keyboardUser = false;
window.addEventListener("keydown", () => (keyboardUser = true), true);
window.addEventListener("pointerdown", () => (keyboardUser = false), true);
const focusForKeyboard = (target) => {
    if (keyboardUser)
        target?.focus({ preventScroll: true });
};
const root = document.getElementById("app");
// Screens are sized from the real viewport height. In the Android WebView, CSS dvh does not follow
// the view when it is resized (it shrinks to make room for the bottom banner), so it is tracked here.
const setAppHeight = () => document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
setAppHeight();
window.addEventListener("resize", setAppHeight);
// ---------------------------------------------------------------------------------------------
// Small DOM helpers
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
const SVG_NS = "http://www.w3.org/2000/svg";
function svg(viewBox, inner, className = "icon") {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", className);
    s.innerHTML = inner;
    return s;
}
/** Each kind has its own shape as well as colour, so nothing depends on colour alone. */
function glyph(kind) {
    const shapes = {
        A: '<circle cx="12" cy="12" r="7"/>',
        B: '<path d="M12 4.5 20 19H4z"/>',
        C: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
        D: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
    };
    return svg("0 0 24 24", shapes[kind], "glyph");
}
const ICONS = {
    lock: '<path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z"/>',
    check: '<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/>',
    soundOn: '<path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2zM18.6 6a8.5 8.5 0 0 1 0 12l-1.4-1.4a6.5 6.5 0 0 0 0-9.2z"/>',
    soundOff: '<path d="M4 9h4l5-4v14l-5-4H4zM16.3 9.7l1.4-1.4 2.3 2.3 2.3-2.3 1.4 1.4-2.3 2.3 2.3 2.3-1.4 1.4-2.3-2.3-2.3 2.3-1.4-1.4 2.3-2.3z"/>',
    back: '<path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/>',
    undo: '<path d="M8 7V3L2 9l6 6v-4h6a4 4 0 0 1 0 8h-3v2h3a6 6 0 0 0 0-12z"/>',
    restart: '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
    hint: '<path d="M9 21h6v-1.5H9zM12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z"/>',
    settings: '<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1L15 3.3h-4l-.3 2.6a7.5 7.5 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.5 7.5 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.5 7.5 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/>',
    help: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 17h-2v-2h2zm2.1-7.7-.9.9c-.7.7-1.2 1.3-1.2 2.8h-2v-.5c0-1.1.5-2.1 1.2-2.8l1.2-1.3c.4-.4.6-.9.6-1.4a2 2 0 0 0-4 0H8a4 4 0 0 1 8 0c0 .9-.4 1.7-.9 2.3z"/>',
};
function iconButton(icon, label, className = "icon-btn") {
    const b = el("button", className);
    b.type = "button";
    b.appendChild(svg("0 0 24 24", ICONS[icon]));
    b.appendChild(el("span", "btn-label", label));
    return b;
}
/** 1.3.5: any sound on (sound effects or music). */
const anySound = () => progress.soundOn || (launchAudio?.prefs.music ?? false);
/** The top-bar button: one tap mutes everything (music and sound effects) or turns both back on. */
function toggleSound() {
    const on = !anySound();
    setSfx(on);
    launchAudio?.setPref("music", on);
    play("select");
}
function soundButton() {
    const b = el("button", "icon-btn sound-btn");
    b.type = "button";
    // 1.3.5 fix round 1 (review j1130 D3): the label reflects the split state (Music / Sound effects); the tap still mutes
    // everything, or turns both back on when everything is off.
    const paint = () => {
        const on = anySound(), music = launchAudio?.prefs.music ?? progress.soundOn, sfx = progress.soundOn;
        const label = music && sfx ? "Sound on" : !music && !sfx ? "Sound off" : !music ? "Music off" : "Effects off";
        b.replaceChildren(svg("0 0 24 24", on ? ICONS.soundOn : ICONS.soundOff), el("span", "btn-label", label));
        b.setAttribute("aria-pressed", String(on));
        b.setAttribute("aria-label", on ? `${label}. Tap to mute all sound.` : "Sound off. Tap to turn music and sound effects on.");
    };
    b.addEventListener("click", () => {
        toggleSound();
        paint();
    });
    paint();
    return b;
}
let view = { kind: "home" };
const nativeShell = bridge?.isNativePlatform?.() === true;
/** The view one step up from the current one, or null at home. */
function parentView() {
    if (view.kind === "level")
        return { kind: "chapter", chapter: LEVELS[view.index].chapter };
    if (view.kind === "tutorial" && view.from === "help")
        return { kind: "help" };
    if (view.kind !== "home")
        return { kind: "home" };
    return null;
}
/** Android Back: step up one view. Returns false at home so the app can close. */
window.sortwiseHandleBack = () => {
    // Back with a confirmation dialog open cancels it and stays on the screen.
    if (cancelDialog) {
        cancelDialog();
        return true;
    }
    const up = parentView();
    if (!up)
        return false;
    go(up);
    return true;
};
window.addEventListener("popstate", () => {
    if (nativeShell)
        return;
    if (cancelDialog) {
        // The browser's Back cancels the dialog; keep the history entry for this (non-home) screen.
        cancelDialog();
        history.pushState({ sortwise: "away" }, "");
        return;
    }
    const up = parentView();
    if (up)
        go(up);
});
/** Show a view. In a browser, keep the single history entry in step with home / not home. */
function go(next) {
    cancelDialog?.();
    cleanupPlay?.();
    cleanupPlay = null;
    // However the tutorial is left - finished, skipped, Back - it is not offered automatically again.
    if (view.kind === "tutorial" && next.kind !== "tutorial")
        noteSeen("tutorial");
    view = next;
    if (!nativeShell && next.kind !== "home" && history.state?.sortwise !== "away") {
        history.pushState({ sortwise: "away" }, "");
    }
    if (next.kind === "home")
        renderHome();
    else if (next.kind === "help")
        renderHelp();
    else if (next.kind === "settings")
        renderSettings();
    else if (next.kind === "tutorial")
        renderPlay(null);
    else if (next.kind === "chapter")
        renderChapter(next.chapter);
    else
        renderPlay(next.index);
    void updateBanner();
    if (next.kind === "home")
        askBannerConsentOnce();
}
/** Return to the chapter list (in a browser, through history so its Back stays consistent). */
function goHome() {
    if (!nativeShell && history.state?.sortwise === "away") {
        if (view.kind === "tutorial")
            noteSeen("tutorial");
        cleanupPlay?.();
        cleanupPlay = null;
        view = { kind: "chapter", chapter: 0 }; // the popstate handler then lands on home
        history.back();
    }
    else
        go({ kind: "home" });
}
/** Leave the tutorial the way Back would: to How to play if it was opened there, else home. */
function leaveTutorial() {
    if (view.kind === "tutorial" && view.from === "help")
        go({ kind: "help" });
    else
        goHome();
}
const openLevel = (index) => go({ kind: "level", index });
const openChapter = (chapter) => go({ kind: "chapter", chapter });
const chapterLevels = (chapter) => LEVELS.map((l, i) => ({ l, i })).filter((x) => x.l.chapter === chapter);
const chapterStats = (chapter) => {
    const levels = chapterLevels(chapter);
    return chapterProgress(progress, LEVEL_KEYS, levels[0].i, levels.length);
};
/** "Chapter-position" label, e.g. "4-2". */
const levelLabel = (index) => {
    const l = LEVELS[index];
    return `${l.chapter}-${index - chapterLevels(l.chapter)[0].i + 1}`;
};
// ---------------------------------------------------------------------------------------------
// Home: chapter list
function medalBadge(medal) {
    const m = el("span", `medal medal-${medal}`);
    m.appendChild(el("span", "stars", MEDAL_STARS[medal]));
    m.appendChild(el("span", "medal-name", MEDAL_TEXT[medal]));
    return m;
}
function progressBar(done, total, label) {
    const bar = el("span", "bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(total));
    bar.setAttribute("aria-valuenow", String(done));
    bar.setAttribute("aria-label", label);
    const fill = el("span", "bar-fill");
    fill.style.width = `${(100 * done) / total}%`;
    bar.appendChild(fill);
    return bar;
}
function continueButton() {
    const next = nextLevelIndex(progress, LEVEL_KEYS);
    const done = LEVELS.filter((l) => progress.levels[l.key]).length;
    const cta = el("button", "primary cta");
    cta.type = "button";
    if (next !== null) {
        cta.textContent = done === 0 ? "Play" : `Continue: ${levelLabel(next)} ${LEVELS[next].name}`;
        cta.addEventListener("click", () => openLevel(next));
    }
    else {
        // 1.3.4 (D-unlocks): no Continue target once everything is solved; the button leads to the chapters.
        cta.textContent = "Replay a level";
        cta.addEventListener("click", () => {
            const first = root.querySelector(".chapter-card");
            first?.scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "auto" : "smooth" });
            first?.focus({ preventScroll: true });
        });
    }
    return cta;
}
function renderHome() {
    root.replaceChildren();
    const screen = el("div", "screen map-screen");
    const top = el("header", "topbar");
    top.appendChild(el("div", "brand", "Sortwise"));
    const settings = iconButton("settings", "Settings", "icon-btn settings-btn");
    settings.setAttribute("aria-label", "Settings");
    settings.addEventListener("click", () => go({ kind: "settings" }));
    top.appendChild(settings);
    top.appendChild(soundButton());
    screen.appendChild(top);
    const done = LEVELS.filter((l) => progress.levels[l.key]).length;
    const golds = LEVELS.filter((l) => progress.levels[l.key]?.medal === "gold").length;
    const summary = el("div", "summary");
    summary.appendChild(el("p", "map-intro", done === 0
        ? `Swap tiles to match the picture. ${LEVELS.length} puzzles, no timer.`
        : done === LEVELS.length
            ? `All ${LEVELS.length} solved · ${golds} gold`
            : `${done} of ${LEVELS.length} solved · ${golds} gold`));
    summary.appendChild(progressBar(done, LEVELS.length, `${done} of ${LEVELS.length} levels solved`));
    screen.appendChild(summary);
    const cta = continueButton();
    screen.appendChild(cta);
    const help = el("button", "secondary help-btn");
    help.type = "button";
    help.append(svg("0 0 24 24", ICONS.help), el("span", undefined, "How to play"));
    help.addEventListener("click", () => go({ kind: "help" }));
    screen.appendChild(help);
    const list = el("ol", "chapter-list");
    for (const ch of CHAPTERS) {
        const st = chapterStats(ch.number);
        const li = el("li");
        const b = el("button", `chapter-card${st.open ? "" : " is-locked"}${st.solved === st.total ? " is-done" : ""}`);
        b.type = "button";
        b.disabled = !st.open;
        b.appendChild(el("span", "chapter-num", String(ch.number)));
        const info = el("span", "chapter-info");
        info.appendChild(el("span", "chapter-title", ch.title));
        if (st.open) {
            info.appendChild(el("span", "chapter-blurb", ch.blurb));
            const meta = el("span", "chapter-meta");
            meta.appendChild(progressBar(st.solved, st.total, `${st.solved} of ${st.total} solved`));
            meta.appendChild(el("span", "chapter-count", `${st.solved}/${st.total}${st.gold ? ` · ${st.gold} gold` : ""}`));
            info.appendChild(meta);
        }
        else {
            const l = el("span", "node-status");
            l.appendChild(svg("0 0 24 24", ICONS.lock, "icon tiny"));
            l.appendChild(document.createTextNode(` Finish chapter ${ch.number - 1} to open`));
            info.appendChild(l);
        }
        b.appendChild(info);
        b.setAttribute("aria-label", `Chapter ${ch.number}, ${ch.title}. ` + (st.open ? `${st.solved} of ${st.total} solved, ${st.gold} gold.` : "Locked."));
        if (st.open)
            b.addEventListener("click", () => openChapter(ch.number));
        li.appendChild(b);
        list.appendChild(li);
    }
    screen.appendChild(list);
    screen.appendChild(el("p", "fineprint", "Free, plays offline, no account. Ads: a banner at the bottom of the menu screens (never during a puzzle), and optional ads for extra hints. Progress is saved only on this device."));
    root.appendChild(screen);
    window.scrollTo(0, 0);
    focusForKeyboard(cta);
}
// ---------------------------------------------------------------------------------------------
// How to play: the rules in brief, and the tutorial again
function medalGuide() {
    const list = el("ul", "medal-guide");
    const rows = [
        ["gold", "Gold: the fewest possible moves, no hint."],
        ["silver", "Silver: within the silver move count, hints allowed."],
        ["bronze", "Bronze: any solve."],
    ];
    for (const [medal, text] of rows) {
        const li = el("li");
        li.append(el("span", `stars medal-${medal}`, MEDAL_STARS[medal]), document.createTextNode(` ${text}`));
        list.appendChild(li);
    }
    return list;
}
// Brand (game-studio/brand/tivexa.json): TIVEXA is the studio; 2852483 Alberta Inc. stays the legal
// publisher. 1.3.6 (relays 0071/0072/0074/0078): the canonical tivexa.games pages; players only ever see the labels.
const PRIVACY_URL = "https://tivexa.games/sortwise/privacy/";
const TERMS_URL = "https://tivexa.games/terms/";
const SUPPORT_URL = "https://tivexa.games/support/";
const SUPPORT_EMAIL = "admin.tivexa@protonmail.com";
function link(href, text) {
    const a = el("a", "help-link", text);
    a.href = href;
    return a;
}
/** Google's privacy options form, offered only where the player's region requires it (else null). */
function privacyChoicesButton(className = "secondary privacy-choices") {
    if (!adsState.privacyOptionsRequired || !ads)
        return null;
    const provider = ads;
    const choices = el("button", className, "Privacy choices");
    choices.type = "button";
    choices.addEventListener("click", async () => {
        choices.disabled = true;
        try {
            adsState = await provider.showPrivacyOptions();
        }
        catch {
            // The form could not open (for example offline); nothing changes.
        }
        choices.disabled = false;
    });
    return choices;
}
/**
 * The privacy policy in brief, readable offline, with the full policy and the support address.
 * In the Android app, links to other sites open outside the app (Capacitor hands them to the system).
 */
function privacyAndSupport() {
    const s = el("section", "help-section privacy-section");
    s.appendChild(el("h2", undefined, "Privacy policy"));
    // QA sortwise-j292 D1 and review 918 D2: must match the Play Data safety declaration (the AdMob SDK
    // collects data on the app's behalf, including approximate location from the IP address).
    const choices = privacyChoicesButton();
    for (const para of PRIVACY_PARAGRAPHS) {
        if (para.onlyWithChoices && !choices)
            continue;
        const p = el("p");
        if (para.lead)
            p.append(el("strong", undefined, para.lead), document.createTextNode(" "));
        p.append(document.createTextNode(para.text));
        s.appendChild(p);
        if (para.onlyWithChoices && choices)
            s.appendChild(choices);
    }
    const full = el("p");
    full.append(document.createTextNode("Full policy: "), link(PRIVACY_URL, "Tivexa Privacy Policy"), document.createTextNode("."));
    s.appendChild(full);
    s.appendChild(el("h2", undefined, "Tivexa Support"));
    const mail = el("p");
    mail.append(document.createTextNode("Questions or problems: "), link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL));
    s.appendChild(mail);
    return s;
}
function renderHelp() {
    root.replaceChildren();
    const screen = el("div", "screen help-screen");
    const top = el("header", "topbar");
    const back = iconButton("back", "Chapters");
    back.setAttribute("aria-label", "Back to chapters");
    back.addEventListener("click", goHome);
    top.appendChild(back);
    const title = el("div", "level-title");
    title.appendChild(el("h1", "level-name", "How to play"));
    top.appendChild(title);
    top.appendChild(soundButton());
    screen.appendChild(top);
    const section = (heading, ...body) => {
        const s = el("section", "help-section");
        s.appendChild(el("h2", undefined, heading));
        for (const b of body)
            s.appendChild(typeof b === "string" ? el("p", undefined, b) : b);
        screen.appendChild(s);
    };
    section("Goal", "Make the board match the target picture.");
    section("Swapping", "Tap a tile, then a tile touching it - up, down, left or right - to swap them. You can also drag a tile onto its neighbour. A tick marks a tile that matches the target.");
    section("Medals", medalGuide());
    section("Undo and Restart", "Undo takes back a move; Restart starts the level again. Both are free: only the moves on the counter when you finish count.");
    section("Hint", "Hint shows a good next move - that attempt can then earn Silver at most.", `Each level has ${FREE_HINTS_PER_LEVEL} free hints of its own. They don't come back when you restart, replay or come back later, and other levels keep their own.`, "When a level's hints are used up, you can watch an optional ad to earn 1 more hint for that level. That ad is only shown when you ask for it, and you can always keep playing without one.");
    const met = MECHANICS.filter(ruleMet);
    if (met.length)
        section("Rules you've met", ...met.map((m) => `${RULES[m].title}: ${RULES[m].text}`));
    if (met.length < MECHANICS.length)
        screen.appendChild(el("p", "fineprint", "More rules appear as you play."));
    const replay = el("button", "primary cta", "Replay the tutorial");
    replay.type = "button";
    replay.addEventListener("click", () => go({ kind: "tutorial", from: "help" }));
    screen.appendChild(replay);
    screen.appendChild(privacyAndSupport());
    root.appendChild(screen);
    window.scrollTo(0, 0);
    focusForKeyboard(replay);
}
// ---------------------------------------------------------------------------------------------
// Settings (1.3.4): sound, How to play, privacy choices where required, the version, and reset.
// 1.3.5: Music, Sound effects and Vibration switches (the shared launch/audio module's preferences).
function renderSettings() {
    root.replaceChildren();
    const screen = el("div", "screen help-screen settings-screen");
    const top = el("header", "topbar");
    const back = iconButton("back", "Chapters");
    back.setAttribute("aria-label", "Back to chapters");
    back.addEventListener("click", goHome);
    top.appendChild(back);
    const title = el("div", "level-title");
    title.appendChild(el("h1", "level-name", "Settings"));
    top.appendChild(title);
    screen.appendChild(top);
    const list = el("div", "settings-list");
    const row = (className, label) => {
        const b = el("button", `secondary settings-row ${className}`);
        b.type = "button";
        b.appendChild(el("span", "settings-label", label));
        list.appendChild(b);
        return b;
    };
    const switchRow = (className, label, get, set) => {
        const b = row(className, label);
        b.setAttribute("role", "switch");
        const state = el("span", "settings-state");
        b.appendChild(state);
        const paint = () => {
            b.setAttribute("aria-checked", String(get()));
            state.textContent = get() ? "On" : "Off";
        };
        b.addEventListener("click", () => {
            set(!get());
            paint();
        });
        paint();
        return b;
    };
    const music = launchAudio ? switchRow("music-switch", "Music", () => launchAudio.prefs.music, (on) => launchAudio.setPref("music", on)) : null;
    const sound = switchRow("sound-switch", "Sound effects", () => progress.soundOn, (on) => {
        setSfx(on);
        play("select");
    });
    if (launchAudio)
        switchRow("vibration-switch", "Vibration", () => launchAudio.prefs.vibration !== false, (on) => {
            launchAudio.setPref("vibration", on);
            if (on)
                launchAudio.vibrate(20);
        });
    row("how-to-play", "How to play").addEventListener("click", () => go({ kind: "help" }));
    // 1.3.6 (RC_COMMON R7 IN-APP LINKS): labelled rows, no raw URL text; they open the external browser
    // (in the Android app Capacitor hands other sites to the system).
    const linkRow = (className, label, href) => {
        const a = el("a", `secondary settings-row settings-link ${className}`);
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener";
        a.appendChild(el("span", "settings-label", label));
        a.appendChild(el("span", "settings-state", "↗"));
        list.appendChild(a);
        return a;
    };
    linkRow("privacy-link", "Privacy policy", PRIVACY_URL);
    linkRow("terms-link", "Terms", TERMS_URL);
    linkRow("support-link", "Support", SUPPORT_URL);
    const choices = privacyChoicesButton("secondary settings-row privacy-choices");
    if (choices)
        list.appendChild(choices);
    list.appendChild(el("p", "settings-version", `Sortwise ${APP_VERSION.name} (${APP_VERSION.code})`));
    const reset = row("danger reset-progress", "Reset all progress");
    reset.addEventListener("click", () => confirmReset(reset));
    screen.appendChild(list);
    root.appendChild(screen);
    window.scrollTo(0, 0);
    focusForKeyboard(music ?? sound);
}
/** The open confirmation dialog's Cancel, for Android Back and the browser's Back (null when none is open). */
let cancelDialog = null;
/**
 * One alertdialog over the screen: focus starts on Cancel and stays inside; Escape, Back and Cancel
 * all cancel. Resolves true only when the confirm button is pressed.
 */
function askDialog(titleText, bodyText, confirmText, returnFocus) {
    return new Promise((resolve) => {
        const backdrop = el("div", "dialog-backdrop");
        const box = el("div", "dialog");
        box.setAttribute("role", "alertdialog");
        box.setAttribute("aria-modal", "true");
        const title = el("h2", "dialog-title", titleText);
        title.id = "dialog-title";
        const body = el("p", "dialog-body", bodyText);
        body.id = "dialog-body";
        box.setAttribute("aria-labelledby", title.id);
        box.setAttribute("aria-describedby", body.id);
        const actions = el("div", "dialog-actions");
        const cancel = el("button", "secondary dialog-cancel", "Cancel");
        cancel.type = "button";
        const confirm = el("button", "secondary danger dialog-confirm", confirmText);
        confirm.type = "button";
        actions.append(cancel, confirm);
        box.append(title, body, actions);
        backdrop.appendChild(box);
        const close = (ok) => {
            cancelDialog = null;
            document.removeEventListener("keydown", onKey, true);
            backdrop.remove();
            if (!ok)
                returnFocus.focus({ preventScroll: true });
            resolve(ok);
        };
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                close(false);
            }
            else if (e.key === "Tab") {
                // Keep focus on the two buttons.
                e.preventDefault();
                (document.activeElement === cancel ? confirm : cancel).focus();
            }
        };
        cancel.addEventListener("click", () => close(false));
        confirm.addEventListener("click", () => close(true));
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop)
                close(false);
        });
        document.addEventListener("keydown", onKey, true);
        cancelDialog = () => close(false);
        root.appendChild(backdrop);
        cancel.focus({ preventScroll: true });
    });
}
/**
 * "Reset all progress" (plan item 3, sortwise-qa/plan-1.3.4/RESET_DIALOGS.md; owner: the final
 * button reads "Reset all progress"). Two confirmations; nothing is written before the second.
 * Both saved copies are written before the game moves on, and the tutorial then starts.
 */
async function confirmReset(from) {
    const first = await askDialog("Reset all progress?", `This erases your solved levels, medals, best moves, hints used and earned, the puzzle you are working on, and the introductions you've seen. Every level goes back to its ${FREE_HINTS_PER_LEVEL} free hints. Your sound setting and privacy choices stay.`, "Reset…", from);
    if (!first || view.kind !== "settings")
        return;
    const second = await askDialog("Reset now?", "This can't be undone.", "Reset all progress", from);
    if (!second || view.kind !== "settings")
        return;
    progress = resetProgress(progress);
    await persistProgress();
    go({ kind: "tutorial", from: "first" });
}
// ---------------------------------------------------------------------------------------------
// One chapter: its levels
function renderChapter(chapter) {
    root.replaceChildren();
    const ch = CHAPTERS[chapter - 1];
    const screen = el("div", "screen map-screen");
    const top = el("header", "topbar");
    const back = iconButton("back", "Chapters");
    back.setAttribute("aria-label", "Back to chapters");
    back.addEventListener("click", goHome);
    top.appendChild(back);
    const title = el("div", "level-title");
    title.appendChild(el("span", "level-num", `Chapter ${ch.number}`));
    title.appendChild(el("h1", "level-name", ch.title));
    top.appendChild(title);
    top.appendChild(soundButton());
    screen.appendChild(top);
    const st = chapterStats(chapter);
    const summary = el("div", "summary");
    summary.appendChild(el("p", "map-intro", `${ch.blurb} ${st.solved}/${st.total} solved · ${st.gold} gold`));
    summary.appendChild(progressBar(st.solved, st.total, `${st.solved} of ${st.total} solved`));
    screen.appendChild(summary);
    const levels = chapterLevels(chapter);
    const next = nextLevelIndex(progress, LEVEL_KEYS);
    const list = el("ol", "level-path");
    let focusTarget = null;
    for (const { l: lv, i } of levels) {
        const li = el("li", "level-node-wrap");
        const open = isUnlocked(progress, LEVEL_KEYS, i);
        const rec = progress.levels[lv.key];
        const b = el("button", `level-node${open ? "" : " is-locked"}${i === next ? " is-next" : ""}`);
        b.type = "button";
        b.disabled = !open;
        b.dataset.index = String(i);
        b.appendChild(el("span", "node-num", String(i - levels[0].i + 1)));
        const info = el("span", "node-info");
        info.appendChild(el("span", "node-name", lv.name));
        if (rec)
            info.appendChild(medalBadge(rec.medal));
        else if (!open) {
            const l = el("span", "node-status");
            l.appendChild(svg("0 0 24 24", ICONS.lock, "icon tiny"));
            l.appendChild(document.createTextNode(" Locked"));
            info.appendChild(l);
        }
        else
            info.appendChild(el("span", "node-status", i === next ? "Up next" : "Open"));
        b.appendChild(info);
        b.setAttribute("aria-label", `Level ${levelLabel(i)}, ${lv.name}. ` +
            (rec ? `${MEDAL_TEXT[rec.medal]} medal, best ${plural(rec.bestMoves, "move")}.` : open ? "Not solved yet." : "Locked."));
        if (open)
            b.addEventListener("click", () => openLevel(i));
        if (i === next || (!focusTarget && open))
            focusTarget = b;
        li.appendChild(b);
        list.appendChild(li);
    }
    screen.appendChild(list);
    const nextCh = CHAPTERS[chapter];
    if (nextCh && st.solved === st.total) {
        const n = el("button", "primary cta", `Next chapter: ${nextCh.title}`);
        n.type = "button";
        n.addEventListener("click", () => openChapter(nextCh.number));
        screen.appendChild(n);
        focusTarget = n;
    }
    root.appendChild(screen);
    window.scrollTo(0, 0);
    focusForKeyboard(focusTarget);
}
// ---------------------------------------------------------------------------------------------
// Play screen
let cleanupPlay = null;
/** 1.3.4: saves the open level's puzzle in progress (used when the app goes to the background). */
let saveOpenAttempt = null;
/**
 * The play screen. `index` is a campaign level; null is the tutorial: the same board and rules
 * on TUTORIAL_LEVEL, with a coach that guides the first moves and records nothing.
 */
function renderPlay(index) {
    cleanupPlay?.();
    const tutorial = index === null;
    const level = tutorial ? TUTORIAL_LEVEL : LEVELS[index];
    let state = newGame(level);
    // 1.3.4: the puzzle in progress survives the app being killed. `path` is the swaps behind the
    // current undo history; replaying it rebuilds the board. A record that no longer replays is dropped.
    let path = [];
    let resumed = false;
    const saved = tutorial ? undefined : progress.current;
    if (saved && saved.levelKey === level.key) {
        const restored = replayAttempt(level, saved);
        if (restored) {
            state = restored;
            path = saved.path.map(([a, b]) => [a, b]);
            resumed = path.length > 0 || restored.hintsUsed > 0;
        }
        else {
            progress = clearCurrent(progress);
            persistProgress();
        }
    }
    /** Write the attempt to both saved copies at once (localStorage now, the native copy right after). */
    const saveAttempt = () => {
        if (tutorial || solved)
            return;
        progress = setCurrent(progress, level.key, path, state.hintsUsed);
        void persistProgress();
    };
    let selected = null;
    let hintPair = null;
    let solved = false;
    const timers = [];
    let disposed = false;
    const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));
    /**
     * While a coach step is guiding, it decides which taps and swaps count. Anything else gets a
     * gentle pointer back to the highlighted tiles instead of a move.
     */
    let guide = {};
    root.replaceChildren();
    const screen = el("div", `screen play-screen${tutorial ? " tutorial-screen" : ""}`);
    // Top bar
    const top = el("header", "topbar");
    if (tutorial) {
        const skip = iconButton("back", "Skip");
        skip.setAttribute("aria-label", "Skip the tutorial");
        skip.classList.add("skip-btn");
        skip.addEventListener("click", leaveTutorial);
        top.appendChild(skip);
    }
    else {
        const mapBtn = iconButton("back", "Levels");
        mapBtn.setAttribute("aria-label", `Back to chapter ${level.chapter} levels`);
        mapBtn.addEventListener("click", () => openChapter(level.chapter));
        top.appendChild(mapBtn);
    }
    const title = el("div", "level-title");
    title.appendChild(el("span", "level-num", tutorial ? "Tutorial" : `Level ${levelLabel(index)}`));
    title.appendChild(el("h1", "level-name", level.name));
    top.appendChild(title);
    top.appendChild(soundButton());
    screen.appendChild(top);
    // The tip line; a coach card takes its place while the tutorial or a new rule is explained.
    const tipEl = el("p", "tip", level.tip);
    const coach = el("section", "coach");
    coach.setAttribute("aria-live", "polite");
    coach.hidden = true;
    tipEl.hidden = tutorial;
    screen.append(tipEl, coach);
    // Target + stats
    const info = el("section", "info-row");
    const targetCard = el("figure", "target-card");
    const targetGrid = el("div", "target-grid");
    targetGrid.style.gridTemplateColumns = `repeat(${state.board.cols}, 1fr)`;
    targetGrid.setAttribute("role", "img");
    targetGrid.setAttribute("aria-label", describeTarget(state));
    state.board.target.forEach((k) => {
        const c = el("span", k ? `t-cell kind-${k}` : "t-cell hole");
        if (k)
            c.appendChild(glyph(k));
        targetGrid.appendChild(c);
    });
    targetCard.appendChild(targetGrid);
    targetCard.appendChild(el("figcaption", undefined, "Target"));
    info.appendChild(targetCard);
    const stats = el("div", "stats");
    const movesEl = el("div", "moves");
    const movesNum = el("span", "moves-num", "0");
    const movesLabel = el("span", "moves-label", " moves");
    movesEl.append(movesNum, movesLabel);
    stats.appendChild(movesEl);
    const goals = el("ul", "goals");
    const goldGoal = el("li", "goal goal-gold");
    goldGoal.append(el("span", "stars", "★★★"), document.createTextNode(` ${plural(level.optimal, "move")} (perfect)`));
    const silverGoal = el("li", "goal goal-silver");
    silverGoal.append(el("span", "stars", "★★☆"), document.createTextNode(` ${silverFor(level)} or fewer`));
    const bronzeGoal = el("li", "goal goal-bronze");
    bronzeGoal.append(el("span", "stars", "★☆☆"), document.createTextNode(" any solve"));
    goals.append(goldGoal, silverGoal, bronzeGoal);
    stats.appendChild(goals);
    // QA sortwise-j292 D3: the Best line is refreshed when the level is solved (renderBest below), not only on reopen.
    const bestLine = el("div", "best");
    const renderBest = () => {
        const best = tutorial ? undefined : progress.levels[level.key];
        bestLine.textContent = best ? `Best: ${plural(best.bestMoves, "move")} · ${MEDAL_TEXT[best.medal]}` : "";
        bestLine.hidden = !best;
    };
    renderBest();
    stats.appendChild(bestLine);
    info.appendChild(stats);
    screen.appendChild(info);
    // Board
    const boardWrap = el("section", "board-wrap");
    const board = el("div", "board");
    board.setAttribute("role", "grid");
    board.setAttribute("aria-label", "Puzzle board");
    // Empty-cell backgrounds live in their own layer under every tile. (In 0.2.0 they were
    // interleaved with the tiles, so a tile that moved to a later cell sat under that cell's slot
    // and real taps hit the slot instead of the tile.)
    const slotLayer = el("div", "slot-layer");
    board.appendChild(slotLayer);
    const slotEls = [];
    const tileEls = new Map();
    state.board.cells.forEach((cell, i) => {
        const slot = el("div", cell ? "slot" : "slot hole");
        slotEls[i] = slot;
        slotLayer.appendChild(slot);
        if (!cell)
            return;
        const t = el("button", `tile kind-${cell.kind}`);
        t.type = "button";
        t.dataset.id = String(cell.id);
        t.appendChild(glyph(cell.kind));
        const lockBadge = el("span", "badge lock-badge");
        lockBadge.appendChild(svg("0 0 24 24", ICONS.lock));
        const okBadge = el("span", "badge ok-badge");
        okBadge.appendChild(svg("0 0 24 24", ICONS.check));
        t.append(lockBadge, okBadge);
        tileEls.set(cell.id, t);
        board.appendChild(t);
    });
    boardWrap.appendChild(board);
    screen.appendChild(boardWrap);
    const message = el("p", "message");
    message.setAttribute("aria-live", "polite");
    screen.appendChild(message);
    // Actions
    const actions = el("nav", "actions");
    const undoBtn = iconButton("undo", "Undo", "action-btn");
    const restartBtn = iconButton("restart", "Restart", "action-btn");
    const hintBtn = iconButton("hint", "Hint", "action-btn");
    hintBtn.classList.add("hint-btn");
    actions.append(undoBtn, restartBtn, hintBtn);
    screen.appendChild(actions);
    // Shown when this level's hints are used up: the optional rewarded ad.
    const adPanel = el("section", "ad-offer");
    adPanel.hidden = true;
    adPanel.setAttribute("role", "dialog");
    adPanel.setAttribute("aria-modal", "false");
    adPanel.setAttribute("aria-labelledby", "ad-title");
    screen.appendChild(adPanel);
    const winPanel = el("section", "win-panel");
    winPanel.hidden = true;
    winPanel.setAttribute("role", "dialog");
    winPanel.setAttribute("aria-modal", "false");
    winPanel.setAttribute("aria-labelledby", "win-title");
    screen.appendChild(winPanel);
    root.appendChild(screen);
    // ----- layout
    let cell = 64;
    const GAP = 6;
    function layout() {
        const { rows, cols } = state.board;
        cell = fitCell(boardWrap.clientWidth, boardWrap.clientHeight, rows, cols, GAP);
        board.style.width = `${cols * cell + (cols - 1) * GAP}px`;
        board.style.height = `${rows * cell + (rows - 1) * GAP}px`;
        board.style.setProperty("--cell", `${cell}px`);
        slotEls.forEach((s, i) => (s.style.transform = cellTransform(i)));
        // Re-layout (rotation, resize) should snap tiles into place, not slide them.
        board.classList.add("no-anim");
        paint();
        void board.offsetWidth;
        board.classList.remove("no-anim");
    }
    function cellTransform(i) {
        const { x, y } = cellOrigin({ rows: state.board.rows, cols: state.board.cols, cell, gap: GAP }, i);
        return `translate(${x}px, ${y}px)`;
    }
    // ----- painting
    /** Board cells whose tiles (or gaps) the coach is pointing at. */
    let spotCells = [];
    let spotEls = [];
    function spot(cells, els = []) {
        spotEls.forEach((e) => e.classList.remove("spot"));
        spotCells = cells;
        spotEls = els;
        els.forEach((e) => e.classList.add("spot"));
        slotEls.forEach((s, i) => s.classList.toggle("spot", cells.includes(i) && s.classList.contains("hole")));
        paint();
    }
    function paint() {
        const b = state.board;
        const touchSel = selected !== null ? new Set(b.neighbours[selected]) : null;
        b.cells.forEach((tile, i) => {
            if (!tile)
                return;
            const t = tileEls.get(tile.id);
            t.style.transform = cellTransform(i);
            const correct = isCorrect(b, b.cells, i);
            const canTarget = touchSel?.has(i) && !tile.locked && !b.cells[selected]?.locked && (!guide.allowSwap || guide.allowSwap(selected, i));
            const spotted = spotCells.includes(i);
            t.classList.toggle("is-locked", tile.locked);
            t.classList.toggle("is-correct", correct);
            t.classList.toggle("is-selected", selected === i);
            t.classList.toggle("can-swap", !!canTarget);
            t.classList.toggle("is-hint", hintPair !== null && hintPair.includes(i));
            t.classList.toggle("spot", spotted);
            t.dataset.cell = String(i);
            t.disabled = solved;
            const r = Math.floor(i / b.cols) + 1;
            const c = (i % b.cols) + 1;
            t.setAttribute("aria-label", `${KIND_NAMES[tile.kind]} at row ${r}, column ${c}` +
                (tile.locked ? ", locked" : "") +
                (correct ? ", in place" : `, should be ${KIND_NAMES[b.target[i]]}`) +
                (selected === i ? ", selected" : "") +
                (spotted ? ", highlighted" : ""));
        });
        movesNum.textContent = String(state.moves);
        movesLabel.textContent = state.moves === 1 ? " move" : " moves";
        const m = state.moves;
        goldGoal.classList.toggle("missed", m > level.optimal || state.hintsUsed > 0);
        silverGoal.classList.toggle("missed", m > silverFor(level));
        undoBtn.disabled = solved || state.history.length <= 1;
        restartBtn.disabled = solved || state.moves === 0;
        hintBtn.disabled = solved || guide.allowTap !== undefined || !adPanel.hidden;
        if (tutorial) {
            // The tutorial's hints are a demonstration and use none of a level's hints.
            hintBtn.querySelector(".btn-label").textContent = state.hintsUsed > 0 ? `Hint (${state.hintsUsed})` : "Hint";
        }
        else {
            const left = hintsLeft(progress, level.key);
            hintBtn.querySelector(".btn-label").textContent = `Hint · ${left} left`;
            hintBtn.setAttribute("aria-label", left > 0 ? `Hint. ${plural(left, "hint")} left on this level.` : "Hint. No hints left on this level: watch an ad to earn 1 hint.");
            hintBtn.classList.toggle("is-empty", left === 0);
        }
    }
    function say(text) {
        message.textContent = text;
    }
    function showCoach(heading, text, buttons) {
        coach.replaceChildren();
        coach.setAttribute("aria-label", tutorial ? "Tutorial" : "New rule");
        if (heading)
            coach.appendChild(el("p", "coach-title", heading));
        coach.appendChild(el("p", "coach-text", text));
        if (buttons.length) {
            const row = el("div", "coach-actions");
            for (const b of buttons) {
                const btn = el("button", b.primary ? "primary small" : "secondary small", b.label);
                btn.type = "button";
                btn.addEventListener("click", b.onClick);
                row.appendChild(btn);
            }
            coach.appendChild(row);
            focusForKeyboard(row.firstElementChild);
        }
        coach.hidden = false;
        tipEl.hidden = true;
    }
    function hideCoach() {
        coach.hidden = true;
        tipEl.hidden = tutorial;
        spot([]);
    }
    function flash(i, cls) {
        const tile = state.board.cells[i];
        if (!tile)
            return;
        const t = tileEls.get(tile.id);
        t.classList.remove(cls);
        void t.offsetWidth; // restart the animation
        t.classList.add(cls);
        later(() => t.classList.remove(cls), 600);
    }
    function lockedFeedback(i) {
        const b = state.board;
        const wrong = b.neighbours[i].filter((j) => !isCorrect(b, b.cells, j));
        play("deny");
        flash(i, "shake");
        wrong.forEach((j) => flash(j, "needs-fix"));
        say(`Locked. ${wrong.length === 1 ? "1 touching tile still needs" : `${wrong.length} touching tiles still need`} ` +
            "to match the target to open it.");
    }
    function nudge() {
        play("deny");
        say(guide.nudge ?? "Tap the highlighted tile.");
    }
    // ----- moves
    function trySwap(a, bIdx) {
        if (guide.allowSwap && !guide.allowSwap(a, bIdx)) {
            nudge();
            return false;
        }
        const err = checkSwap(state.board, a, bIdx);
        if (err) {
            if (err.reason === "locked") {
                lockedFeedback(state.board.cells[a]?.locked ? a : bIdx);
            }
            else if (err.reason === "not-touching") {
                play("deny");
                say("Only touching tiles swap: up, down, left or right.");
            }
            return false;
        }
        const result = applySwap(state, a, bIdx);
        state = result.state;
        path.push([a, bIdx]);
        selected = null;
        hintPair = null;
        play("swap");
        say("");
        if (result.unlocked.length > 0) {
            later(() => {
                play("unlock");
                for (const id of result.unlocked) {
                    const t = tileEls.get(id);
                    t.classList.add("unlocking");
                    later(() => t.classList.remove("unlocking"), 700);
                }
                say(result.unlocked.length === 1 ? "Unlocked! That tile can move now." : "Unlocked! Those tiles can move now.");
            }, 140);
        }
        paint();
        if (isSolved(state.board))
            finish();
        else {
            saveAttempt();
            guide.onSwap?.();
        }
        return true;
    }
    function onTap(i) {
        if (solved)
            return;
        const tile = state.board.cells[i];
        if (!tile)
            return;
        if (guide.allowTap && !guide.allowTap(i))
            return nudge();
        if (selected === null) {
            if (tile.locked)
                return lockedFeedback(i);
            selected = i;
            hintPair = null;
            play("select");
            say(firstTimeHelp());
            paint();
            guide.onSelect?.(i);
            return;
        }
        if (selected === i) {
            selected = null;
            say("");
            paint();
            guide.onDeselect?.();
            return;
        }
        if (trySwap(selected, i))
            return;
        // Not a legal swap: make the tapped tile the new selection when it can move (forgiving).
        if (!tile.locked && !state.board.neighbours[selected].includes(i) && !guide.allowSwap) {
            selected = i;
            play("select");
        }
        paint();
    }
    function firstTimeHelp() {
        return !tutorial && state.moves === 0 && level.id <= 2 ? "Now tap a highlighted tile next to it." : "";
    }
    /**
     * The cell under a screen point, worked out from board geometry rather than from which DOM
     * element received the event, so overlays, badges or animation layers can never swallow a tap.
     * Taps in the gaps between tiles snap to the nearest cell. A tile still animating is drawn away
     * from its cell, so it is matched first: a tap always acts on the tile the player sees there.
     */
    function cellAt(clientX, clientY) {
        const moving = [];
        for (const t of tileEls.values()) {
            if (!t.getAnimations?.().some((a) => a.transitionProperty === "transform"))
                continue;
            const r = t.getBoundingClientRect();
            moving.push({ cell: Number(t.dataset.cell), left: r.left, top: r.top, width: r.width, height: r.height });
        }
        const drawn = movingTileAt(moving, clientX, clientY);
        if (drawn !== null)
            return drawn;
        const rect = board.getBoundingClientRect();
        const { rows, cols } = state.board;
        const i = cellAtPoint({ rows, cols, cell, gap: GAP }, clientX - rect.left, clientY - rect.top);
        return i !== null && state.board.cells[i] ? i : null;
    }
    // Pointer input: tap-tap, or press and drag towards a neighbour. Taps are handled on
    // pointerup; a click that arrives without a handled pointerup (some WebViews cancel the pointer
    // sequence) is used as a fallback so a tap is never lost.
    let drag = null;
    let lastPointerTap = -Infinity;
    // QA sortwise-j299 D1: a press whose pointer sequence the browser cancels (pointercancel) is still a tap. Its own
    // click must be honoured even if another tap was handled less than 700 ms before; otherwise fast play could lose it.
    let cancelledTap = null;
    board.addEventListener("pointerdown", (e) => {
        cancelledTap = null; // a new press supersedes a cancelled one whose click never came
        if (solved || (e.pointerType === "mouse" && e.button !== 0))
            return;
        const i = cellAt(e.clientX, e.clientY);
        if (i === null)
            return;
        drag = { i, x: e.clientX, y: e.clientY, moved: false, pointer: e.pointerId };
    });
    board.addEventListener("pointermove", (e) => {
        if (!drag || drag.moved || e.pointerId !== drag.pointer)
            return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        const threshold = Math.max(18, cell * 0.3);
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold)
            return;
        drag.moved = true;
        const { rows, cols } = state.board;
        const r = Math.floor(drag.i / cols);
        const c = drag.i % cols;
        const [nr, nc] = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols)
            return;
        const j = nr * cols + nc;
        if (!state.board.cells[j])
            return;
        lastPointerTap = performance.now(); // a drag-swap must not also be read as a tap
        if (state.board.cells[drag.i]?.locked)
            return lockedFeedback(drag.i);
        trySwap(drag.i, j);
    });
    board.addEventListener("pointerup", (e) => {
        if (!drag || e.pointerId !== drag.pointer)
            return;
        const { moved, i } = drag;
        drag = null;
        if (moved)
            return;
        lastPointerTap = performance.now();
        onTap(i);
    });
    board.addEventListener("pointercancel", (e) => {
        if (drag && e.pointerId === drag.pointer) {
            if (!drag.moved)
                cancelledTap = { i: drag.i, at: performance.now() };
            drag = null;
        }
    });
    board.addEventListener("click", (e) => {
        if (e.detail === 0) {
            // Keyboard activation (Enter/Space) on a focused tile.
            const t = e.target.closest(".tile");
            if (t)
                onTap(Number(t.dataset.cell));
            return;
        }
        if (cancelledTap && performance.now() - cancelledTap.at < 700) {
            const i = cellAt(e.clientX, e.clientY) ?? cancelledTap.i;
            cancelledTap = null;
            lastPointerTap = performance.now();
            onTap(i);
            return;
        }
        if (performance.now() - lastPointerTap < 700)
            return; // already handled on pointerup
        const i = cellAt(e.clientX, e.clientY);
        if (i !== null)
            onTap(i);
    });
    // Keyboard: arrow keys swap the focused tile with a neighbour.
    board.addEventListener("keydown", (e) => {
        const t = e.target.closest(".tile");
        if (!t || solved)
            return;
        const dirs = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
        };
        const d = dirs[e.key];
        if (!d)
            return;
        e.preventDefault();
        const i = Number(t.dataset.cell);
        const { rows, cols } = state.board;
        const nr = Math.floor(i / cols) + d[0];
        const nc = (i % cols) + d[1];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || !state.board.cells[nr * cols + nc])
            return;
        trySwap(i, nr * cols + nc);
        t.focus();
    });
    undoBtn.addEventListener("click", () => {
        const before = state.history.length;
        state = undo(state);
        if (state.history.length < before)
            path.pop();
        selected = null;
        hintPair = null;
        say("Undone.");
        paint();
        saveAttempt();
    });
    restartBtn.addEventListener("click", () => {
        state = restart(state);
        path = [];
        selected = null;
        hintPair = null;
        say("Back to the start.");
        paint();
        saveAttempt();
    });
    let thinking = false;
    hintBtn.addEventListener("click", async () => {
        if (solved || thinking)
            return;
        if (!tutorial && hintsLeft(progress, level.key) <= 0) {
            openAdOffer();
            return;
        }
        thinking = true;
        hintBtn.disabled = true;
        say("Thinking…");
        // The search runs in short slices, so taps and animation keep working while it thinks. If
        // the player moves or leaves meanwhile, the answer is stale and is dropped.
        const asked = state;
        const h = await solveAsync(asked.board, asked.board.cells, asked.history[0].cells);
        thinking = false;
        if (disposed)
            return;
        if (state !== asked) {
            say("");
            paint();
            return;
        }
        {
            if (h.firstMove) {
                // A level's hint is spent only when a hint is actually shown.
                if (!tutorial) {
                    const spent = spendHint(progress, level.key);
                    if (!spent) {
                        say("");
                        paint();
                        openAdOffer();
                        return;
                    }
                    progress = spent;
                    void persistProgress();
                }
                state = { ...state, hintsUsed: state.hintsUsed + 1 };
                saveAttempt();
                hintPair = h.firstMove;
                selected = null;
                play("hint");
                say(`Try swapping the glowing tiles. ${h.distance} move${h.distance === 1 ? "" : "s"} from here at best.` +
                    (state.hintsUsed === 1 ? " Hints cap this attempt at ★★☆." : ""));
            }
            paint();
        }
    });
    // ----- the optional rewarded ad, offered only when this level has no hints left
    let watching = false;
    function closeAdOffer() {
        adPanel.hidden = true;
        adPanel.replaceChildren();
        paint();
    }
    function openAdOffer() {
        if (tutorial || solved)
            return;
        const key = level.key;
        adPanel.replaceChildren();
        const h = el("h2", "ad-title", "No hints left on this level");
        h.id = "ad-title";
        const text = el("p", "ad-text", "Watch a short ad to earn 1 hint for this level. It's optional - you can keep playing without it.");
        const row = el("div", "ad-actions");
        const watch = el("button", "primary", "Watch an ad to earn 1 hint");
        watch.type = "button";
        const notNow = el("button", "secondary", "Not now");
        notNow.type = "button";
        notNow.addEventListener("click", () => {
            if (!watching)
                closeAdOffer();
        });
        watch.addEventListener("click", async () => {
            if (watching)
                return;
            watching = true;
            watch.disabled = true;
            notNow.disabled = true;
            text.textContent = "Loading an ad…";
            const before = hintsLeft(progress, key);
            let status = "unavailable";
            try {
                if (ads) {
                    // Ads are requested only once Google's consent check allows it.
                    if (!adsState.canRequestAds)
                        await prepareAds(true);
                    // C5b: if Google's consent check itself failed (for example a first run offline), no choice
                    // was made, so say no ad is available rather than blame the privacy choices.
                    // 1.3.5: music never plays under an ad (the module's 'ad' pause reason); the ad itself is unchanged.
                    if (adsState.canRequestAds) {
                        launchAudio?.pause("ad");
                        try {
                            status = (await ads.showRewarded(key)).status;
                        }
                        finally {
                            launchAudio?.resume("ad");
                        }
                    }
                    else
                        status = adsState.consentCheckFailed ? "unavailable" : "consent";
                }
            }
            catch {
                status = "failed";
            }
            await claimRewards();
            watching = false;
            if (disposed)
                return; // the reward, if any, is already on the level it was earned for
            closeAdOffer();
            if (hintsLeft(progress, key) > before)
                say("You earned 1 hint for this level. Tap Hint to use it.");
            else if (status === "closed")
                say("The ad was closed before the end, so no hint was earned. Keep playing as you like.");
            else if (status === "consent")
                say("Ads aren't available with your current privacy choices. You can keep playing without a hint.");
            else
                say(NO_AD_MESSAGE);
        });
        row.append(watch, notNow);
        adPanel.append(h, text, row);
        adPanel.hidden = false;
        say("");
        paint();
        focusForKeyboard(watch);
    }
    if (!tutorial)
        onHintsChanged = () => paint();
    // ----- completion
    function finish() {
        if (!adPanel.hidden && !watching)
            closeAdOffer();
        solved = true;
        selected = null;
        hintPair = null;
        guide = {};
        const medal = medalFor(level.optimal, state.moves, state.hintsUsed, silverFor(level));
        const previous = tutorial ? undefined : progress.levels[level.key];
        if (!tutorial) {
            // Solving ends the attempt: nothing to resume (1.3.4).
            progress = clearCurrent(recordResult(progress, level.key, medal, state.moves));
            // Solving a level that uses a rule counts as having met it.
            for (const rule of LEVEL_MECHANICS[index])
                progress = markSeen(progress, rule);
            persistProgress();
            renderBest();
        }
        hideCoach();
        paint();
        say("Solved!");
        const instant = reducedMotion.matches;
        if (!instant) {
            // A short wave across the board, row by row.
            state.board.cells.forEach((tile, i) => {
                if (!tile)
                    return;
                const t = tileEls.get(tile.id);
                const r = Math.floor(i / state.board.cols);
                const c = i % state.board.cols;
                t.style.animationDelay = `${(r + c) * 55}ms`;
                t.classList.add("celebrate");
            });
        }
        later(() => play("win"), instant ? 0 : 160);
        launchAudio?.vibrate(30); // 1.3.5: a short pulse on the solve (Vibration setting, default on)
        later(() => (tutorial ? showTutorialDone(medal) : showWin(medal, previous?.medal)), instant ? 0 : 750);
    }
    function openPanel() {
        winPanel.hidden = false;
        screen.classList.add("is-won");
        focusForKeyboard(winPanel.querySelector("button"));
    }
    function showWin(medal, previousMedal) {
        winPanel.replaceChildren();
        const big = el("div", `win-medal medal-${medal}`);
        big.appendChild(el("span", "stars", MEDAL_STARS[medal]));
        winPanel.appendChild(big);
        const h = el("h2", undefined, medal === "gold" ? "Perfect!" : medal === "silver" ? "Nicely done!" : "Solved!");
        h.id = "win-title";
        winPanel.appendChild(h);
        let detail = `${MEDAL_TEXT[medal]} medal · ${plural(state.moves, "move")}`;
        if (medal !== "gold") {
            detail +=
                state.hintsUsed > 0 && state.moves <= level.optimal
                    ? ". Solve it without hints for gold."
                    : `. Gold takes ${level.optimal}.`;
        }
        if (previousMedal && MEDAL_RANK[previousMedal] > MEDAL_RANK[medal]) {
            detail += ` Your best is still ${MEDAL_TEXT[previousMedal]}.`;
        }
        winPanel.appendChild(el("p", "win-detail", detail));
        const row = el("div", "win-actions");
        const nextIndex = index + 1;
        const nextLevel = LEVELS[nextIndex];
        if (nextLevel) {
            const label = nextLevel.chapter === level.chapter ? `Next: ${nextLevel.name}` : `Next chapter: ${CHAPTERS[nextLevel.chapter - 1].title}`;
            const n = el("button", "primary", label);
            n.type = "button";
            n.addEventListener("click", () => openLevel(nextIndex));
            row.appendChild(n);
        }
        else {
            const done = el("button", "primary", `All ${LEVELS.length} solved - see your medals`);
            done.type = "button";
            done.addEventListener("click", goHome);
            row.appendChild(done);
        }
        const again = el("button", "secondary", medal === "gold" ? "Replay" : "Try again");
        again.type = "button";
        again.addEventListener("click", () => renderPlay(index));
        const levels = el("button", "secondary", "Levels");
        levels.type = "button";
        levels.addEventListener("click", () => openChapter(level.chapter));
        row.append(again, levels);
        winPanel.appendChild(row);
        openPanel();
    }
    /** End of the tutorial: what the result means, and how medals, hints and undo work. */
    function showTutorialDone(medal) {
        winPanel.replaceChildren();
        const big = el("div", `win-medal medal-${medal}`);
        big.appendChild(el("span", "stars", MEDAL_STARS[medal]));
        winPanel.appendChild(big);
        const h = el("h2", undefined, medal === "gold" ? "Perfect - that's Gold!" : "Solved!");
        h.id = "win-title";
        winPanel.appendChild(h);
        winPanel.appendChild(el("p", "win-detail", medal === "gold"
            ? `${plural(state.moves, "move")} - the fewest possible.`
            : `${plural(state.moves, "move")}. Gold takes ${level.optimal}.`));
        winPanel.appendChild(medalGuide());
        winPanel.appendChild(el("p", "win-detail", `Stuck? Hint shows a good move - that attempt can then earn Silver at most. Each level has ${FREE_HINTS_PER_LEVEL} free hints.`));
        const row = el("div", "win-actions");
        const fromHelp = view.kind === "tutorial" && view.from === "help";
        const startPlaying = !fromHelp && Object.keys(progress.levels).length === 0;
        const go1 = el("button", "primary", startPlaying ? "Start playing" : "Done");
        go1.type = "button";
        go1.addEventListener("click", () => (startPlaying ? openLevel(0) : leaveTutorial()));
        const again = el("button", "secondary", "Try it again");
        again.type = "button";
        again.addEventListener("click", () => renderPlay(null));
        row.append(go1, again);
        winPanel.appendChild(row);
        openPanel();
    }
    // ----- tutorial steps (the real board and rules; only the coach is extra)
    function tutorialStep(step) {
        const [g1, g2] = TUTORIAL_GUIDED_SWAP;
        const skip = { label: "Skip tutorial", onClick: leaveTutorial };
        const none = () => false;
        switch (step) {
            case "welcome":
                guide = { allowTap: none, nudge: "Tap Show me to start." };
                showCoach("Welcome to Sortwise", "Your goal: make the board match the target picture.", [
                    { label: "Show me", primary: true, onClick: () => tutorialStep("select") },
                    skip,
                ]);
                spot([], [targetCard]);
                break;
            case "select":
                guide = { allowTap: (i) => i === g1, onSelect: () => tutorialStep("swap"), nudge: "Tap the highlighted tile." };
                showCoach(null, "Tap the highlighted tile to pick it up.", [skip]);
                spot([g1]);
                break;
            case "swap":
                guide = {
                    allowTap: (i) => i === g1 || i === g2,
                    allowSwap: (a, b) => (a === g1 && b === g2) || (a === g2 && b === g1),
                    onDeselect: () => tutorialStep("select"),
                    onSwap: () => tutorialStep("ticks"),
                    nudge: "Tap the highlighted tile next to it.",
                };
                showCoach(null, "Now tap the highlighted tile next to it. Tiles swap with a neighbour: up, down, left or right.", [skip]);
                spot([g2]);
                break;
            case "ticks":
                guide = { allowTap: none, nudge: "Tap Next to carry on." };
                showCoach(null, "Both tiles now match the target - see the ticks.", [
                    { label: "Next", primary: true, onClick: () => tutorialStep("tools") },
                    skip,
                ]);
                spot([g1, g2], [targetCard]);
                break;
            case "tools":
                guide = { allowTap: none, nudge: "Tap Next to carry on." };
                showCoach(null, `Undo takes back a move. Restart starts over. Both are free: only the moves on the counter when you finish count. Hint shows a good move; each level has ${FREE_HINTS_PER_LEVEL} free hints (the tutorial's don't count).`, [{ label: "Next", primary: true, onClick: () => tutorialStep("finish") }, skip]);
                spot([], [undoBtn, restartBtn]);
                break;
            case "finish":
                guide = {};
                showCoach(null, "Your turn: make the bottom row match too. The fewest moves earns Gold.", [skip]);
                spot([]);
                break;
        }
        say("");
    }
    // ----- a rule met for the first time
    function introduceRules() {
        const pending = MECHANICS.filter((m) => LEVEL_MECHANICS[index].has(m) && !ruleMet(m));
        const showNext = (k) => {
            const rule = pending[k];
            const last = k === pending.length - 1;
            showCoach(`New: ${RULES[rule].title}`, RULES[rule].text, [
                {
                    label: last ? "Got it" : "Next",
                    primary: true,
                    onClick: () => {
                        noteSeen(rule);
                        if (last)
                            hideCoach();
                        else
                            showNext(k + 1);
                    },
                },
            ]);
            spot(mechanicCells(level, rule));
        };
        if (pending.length)
            showNext(0);
    }
    const ro = new ResizeObserver(() => layout());
    ro.observe(boardWrap);
    cleanupPlay = () => {
        disposed = true;
        onHintsChanged = null;
        saveOpenAttempt = null;
        ro.disconnect();
        timers.forEach((t) => clearTimeout(t));
    };
    saveOpenAttempt = saveAttempt;
    layout();
    if (tutorial)
        tutorialStep("welcome");
    else
        introduceRules();
    if (resumed)
        say("Picked up where you left off.");
    window.scrollTo(0, 0);
}
function describeTarget(state) {
    const { rows, cols, target } = state.board;
    const lines = [];
    for (let r = 0; r < rows; r++) {
        const row = target.slice(r * cols, (r + 1) * cols).map((k) => (k ? KIND_NAMES[k] : "gap"));
        lines.push(`row ${r + 1}: ${row.join(", ")}`);
    }
    return `Target pattern. ${lines.join("; ")}.`;
}
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        saveOpenAttempt?.(); // 1.3.4: the puzzle in progress is saved again when the app goes to the background
        suspendAudio();
    }
    else
        void claimRewards();
});
// A reload (or relaunch) always starts at home; drop any history entry left from before.
if (history.state?.sortwise)
    history.replaceState(null, "");
// A brand-new player starts with the short tutorial (skippable); everyone else at the chapters.
if (needsTutorial())
    go({ kind: "tutorial", from: "first" });
else
    renderHome();
// Merge the durable copy first, then credit any reward earned while the app was closed, then
// refresh the ad-consent status (no form here: it appears only if the player asks for an ad).
void restoreDurableProgress()
    .then(() => claimRewards())
    .then(() => prepareAds())
    .then(() => {
    void updateBanner();
    if (view.kind === "home")
        askBannerConsentOnce();
});
