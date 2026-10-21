/**
 * Tiltwise UI. Screens: home (chapters and levels), level, tutorial (first play; replayable), How
 * to play. Input: swipe anywhere on the board (primary), the keyboard arrows, or optional
 * direction buttons under the board ("Direction buttons" setting, Off by default). Every tilt
 * animates each piece along its real path; a tilt that moves nothing shakes the board and costs
 * nothing.
 *
 * Hints: FREE_HINTS_PER_LEVEL free per level. At zero the Hint button offers an optional
 * rewarded ad (never shown automatically); a completed ad credits exactly one hint to the level it
 * was requested on, which the player then uses with Hint. Ads: the native Google plugin in the
 * Android app, a labelled simulation in the browser preview, none in a plain browser build.
 */
import { DurableSave } from "../core/save.js";
import { BRAND } from "../core/brand.js";
import { focusForKeyboard, installFocusPolicy, markSeen, nativeCall, needsIntro, trackAppHeight } from "../core/platform.js";
import { createAdsProvider } from "../core/ads.js";
import { simulatedAdsEnabled, simulatedAdsProvider } from "./preview-ads.js";
import { CHAPTERS, LEVELS } from "../engine/levels.js";
import { hint as solverHint, isSolved, parseLayout, provenDeadEnd, stateKey, tilt } from "../engine/tilt.js";
import { TUTORIAL_ROWS, TUTORIAL_STEPS } from "../engine/tutorial.js";
import { creditReward, FREE_HINTS_PER_LEVEL, hintsLeft, medalFor, PROGRESS_SPEC, recordResult, setPrefs, spendHint } from "../engine/progress.js";
let storage = null;
try {
    storage = window.localStorage;
}
catch {
    storage = null;
}
const native = nativeCall();
// Tiltwise's own policy (live, verified HTTP 200). Players only ever see the label, never the host.
const PRIVACY_POLICY_URL = "https://talhaatif01.github.io/2852483-games-site/tiltwise/privacy/";
const save = new DurableSave(PROGRESS_SPEC, storage, native);
const ads = createAdsProvider(native, "TiltwayAds") ?? (simulatedAdsEnabled() ? simulatedAdsProvider() : null);
const adsMode = !ads ? "none" : globalThis.studioTestAds ? "test" : native ? "native" : "simulated";
let adsState = { canRequestAds: false, privacyOptionsRequired: false };
const app = document.getElementById("app");
installFocusPolicy();
trackAppHeight();
const ARROW = { up: "↑", down: "↓", left: "←", right: "→" };
const MEDAL_LABEL = { gold: "Gold", silver: "Silver", bronze: "Bronze" };
const RULE_CARDS = {
    pairs: { title: "Two marbles", text: "Every marble rolls at the same time. Each one needs a hole of its own colour, and it rolls straight over the others." },
    crates: { title: "Crates", text: "Crates roll too, but they never drop into a hole. Use them as stoppers." },
    sticky: { title: "Sticky pads", text: "Anything that rolls onto a sticky pad stops there. The next tilt rolls it off again." },
    colours: { title: "Three colours", text: "A third colour joins in. Every marble still needs a hole of its own colour, and shapes match too." },
    arrows: { title: "Arrows", text: "Pieces can only roll onto an arrow tile in the direction it points. Rolling off is free." },
};
/** The board elements each rule card points at. */
const RULE_GLOW = { pairs: ".piece.marble", crates: ".piece.crate", sticky: ".cell.sticky", colours: ".piece.color-c, .hole.color-c", arrows: ".cell.arrow-tile" };
let view = { kind: "home" };
let cleanup = null;
const progress = () => save.value;
const persist = (p) => save.save(p);
function el(tag, cls = "", text = "") {
    const e = document.createElement(tag);
    if (cls)
        e.className = cls;
    if (text)
        e.textContent = text;
    return e;
}
function button(label, cls, onClick, aria) {
    const b = el("button", cls, label);
    b.type = "button";
    if (aria)
        b.setAttribute("aria-label", aria);
    b.addEventListener("click", onClick);
    return b;
}
function go(next) {
    cleanup?.();
    cleanup = null;
    view = next;
    // One history entry while away from the level list, so the system Back button (Android) and
    // the browser's back return to the list instead of leaving the game.
    if (next.kind !== "home" && history.state?.tiltway !== "away")
        history.pushState({ tiltway: "away" }, "");
    // Back to the list through the UI: drop the entry too (its popstate re-renders home: harmless).
    if (next.kind === "home" && history.state?.tiltway === "away")
        history.back();
    app.replaceChildren();
    if (next.kind === "home")
        renderHome();
    else if (next.kind === "help")
        renderHelp();
    else if (next.kind === "tutorial")
        renderPlay(null);
    else
        renderPlay(next.index);
}
// Open: the first level, any level already solved (levels can be reordered between versions), or
// the one after a solved level.
const unlocked = (i) => i === 0 || !!progress().levels[LEVELS[i].key] || !!progress().levels[LEVELS[i - 1].key];
const nextIndex = () => {
    const i = LEVELS.findIndex((l) => !progress().levels[l.key]);
    return i < 0 ? LEVELS.length - 1 : i;
};
// ------------------------------------------------------------------ home
function renderHome() {
    const screen = el("div", "screen home-screen");
    const head = el("header", "top");
    head.append(el("h1", "title", "Tiltwise"), soundButton());
    const solved = LEVELS.filter((l) => progress().levels[l.key]).length;
    screen.append(head, el("p", "lede", `Tilt the board. Drop every marble in its own hole. ${solved}/${LEVELS.length} solved.`));
    screen.append(button(solved ? "Continue" : "Play", "primary play-btn", () => go({ kind: "level", index: nextIndex() })));
    screen.append(button("How to play", "secondary help-btn", () => go({ kind: "help" })));
    screen.append(dirButtonsSwitch());
    CHAPTERS.forEach((ch, ci) => {
        const sec = el("section", "chapter");
        sec.append(el("h2", "chapter-title", `${ci + 1}. ${ch.name}`));
        const grid = el("div", "level-grid");
        LEVELS.forEach((l, i) => {
            if (l.chapter !== ci + 1)
                return;
            const rec = progress().levels[l.key];
            const n = LEVELS.filter((x, j) => x.chapter === l.chapter && j <= i).length;
            const b = button(String(n), `level-node${rec ? ` medal-${rec.medal}` : ""}`, () => go({ kind: "level", index: i }), `Chapter ${ci + 1} level ${n}${rec ? `, ${MEDAL_LABEL[rec.medal]}` : unlocked(i) ? "" : ", locked"}`);
            b.dataset.index = String(i);
            b.disabled = !unlocked(i);
            grid.append(b);
        });
        sec.append(grid);
        screen.append(sec);
    });
    app.append(screen);
    focusForKeyboard(screen.querySelector(".play-btn"));
}
/**
 * Sound toggle. In a level the header is narrow, so it shows a compact "♪ On/Off" (the accessible
 * name stays "Sound on/off"): a long chapter name ("Three colours") wrapped to two lines at 360 px
 * and shrank the board (level audit 2026-10-20).
 */
function soundButton(compact = false) {
    const label = () => (compact ? (progress().soundOn ? "♪ On" : "♪ Off") : progress().soundOn ? "Sound on" : "Sound off");
    const b = button(label(), `secondary sound-btn${compact ? " compact" : ""}`, () => {
        void persist(setPrefs(progress(), { soundOn: !progress().soundOn }));
        b.textContent = label();
        b.setAttribute("aria-label", progress().soundOn ? "Sound on" : "Sound off");
    });
    b.setAttribute("aria-label", progress().soundOn ? "Sound on" : "Sound off");
    return b;
}
/**
 * The "Direction buttons" setting (Off by default): an accessible switch on the level list and in
 * How to play, so it never depends on the buttons themselves. Swiping and the keyboard always work.
 */
function dirButtonsSwitch(withNote = true) {
    const box = el("div", "setting");
    const sw = el("button", "switch dir-switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-label", "Direction buttons");
    const state = el("span", "switch-state");
    sw.append(el("span", "switch-label", "Direction buttons"), state);
    const paintSwitch = () => {
        const on = progress().dirButtons;
        sw.setAttribute("aria-checked", String(on));
        sw.classList.toggle("on", on);
        state.textContent = on ? "On" : "Off";
    };
    sw.addEventListener("click", () => {
        void persist(setPrefs(progress(), { dirButtons: !progress().dirButtons }));
        paintSwitch();
    });
    paintSwitch();
    box.append(sw);
    if (withNote)
        box.append(el("p", "setting-note", "Swipe on the board to tilt. Turn this on to also show ↑ ← → ↓ buttons under the board."));
    return box;
}
// ------------------------------------------------------------------ help
function renderHelp() {
    const screen = el("div", "screen help-screen");
    const head = el("header", "top");
    head.append(button("‹ Back", "secondary back-btn", () => go({ kind: "home" })), el("h1", "title", "How to play"));
    screen.append(head);
    // Rules appear here once the player has met them (no spoilers); the rest is always shown.
    const seen = progress().seen;
    const privacy = adsMode === "native"
        ? "Tiltwise stores your progress only on this device and has no accounts. Ads play only when you choose to watch one for a hint. They are provided by Google AdMob, which collects some device data (such as the advertising ID and IP address) when an ad is requested."
        : adsMode === "simulated"
            ? "Tiltwise stores your progress only in this browser and has no accounts. In this preview, ads are simulated: no real ad is shown and nothing is sent anywhere."
            : "Tiltwise stores your progress only in this browser. It has no accounts, shows no ads here and sends nothing anywhere.";
    const entries = [
        ["Tilt", "Swipe anywhere on the board: up, down, left or right. Every loose piece rolls that way until it hits a wall or another piece. Arrow keys on a keyboard work too.", null],
        ["Direction buttons", "Prefer tapping? Turn on Direction buttons (below, or on the level list) to show ↑ ← → ↓ buttons under the board. They are off unless you turn them on.", null],
        ["Holes", "A marble drops into an empty hole of its own colour. It rolls straight over holes of other colours.", null],
        ["Crates", "Crates roll like marbles but never drop. Use them to stop a marble where you need it.", "crates"],
        ["Sticky pads", "Anything that rolls onto a sticky pad stops there. The next tilt rolls it off again.", "sticky"],
        ["Three colours", "Red circles, blue triangles and yellow squares: each marble needs the hole with its own colour and shape.", "colours"],
        ["Arrows", "Pieces can only roll onto an arrow tile in the direction it points. Rolling off is free.", "arrows"],
        ["Medals", "Gold: the fewest possible tilts without a hint. Silver: up to two tilts more. Bronze: any solve.", null],
        ["Undo and restart", "A wrong tilt can make a level impossible to finish. Undo takes back your last tilt, as many times as you like, all the way to the start (or press Z). Restart puts the level back as it began. Both are always free, and the game tells you when a position can no longer be finished.", null],
        ["Hints", `Each level has ${FREE_HINTS_PER_LEVEL} free hints. A hint shows the next tilt of a shortest solution from where you are. Used hints stay used, even after Undo, Restart or Replay. When a level has none left, tap "Need a nudge?": you can watch an ad to unlock 1 extra hint for that level. Ads never play unless you choose to.`, null],
        ["Privacy policy", privacy, null],
        ["About", `Tiltwise is a ${BRAND.studio} game, published by ${BRAND.legalPublisher}, ${BRAND.jurisdiction}. ${BRAND.supportLabel}: ${BRAND.supportEmail}`, null],
    ];
    for (const [t, p, gate] of entries) {
        if (gate && !seen.includes(gate))
            continue;
        const s = el("section", "rule");
        s.append(el("h2", "", t), el("p", "", p));
        if (t === "Direction buttons")
            s.append(dirButtonsSwitch(false));
        if (t === "Privacy policy")
            s.append(privacyPolicyLink());
        if (t === "Privacy policy" && ads && adsState.privacyOptionsRequired) {
            s.append(button("Privacy choices", "secondary privacy-btn", () => {
                void ads.showPrivacyOptions().then((st) => (adsState = st));
            }));
        }
        screen.append(s);
    }
    if (entries.some(([, , g]) => g && !seen.includes(g)))
        screen.append(el("p", "fineprint", "More rules appear as you play."));
    screen.append(button("Replay the tutorial", "primary cta", () => go({ kind: "tutorial" })));
    app.append(screen);
}
/**
 * The full privacy policy, one tap from How to play. In the Android app a link to another site is
 * handed to the phone's browser by Capacitor (the app itself never leaves); in a browser it opens a
 * new tab so the game keeps its place.
 */
function privacyPolicyLink() {
    const p = el("p", "policy-row");
    const a = el("a", "policy-link", "Tiltwise Privacy Policy");
    a.href = PRIVACY_POLICY_URL;
    if (!native) {
        a.target = "_blank";
        a.rel = "noopener";
    }
    const mail = el("a", "policy-mail", BRAND.supportEmail);
    mail.href = `mailto:${BRAND.supportEmail}`;
    p.append(a, el("span", "policy-sep", " · "), document.createTextNode(`${BRAND.supportLabel}: `), mail);
    return p;
}
// ------------------------------------------------------------------ play
function renderPlay(index) {
    const tutorial = index === null;
    const level = tutorial ? null : LEVELS[index];
    const start = parseLayout(tutorial ? TUTORIAL_ROWS : level.rows);
    let board = start;
    let history = [];
    let moves = 0;
    let hintsUsedHere = 0;
    let busy = false;
    let solved = false;
    let step = 0;
    const screen = el("div", `screen play-screen${tutorial ? " tutorial-screen" : ""}`);
    const head = el("header", "top");
    const chapterNo = level ? level.chapter : 0;
    const levelNo = level ? LEVELS.filter((l, j) => l.chapter === level.chapter && j <= index).length : 0;
    const titleBox = el("div", "titlebox");
    titleBox.append(el("div", "eyebrow", tutorial ? "Tutorial" : `Level ${chapterNo}-${levelNo}`), el("div", "level-name", tutorial ? "How to tilt" : CHAPTERS[chapterNo - 1].name));
    head.append(button(tutorial ? "‹ Skip" : "‹ Levels", "secondary back-btn skip-btn", () => finishTutorialOr(() => go({ kind: "home" }))), titleBox, soundButton(true));
    const info = el("div", "info-row");
    const movesEl = el("div", "moves", "");
    const goal = el("div", "goal", tutorial ? "" : `Gold: ${level.optimal} tilts`);
    info.append(movesEl, goal);
    const coach = el("div", "coach");
    coach.hidden = !tutorial;
    const wrap = el("div", "board-wrap");
    const boardEl = el("div", "board");
    wrap.append(boardEl);
    // Optional direction buttons: when the setting is Off the row is not built at all, so the board
    // gets its space.
    const pad = progress().dirButtons ? el("div", "pad") : null;
    if (pad)
        for (const d of ["up", "left", "right", "down"])
            pad.append(button(ARROW[d], `arrow arrow-${d}`, () => void doTilt(d), `Tilt ${d}`));
    // The hint is also drawn on the board itself, so it never depends on the buttons.
    const hintMark = el("div", "hint-mark");
    hintMark.setAttribute("aria-hidden", "true");
    hintMark.hidden = true;
    boardEl.append(hintMark);
    const actions = el("div", "actions");
    const undoBtn = button("Undo", "action-btn undo-btn", () => undo(), "Undo last tilt");
    const restartBtn = button("Restart", "action-btn restart-btn", () => restart(), "Restart level");
    const hintBtn = button("Hint", "action-btn hint-btn", () => showHint());
    actions.append(undoBtn, restartBtn, hintBtn);
    const message = el("div", "message");
    message.setAttribute("role", "status");
    // Shown only for a PROVEN dead end (the whole reachable space was searched).
    const stuck = el("div", "stuck");
    stuck.setAttribute("role", "status");
    stuck.hidden = true;
    const winPanel = el("div", "win-panel");
    winPanel.hidden = true;
    const adPanel = el("div", "ad-panel");
    adPanel.setAttribute("role", "dialog");
    adPanel.setAttribute("aria-labelledby", "ad-title");
    adPanel.hidden = true;
    screen.append(head, info, coach, wrap, ...(pad ? [pad] : []), actions, stuck, message, winPanel, adPanel);
    app.append(screen);
    // Cell size from the space actually available.
    let cell = 40;
    const layout = () => {
        const gap = 4;
        const availW = Math.min(wrap.clientWidth, 480);
        const availH = wrap.clientHeight;
        cell = Math.max(24, Math.floor(Math.min((availW - gap * (board.w - 1)) / board.w, (availH - gap * (board.h - 1)) / board.h, 72)));
        boardEl.style.setProperty("--cell", `${cell}px`);
        boardEl.style.setProperty("--gap", `${gap}px`);
        boardEl.style.width = `${board.w * cell + (board.w - 1) * gap}px`;
        boardEl.style.height = `${board.h * cell + (board.h - 1) * gap}px`;
        placePieces(false);
    };
    const at = (i) => [(i % board.w) * (cell + 4), Math.floor(i / board.w) * (cell + 4)];
    // Static cells (walls, floor, holes) and piece elements keyed by id.
    const pieceEls = new Map();
    const holeEls = new Map();
    for (let i = 0; i < start.w * start.h; i++) {
        const c = el("div", start.walls.has(i) ? "cell wall" : "cell floor");
        c.style.gridColumn = String((i % start.w) + 1);
        c.style.gridRow = String(Math.floor(i / start.w) + 1);
        const hole = start.holes.get(i);
        if (hole) {
            const h = el("div", `hole color-${hole}`);
            c.append(h);
            holeEls.set(i, h);
        }
        const special = start.specials.get(i);
        if (special === "sticky") {
            c.classList.add("sticky");
            c.append(el("div", "sticky-pad"));
        }
        else if (special) {
            c.classList.add("arrow-tile", `to-${special}`);
            c.append(el("div", "arrow-mark", ARROW[special]));
        }
        boardEl.append(c);
    }
    for (const p of start.pieces) {
        const e = el("div", p.kind === "crate" ? "piece crate" : `piece marble color-${p.color}`);
        e.dataset.id = String(p.id);
        pieceEls.set(p.id, e);
        boardEl.append(e);
    }
    // Rule card the first time a chapter's rule appears, with the tiles it talks about glowing.
    const rule = level ? CHAPTERS[level.chapter - 1].rule : null;
    if (rule && RULE_CARDS[rule] && needsIntro(progress().seen, rule)) {
        const glow = RULE_GLOW[rule] ? Array.from(boardEl.querySelectorAll(RULE_GLOW[rule])) : [];
        glow.forEach((g) => g.classList.add("intro-glow"));
        const card = el("div", "rule-card");
        card.append(el("h2", "", RULE_CARDS[rule].title), el("p", "", RULE_CARDS[rule].text));
        card.append(button("Got it", "primary got-it", () => {
            card.remove();
            glow.forEach((g) => g.classList.remove("intro-glow"));
            void persist({ ...progress(), seen: markSeen(progress().seen, rule) });
        }));
        screen.append(card);
    }
    function placePieces(animate) {
        for (const [id, e] of pieceEls) {
            const p = board.pieces.find((q) => q.id === id);
            e.style.transition = animate ? "" : "none";
            if (!p)
                continue;
            const [x, y] = at(p.pos);
            e.style.transform = `translate(${x}px, ${y}px)`;
        }
        for (const [i, h] of holeEls)
            h.classList.toggle("filled", !board.holes.has(i));
    }
    function paint() {
        movesEl.textContent = `${moves} ${moves === 1 ? "tilt" : "tilts"}`;
        const tutStep = tutorial && step < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[step] : null;
        // In the tutorial, Undo is the lesson of one step; elsewhere it is always available.
        undoBtn.disabled = !history.length || solved || (tutorial && !(tutStep && "undo" in tutStep));
        undoBtn.classList.toggle("teach", !!tutStep && "undo" in tutStep);
        restartBtn.disabled = !history.length || solved || tutorial;
        const left = level ? hintsLeft(progress(), level.key) : 0;
        hintBtn.textContent = tutorial ? "Hint" : left ? `Hint · ${left}` : "Need a nudge?";
        hintBtn.classList.toggle("nudge", !tutorial && !left);
        hintBtn.setAttribute("aria-label", tutorial ? "Hint" : left ? `Hint, ${left} left` : "Need a nudge? No hints left. Watch an ad to unlock 1 extra hint.");
        // The guided tutorial shows every move itself and never uses hints.
        hintBtn.disabled = tutorial || solved || watching;
        if (tutorial) {
            coach.textContent = step < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[step].text : "";
            coach.hidden = !coach.textContent;
        }
    }
    async function doTilt(d) {
        if (busy || solved)
            return;
        const tutStep = tutorial && step < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[step] : null;
        if (tutStep && "undo" in tutStep) {
            say("Tap Undo this time.");
            shake();
            return;
        }
        if (tutStep && "dir" in tutStep && d !== tutStep.dir) {
            say(`Try ${tutStep.dir.toUpperCase()} this time.`);
            shake();
            return;
        }
        const r = tilt(board, d);
        if (!r.moved) {
            // In a dead end the recovery notice stays; the shake says that nothing moved.
            say(stuck.hidden ? "Nothing can roll that way." : "");
            shake();
            return;
        }
        busy = true;
        say("");
        clearHint();
        history.push(board);
        board = r.board;
        moves++;
        if (tutorial)
            step++;
        // Animate: everything rolls to its stop; marbles that drop shrink into their hole.
        for (const path of r.paths) {
            const e = pieceEls.get(path.id);
            const target = path.sunkAt ?? path.to;
            const [x, y] = at(target);
            e.style.transition = "";
            e.style.transform = `translate(${x}px, ${y}px)`;
            if (path.sunkAt !== null)
                setTimeout(() => e.classList.add("sunk"), 170);
        }
        for (const [i, h] of holeEls)
            setTimeout(() => h.classList.toggle("filled", !board.holes.has(i)), 200);
        blip(r.paths.some((p) => p.sunkAt !== null) ? 660 : 330);
        await wait(230);
        busy = false;
        paint();
        if (isSolved(board))
            win();
        else
            checkStuck();
    }
    // ----- recovery: proven dead ends are explained; nothing resets by itself
    const deadCache = new Map();
    const isDead = (b) => {
        const k = stateKey(b);
        if (!deadCache.has(k))
            deadCache.set(k, provenDeadEnd(b));
        return deadCache.get(k);
    };
    function checkStuck() {
        const dead = !tutorial && !solved && isDead(board);
        stuck.hidden = !dead;
        undoBtn.classList.toggle("recover", dead);
        restartBtn.classList.toggle("recover", dead);
        if (!dead)
            return;
        // How many tilts back the level could still be finished (each one is a free Undo).
        let back = 1;
        while (back < history.length && isDead(history[history.length - back]))
            back++;
        stuck.replaceChildren(el("strong", "", "This can't be finished from here."), el("span", "", back === 1 ? " Undo your last tilt or restart. Both are free." : ` Undo ${back} tilts or restart. Both are free.`));
        say("");
    }
    function undo() {
        if (busy || !history.length || solved)
            return;
        if (tutorial && !(step < TUTORIAL_STEPS.length && "undo" in TUTORIAL_STEPS[step]))
            return;
        board = history.pop();
        moves = Math.max(0, moves - 1);
        if (tutorial)
            step++;
        for (const e of pieceEls.values())
            e.classList.toggle("sunk", !board.pieces.some((p) => p.id === Number(e.dataset.id)));
        for (const [i, h] of holeEls)
            h.classList.toggle("filled", !board.holes.has(i));
        placePieces(true);
        say(tutorial ? "" : "Took back 1 tilt.");
        clearHint();
        paint();
        checkStuck();
    }
    function restart() {
        if (busy || solved || tutorial || !history.length)
            return;
        board = start;
        history = [];
        moves = 0;
        for (const e of pieceEls.values())
            e.classList.remove("sunk");
        placePieces(true);
        say("Back to the start.");
        clearHint();
        paint();
        checkStuck();
    }
    function showHint() {
        if (!level || busy || solved || watching)
            return;
        // In a dead end no hint is charged and no ad is offered: recovery (Undo/Restart) is free.
        if (isDead(board)) {
            checkStuck();
            return;
        }
        if (hintsLeft(progress(), level.key) <= 0) {
            openAdOffer();
            return;
        }
        const d = solverHint(board);
        if (!d)
            return;
        const spent = spendHint(progress(), level.key);
        if (!spent)
            return;
        hintsUsedHere++;
        void persist(spent);
        clearHint();
        pad?.querySelector(`.arrow-${d}`)?.classList.add("is-hint");
        hintMark.className = `hint-mark to-${d}`;
        hintMark.textContent = `${ARROW[d]} tilt ${d}`;
        hintMark.hidden = false;
        say(`Hint: tilt ${d}.`);
        paint();
    }
    const clearHint = () => {
        pad?.querySelectorAll(".is-hint").forEach((b) => b.classList.remove("is-hint"));
        hintMark.hidden = true;
    };
    // ----- optional rewarded ad for one more hint (only when the player asks for it)
    let watching = false;
    let disposed = false;
    function closeAdOffer() {
        adPanel.hidden = true;
        adPanel.replaceChildren();
        paint();
    }
    function openAdOffer() {
        if (!level || solved)
            return;
        const key = level.key;
        adPanel.replaceChildren();
        const h = el("h2", "ad-title", "Need a nudge?");
        h.id = "ad-title";
        const text = el("p", "ad-text", "Watch an ad to unlock 1 extra hint for this level.");
        adPanel.append(h, text);
        if (adsMode === "simulated")
            adPanel.append(el("p", "ad-note", "Browser preview: the ad is simulated. No real ad is shown."));
        if (adsMode === "none")
            adPanel.append(el("p", "ad-note", "Ads aren't available in this browser version, so no hint can be earned here."));
        const row = el("div", "ad-actions");
        const watch = button("Watch ad", "primary watch-btn", () => void watchAd(), "Watch ad to unlock 1 extra hint");
        const notNow = button("Keep playing", "secondary not-now-btn", () => {
            if (!watching)
                closeAdOffer();
        });
        row.append(watch, notNow);
        adPanel.append(row);
        adPanel.hidden = false;
        say("");
        paint();
        focusForKeyboard(watch);
        async function watchAd() {
            if (watching)
                return;
            watching = true;
            watch.disabled = true;
            notNow.disabled = true;
            text.textContent = "Loading the ad…";
            paint();
            const before = hintsLeft(progress(), key);
            let status = "unavailable";
            try {
                if (ads) {
                    // Ads are requested only once Google's consent check allows it.
                    if (!adsState.canRequestAds)
                        adsState = await ads.prepare(true);
                    status = adsState.canRequestAds ? (await ads.showRewarded(key)).status : "consent";
                    // Consent can change outside the game (privacy options): ask again next time.
                    if (status === "consent")
                        adsState = { ...adsState, canRequestAds: false };
                }
            }
            catch {
                status = "failed";
            }
            // Credit to the level the ad was requested on, even if the player left it meanwhile.
            await claimRewards();
            watching = false;
            if (disposed)
                return;
            closeAdOffer();
            if (hintsLeft(progress(), key) > before)
                say("Your hint is ready! Tap Hint to use it.");
            else if (status === "closed")
                say("The ad was closed before the end, so no hint was unlocked. Keep playing as you like.");
            // Offline before Google's consent check has ever run also reports "consent".
            else if (status === "consent")
                say("No ad can be shown right now (ads need a connection and ad consent). Keep playing as you like.");
            else
                say("No ad is available right now. Keep playing as you like.");
            focusForKeyboard(hintBtn);
        }
    }
    if (level)
        onHintsChanged = () => paint();
    function win() {
        if (!adPanel.hidden && !watching)
            closeAdOffer();
        solved = true;
        paint();
        if (tutorial) {
            void persist({ ...progress(), seen: markSeen(progress().seen, "tutorial") });
            winPanel.replaceChildren(el("h2", "", "That's it!"), el("p", "", "Tilt, roll, drop. Every level can be solved; aim for the fewest tilts."), el("p", "tutorial-tip", "Wrong tilt? Undo is free and unlimited. Prefer tapping to swiping? Turn on Direction buttons on the level list or in How to play."));
            winPanel.append(button("Start playing", "primary next-btn", () => go({ kind: "level", index: nextIndex() })));
        }
        else {
            const medal = medalFor(level.optimal, moves, hintsUsedHere);
            void persist(recordResult(progress(), level.key, medal, moves));
            winPanel.replaceChildren(el("h2", `medal medal-${medal}`, MEDAL_LABEL[medal]), el("p", "", `${moves} tilts (gold: ${level.optimal}${hintsUsedHere ? ", no hints" : ""}).`));
            const row = el("div", "win-actions");
            row.append(button("Replay", "secondary replay-btn", () => go({ kind: "level", index: index })));
            if (index < LEVELS.length - 1)
                row.append(button("Next level", "primary next-btn", () => go({ kind: "level", index: index + 1 })));
            else
                row.append(button("All levels", "primary next-btn", () => go({ kind: "home" })));
            winPanel.append(row);
        }
        winPanel.hidden = false;
        focusForKeyboard(winPanel.querySelector(".next-btn"));
    }
    function finishTutorialOr(then) {
        if (tutorial)
            void persist({ ...progress(), seen: markSeen(progress().seen, "tutorial") }).then(then);
        else
            then();
    }
    const say = (t) => (message.textContent = t);
    const shake = () => {
        boardEl.classList.remove("shake");
        void boardEl.offsetWidth;
        boardEl.classList.add("shake");
    };
    // Swipe anywhere on the board area.
    let down = null;
    wrap.addEventListener("pointerdown", (e) => {
        down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    wrap.addEventListener("pointerup", (e) => {
        if (!down || down.id !== e.pointerId)
            return;
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        down = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24)
            return;
        void doTilt(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
    });
    wrap.addEventListener("pointercancel", () => (down = null));
    const onKey = (e) => {
        if ((e.key === "z" || e.key === "Z" || e.key === "Backspace") && !e.altKey && !e.metaKey) {
            e.preventDefault();
            undo();
            return;
        }
        const d = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[e.key];
        if (d) {
            e.preventDefault();
            void doTilt(d);
        }
    };
    window.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(() => layout());
    ro.observe(wrap);
    cleanup = () => {
        disposed = true;
        onHintsChanged = null;
        window.removeEventListener("keydown", onKey);
        ro.disconnect();
    };
    layout();
    paint();
    window.__tiltway = {
        state: () => ({ moves, solved, step, busy, watching, pieces: board.pieces.map((p) => ({ ...p })), holes: [...board.holes.keys()], w: board.w }),
    };
}
// ------------------------------------------------------------------ rewarded-ad credits
let onHintsChanged = null;
let claiming = Promise.resolve();
/**
 * Credit the rewards the ad provider recorded, each reward id once, to the level it was requested
 * on; acknowledge them only after the save holding the credit has been written.
 */
function claimRewards() {
    claiming = claiming.then(async () => {
        if (!ads)
            return;
        try {
            const pending = await ads.pendingRewards();
            if (!pending.length)
                return;
            let p = progress();
            for (const r of pending)
                p = creditReward(p, r.id, r.context);
            await persist(p);
            await ads.ackRewards(pending.map((r) => r.id));
            onHintsChanged?.();
        }
        catch {
            // Left pending: claimed again on the next resume or launch.
        }
    });
    return claiming;
}
document.addEventListener("visibilitychange", () => {
    if (!document.hidden)
        void claimRewards();
});
// ------------------------------------------------------------------ sound (tiny synthesized blip)
let audio = null;
function blip(freq) {
    if (!progress().soundOn)
        return;
    try {
        audio ?? (audio = new AudioContext());
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.06, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
        o.connect(g).connect(audio.destination);
        o.start();
        o.stop(audio.currentTime + 0.13);
    }
    catch {
        // no audio: silent
    }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
window.addEventListener("popstate", () => go({ kind: "home" }));
/**
 * Android's system Back (MainActivity asks this before leaving the app). Chromium skips history
 * entries not created by a user gesture, so native Back cannot rely on history (Sortwise lesson).
 * Returns true when the game handled it (stepped back to the level list).
 */
window.tiltwayHandleBack = () => {
    if (view.kind === "home")
        return false;
    if (view.kind === "tutorial")
        void persist({ ...progress(), seen: markSeen(progress().seen, "tutorial") });
    go({ kind: "home" });
    return true;
};
go(needsIntro(progress().seen, "tutorial") ? { kind: "tutorial" } : { kind: "home" });
// Merge the durable copy first, then credit any reward earned while the app was closed, then read
// the ad-consent status (no form here: Google's form appears only if the player asks for an ad).
void save
    .restore()
    .then((changed) => {
    if (changed && view.kind === "home")
        go({ kind: "home" });
    if (changed && view.kind === "tutorial" && !needsIntro(progress().seen, "tutorial"))
        go({ kind: "home" });
})
    .then(() => claimRewards())
    .then(async () => {
    if (ads)
        adsState = await ads.prepare(false).catch(() => adsState);
});
