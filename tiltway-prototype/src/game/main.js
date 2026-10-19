/**
 * Tiltway UI. Screens: home (chapters and levels), level, tutorial (first play; replayable), How
 * to play. Input: swipe anywhere on the board, the arrow pad under it, or the keyboard arrows.
 * Every tilt animates each piece along its real path; a tilt that moves nothing shakes the board
 * and costs nothing.
 */
import { DurableSave } from "../core/save.js";
import { BRAND } from "../core/brand.js";
import { focusForKeyboard, installFocusPolicy, markSeen, nativeCall, needsIntro, trackAppHeight } from "../core/platform.js";
import { CHAPTERS, LEVELS } from "../engine/levels.js";
import { hint as solverHint, isSolved, parseLayout, solvable, tilt } from "../engine/tilt.js";
import { TUTORIAL_ROWS, TUTORIAL_STEPS } from "../engine/tutorial.js";
import { hintsLeft, medalFor, PROGRESS_SPEC, recordResult, spendHint } from "../engine/progress.js";
let storage = null;
try {
    storage = window.localStorage;
}
catch {
    storage = null;
}
const save = new DurableSave(PROGRESS_SPEC, storage, nativeCall());
const app = document.getElementById("app");
installFocusPolicy();
trackAppHeight();
const ARROW = { up: "↑", down: "↓", left: "←", right: "→" };
const MEDAL_LABEL = { gold: "Gold", silver: "Silver", bronze: "Bronze" };
const RULE_CARDS = {
    pairs: { title: "Two marbles", text: "Every marble rolls at the same time. Each one needs a hole of its own colour, and it rolls straight over the others." },
    crates: { title: "Crates", text: "Crates roll too, but they never drop into a hole. Use them as stoppers." },
};
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
const unlocked = (i) => i === 0 || !!progress().levels[LEVELS[i - 1].key];
const nextIndex = () => {
    const i = LEVELS.findIndex((l) => !progress().levels[l.key]);
    return i < 0 ? LEVELS.length - 1 : i;
};
// ------------------------------------------------------------------ home
function renderHome() {
    const screen = el("div", "screen home-screen");
    const head = el("header", "top");
    head.append(el("h1", "title", "Tiltway"), soundButton());
    const solved = LEVELS.filter((l) => progress().levels[l.key]).length;
    screen.append(head, el("p", "lede", `Tilt the board. Drop every marble in its own hole. ${solved}/${LEVELS.length} solved.`));
    screen.append(button(solved ? "Continue" : "Play", "primary play-btn", () => go({ kind: "level", index: nextIndex() })));
    screen.append(button("How to play", "secondary help-btn", () => go({ kind: "help" })));
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
function soundButton() {
    const b = button(progress().soundOn ? "Sound on" : "Sound off", "secondary sound-btn", () => {
        void persist({ ...progress(), soundOn: !progress().soundOn }).then(() => (b.textContent = progress().soundOn ? "Sound on" : "Sound off"));
    });
    return b;
}
// ------------------------------------------------------------------ help
function renderHelp() {
    const screen = el("div", "screen help-screen");
    const head = el("header", "top");
    head.append(button("‹ Back", "secondary back-btn", () => go({ kind: "home" })), el("h1", "title", "How to play"));
    screen.append(head);
    for (const [t, p] of [
        ["Tilt", "Swipe on the board (or use the arrows or your keyboard). Every loose piece rolls that way until it hits a wall or another piece."],
        ["Holes", "A marble drops into an empty hole of its own colour. It rolls straight over holes of other colours."],
        ["Crates", "Crates roll like marbles but never drop. Use them to stop a marble where you need it."],
        ["Medals", "Gold: the fewest possible tilts without a hint. Silver: up to two tilts more. Bronze: any solve."],
        ["Hints", "Each level has 3 hints. A hint shows the next tilt of a shortest solution from where you are. Hints never refill."],
        ["Undo and restart", "Both are free. A marble stuck in a corner it cannot leave? Undo."],
        ["Privacy", "Tiltway stores your progress only on this device. This prototype has no ads, no accounts and sends nothing anywhere."],
        ["About", `Tiltway is a ${BRAND.studio} game prototype, published by ${BRAND.legalPublisher}, ${BRAND.jurisdiction}. ${BRAND.supportLabel}: ${BRAND.supportEmail}`],
    ]) {
        const s = el("section", "rule");
        s.append(el("h2", "", t), el("p", "", p));
        screen.append(s);
    }
    screen.append(button("Replay the tutorial", "primary cta", () => go({ kind: "tutorial" })));
    app.append(screen);
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
    head.append(button(tutorial ? "‹ Skip" : "‹ Levels", "secondary back-btn skip-btn", () => finishTutorialOr(() => go({ kind: "home" }))), titleBox, soundButton());
    const info = el("div", "info-row");
    const movesEl = el("div", "moves", "");
    const goal = el("div", "goal", tutorial ? "" : `Gold: ${level.optimal} tilts`);
    info.append(movesEl, goal);
    const coach = el("div", "coach");
    coach.hidden = !tutorial;
    const wrap = el("div", "board-wrap");
    const boardEl = el("div", "board");
    wrap.append(boardEl);
    const pad = el("div", "pad");
    for (const d of ["up", "left", "right", "down"])
        pad.append(button(ARROW[d], `arrow arrow-${d}`, () => void doTilt(d), `Tilt ${d}`));
    const actions = el("div", "actions");
    const undoBtn = button("Undo", "action-btn undo-btn", () => undo());
    const restartBtn = button("Restart", "action-btn restart-btn", () => restart());
    const hintBtn = button("Hint", "action-btn hint-btn", () => showHint());
    actions.append(undoBtn, restartBtn, hintBtn);
    const message = el("div", "message");
    message.setAttribute("role", "status");
    const winPanel = el("div", "win-panel");
    winPanel.hidden = true;
    screen.append(head, info, coach, wrap, pad, actions, message, winPanel);
    app.append(screen);
    // Rule card the first time a chapter's rule appears.
    const rule = level ? CHAPTERS[level.chapter - 1].rule : null;
    if (rule && RULE_CARDS[rule] && needsIntro(progress().seen, rule)) {
        const card = el("div", "rule-card");
        card.append(el("h2", "", RULE_CARDS[rule].title), el("p", "", RULE_CARDS[rule].text));
        card.append(button("Got it", "primary got-it", () => {
            card.remove();
            void persist({ ...progress(), seen: markSeen(progress().seen, rule) });
        }));
        screen.append(card);
    }
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
        boardEl.append(c);
    }
    for (const p of start.pieces) {
        const e = el("div", p.kind === "crate" ? "piece crate" : `piece marble color-${p.color}`);
        e.dataset.id = String(p.id);
        pieceEls.set(p.id, e);
        boardEl.append(e);
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
        undoBtn.disabled = !history.length || solved;
        restartBtn.disabled = !history.length || solved;
        const left = level ? hintsLeft(progress(), level.key) : 0;
        hintBtn.textContent = tutorial ? "Hint" : `Hint · ${left}`;
        hintBtn.setAttribute("aria-label", tutorial ? "Hint" : `Hint, ${left} left`);
        hintBtn.disabled = tutorial || solved;
        if (tutorial)
            coach.textContent = step < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[step].text : "";
    }
    async function doTilt(d) {
        if (busy || solved)
            return;
        if (tutorial && step < TUTORIAL_STEPS.length && d !== TUTORIAL_STEPS[step].dir) {
            say(`Try ${TUTORIAL_STEPS[step].dir.toUpperCase()} this time.`);
            shake();
            return;
        }
        const r = tilt(board, d);
        if (!r.moved) {
            say("Nothing can roll that way.");
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
        else if (!tutorial && !solvable(board))
            say("A marble is stuck where it can't reach its hole. Undo or restart.");
    }
    function undo() {
        if (busy || !history.length || solved)
            return;
        board = history.pop();
        moves = Math.max(0, moves - 1);
        for (const e of pieceEls.values())
            e.classList.toggle("sunk", !board.pieces.some((p) => p.id === Number(e.dataset.id)));
        placePieces(true);
        say("");
        clearHint();
        paint();
    }
    function restart() {
        if (busy || solved)
            return;
        board = start;
        history = [];
        moves = 0;
        for (const e of pieceEls.values())
            e.classList.remove("sunk");
        placePieces(true);
        say("");
        clearHint();
        paint();
    }
    function showHint() {
        if (!level || busy || solved)
            return;
        const d = solverHint(board);
        if (!d) {
            say("No solution from here. Undo or restart first.");
            return;
        }
        const spent = spendHint(progress(), level.key);
        if (!spent) {
            say("No hints left on this level.");
            return;
        }
        hintsUsedHere++;
        void persist(spent);
        clearHint();
        pad.querySelector(`.arrow-${d}`)?.classList.add("is-hint");
        say(`Hint: tilt ${d}.`);
        paint();
    }
    const clearHint = () => pad.querySelectorAll(".is-hint").forEach((b) => b.classList.remove("is-hint"));
    function win() {
        solved = true;
        paint();
        if (tutorial) {
            void persist({ ...progress(), seen: markSeen(progress().seen, "tutorial") });
            winPanel.replaceChildren(el("h2", "", "That's it!"), el("p", "", "Tilt, roll, drop. Every level can be solved; aim for the fewest tilts."));
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
        window.removeEventListener("keydown", onKey);
        ro.disconnect();
    };
    layout();
    paint();
    window.__tiltway = {
        state: () => ({ moves, solved, step, busy, pieces: board.pieces.map((p) => ({ ...p })), holes: [...board.holes.keys()], w: board.w }),
    };
}
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
go(needsIntro(progress().seen, "tutorial") ? { kind: "tutorial" } : { kind: "home" });
void save.restore().then((changed) => {
    if (changed && view.kind === "home")
        go({ kind: "home" });
    if (changed && view.kind === "tutorial" && !needsIntro(progress().seen, "tutorial"))
        go({ kind: "home" });
});
