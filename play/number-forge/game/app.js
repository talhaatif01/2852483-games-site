/* Number Forge M1 (job 1049). Offline; ads are local simulations. Screens: launch (shared/launch-audio) -> level
   select (chapters, sequential locks, progress, Endless Forge, Menu) -> play (board, score/goal, HUD, back to levels).
   Swipe only; no hints. Timed simulated interstitial: after every 180 s of ACTIVE play (play screen shown, no dialog,
   page visible, app not paused, no ad), a 10 s "Ad in 10…" banner, then the ad, shown only between moves (never during
   a tile animation). During the ad the board, score and clock are frozen; close, skip or failure resumes the same
   board. Save: tivexa-numberforge-m1 (rules nf-m1-1); the starter's tivexa-merge-v2 / touch-v3 data is never read.
   M2 (job 1112):
   - save tivexa-numberforge-m2 (campaign nf-m2-1): an M1 save is upgraded once. Campaign progress resets (the level
     table changed), the Endless best score and tile are kept, the M1 key is removed; the launch/audio preferences
     (tivexa-launch-audio-v1:numberforge) are never touched;
   - whole-screen swipe: a swipe starting anywhere on the play screen moves the tiles, except on a button (HUD, ‹ Levels)
     or the ad banner strip;
   - Reset confirmation replaces the Menu sheet (Cancel returns to the Menu); the "New best score!" toast sits at the
     bottom, clear of the title and ‹ Levels. */
(function () {
  'use strict';
  const R = globalThis.ForgeRules, LEVELS = globalThis.FORGE_LEVELS, QA = /[?&]qa=1\b/.test(location.search);
  const $ = (s) => document.querySelector(s), PER = 10, SAVE_KEY = 'tivexa-numberforge-m2', M1_KEY = 'tivexa-numberforge-m1', CAMPAIGN = 'nf-m2-1';
  const AD_EVERY_MS = 180000, COUNTDOWN_MS = 10000, ANIM_MS = 150;
  const fresh = () => ({ rulesVersion: R.RULES, campaign: CAMPAIGN, solved: [], endless: { bestScore: 0, bestTile: 0 } });
  const bests = (s) => ({ bestScore: Math.max(0, Number(s && s.endless && s.endless.bestScore) || 0), bestTile: Math.max(0, Number(s && s.endless && s.endless.bestTile) || 0) });
  // RC R-SAVE: on Android the WebView commits localStorage lazily, so a save made just before the app is killed can be
  // lost (Sortwise met the same; its fix is a native durable copy). window.ForgeStore (SharedPreferences, synchronous
  // commit) keeps a durable copy of the save and the runs; it is read first. The browser build uses localStorage only.
  const read = (k) => { try { const d = window.ForgeStore && window.ForgeStore.get(k); return JSON.parse(d || localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const persist = (k, v) => { let ok = true; try { localStorage.setItem(k, v); } catch (e) { ok = false; } try { if (window.ForgeStore) window.ForgeStore.set(k, v); } catch (e) { } return ok; };
  let upgraded = null;
  function load() {
    const s = read(SAVE_KEY);
    if (s && s.rulesVersion === R.RULES && s.campaign === CAMPAIGN && Array.isArray(s.solved)) return { rulesVersion: R.RULES, campaign: CAMPAIGN, solved: [...new Set(s.solved.filter((k) => Number.isInteger(k) && k >= 1 && k <= LEVELS.length))], endless: bests(s) };
    // M1 -> M2: whole-save upgrade, never a half state: fresh campaign + the Endless bests, written before the M1 key goes.
    const m1 = read(M1_KEY), st = fresh();
    if (m1 && typeof m1 === 'object') { st.endless = bests(m1); upgraded = { from: M1_KEY, solvedDropped: Array.isArray(m1.solved) ? m1.solved.length : 0, endlessKept: st.endless }; }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); if (m1 !== null || localStorage.getItem(M1_KEY) !== null) localStorage.removeItem(M1_KEY); } catch (e) { }
    return st;
  }
  let store = load();
  function save() { if (!persist(SAVE_KEY, JSON.stringify(store))) say('Storage unavailable: progress lasts for this session only.'); }
  const solved = (i) => store.solved.includes(i), unlocked = (i) => i === 1 || solved(i - 1);
  const chapterDone = (c) => LEVELS.every((l, i) => l.chapter !== c || solved(i + 1));

  // RC R1: on Android (window.ForgeAdsNative) consent is asked after Begin, before any ad request; the browser build keeps
  // the local simulations.
  const NATIVE = !!window.ForgeAdsNative;
  // Ad adapter seam (job 1296; shared/ads/README.md): ADS.canServe(kind), ADS.showRewarded() -> Promise<status>,
  // ADS.showInterstitial() -> Promise<status> | null. The web build ships shared/ads/ads-none.js (window.TivexaAds, the
  // `none` adapter: canServe() is false, so no offer is rendered) and removes the //@web-strip blocks; the Android build
  // uses the in-game adapter below: `native` (ForgeAdsNative, unchanged) or, in a plain browser dev run, the local review
  // simulation the existing test suites use.
  const ADS = window.TivexaAds || localAds();
  // 1.0.1: the game-over emphasis hierarchy (spec 0088 §1) is ANDROID ONLY (relay 0093 §4). The browser build keeps the
  // 1.0.0 equal-weight buttons; ?android=1 lets the writer's browser e2e see the Android styling.
  if (NATIVE || /[?&]android=1\b/.test(location.search)) {
    document.documentElement.classList.add('nf-android');
    for (const s of ['#stuck-retry', '#eo-again']) { $(s).classList.remove('primary'); $(s).classList.add('secondary'); }
    for (const s of ['#stuck-levels', '#eo-levels']) $(s).classList.add('text-link');
  }
  // R-SAVE (owner relay 0059): after Begin a game that was in progress when the app closed resumes exactly where it was.
  const audio = TivexaLaunchAudio.init({ gameId: 'numberforge', title: 'Number Forge', chime: 'startup.wav', music: 'music.wav', vibration: true, onBegin: () => { if (!resumeActive()) showLevels(); if (NATIVE) try { window.ForgeAdsNative.start(); } catch (e) { } } });
  audio.renderToggles($('#menu-toggles'));

  // ---------------------------------------------------------------- state
  let screen = 'launch', mode = null, level = 0, n = 2, target = 0, game = null, finished = false, animating = false, pending = null;
  let prevBest = 0, newBestShown = false, endlessSeed = null;
  // M2 S1 option 1 (owner relay 0040): a challenge's goal is a tile within a move limit; running out of moves is a loss
  // (Try again / Levels; no ads or hints for it). Endless has no limit.
  let limit = Infinity;
  const ad = { activeMs: 0, countdownMs: null, due: false, showing: false, mode: 'show', skipAfterMs: 3000, closeAfterMs: 5000, events: [], snapshot: null, timers: [] };
  // RC (relay 0036 item 3): one optional rewarded moment, "Second chance: undo your last swipe", once per attempt on
  // game-over (campaign out of moves or forge full; Endless game over). Restart is always shown as the free alternative.
  let prevGame = null, secondChanceUsed = false;
  const rw = { mode: 'show', closeAfterMs: 5000, skipAfterMs: 3000, events: [] };
  // native ad results: window.__forgeAdResult(id, status); consent/banner state: window.__forgeAdsState(info)
  let adsState = null, adSeq = 0; const adWait = new Map();
  window.__forgeAdsState = (s) => { adsState = s; const p = $('#menu-privacy'); if (p) p.hidden = !(s && s.privacyOptionsRequired); };
  window.__forgeAdResult = (id, status) => { const f = adWait.get(id); adWait.delete(id); if (f) f(status); };
  const nativeAd = (kind) => new Promise((done) => { const id = kind[0] + (++adSeq); adWait.set(id, done); try { if (kind === 'interstitial') window.ForgeAdsNative.showInterstitial(id); else window.ForgeAdsNative.showRewarded(id); } catch (e) { adWait.delete(id); done('failed'); } });
  const say = (t) => { $('#status').textContent = t; };
  const anyDialog = () => !!document.querySelector('dialog[open]');
  const active = () => screen === 'play' && game && !finished && !document.hidden && !anyDialog() && !ad.showing && audio.core.begun && !audio.core.reasons.includes('app-paused');
  // fix round 1 (D2): on the play screen the toast takes the place of the footer hint (#status) in the page flow, so it
  // can never overlap the hint, the board or the title bar; elsewhere it floats at the bottom as before
  function toast(t) {
    const el = $('#toast'), st = $('#status'), inPlay = !$('#play-screen').hidden;
    el.hidden = true; clearTimeout(toast.t);
    if (inPlay) st.before(el); else document.body.append(el);
    el.classList.toggle('inline', inPlay); st.style.display = inPlay ? 'none' : '';
    void el.offsetWidth; el.textContent = t; el.hidden = false;
    toast.t = setTimeout(() => { el.hidden = true; st.style.display = ''; }, 1900);
  }

  // ---------------------------------------------------------------- R-SAVE: mid-level resume (owner relay 0059)
  // Every in-progress game is saved on every move and when the app is paused or hidden: per campaign level and for
  // Endless, with the board, the RNG state, moves, score, the limit, the last swipe (for the "Second chance" undo) and
  // whether that chance was used. A solved level's run is removed (the next one opens fresh). "Restart" (on the play
  // screen, and Try again / Play again after a loss) is the only way to reset a game. Settings and solved progress keep
  // their own keys. `active` remembers the game on screen, so a relaunch after Begin goes straight back into it.
  const RUN_KEY = 'tivexa-numberforge-runs';
  const readRuns = () => { const r = read(RUN_KEY); return r && r.v === 1 && r.rules === R.RULES && r.campaign === CAMPAIGN ? r : { v: 1, rules: R.RULES, campaign: CAMPAIGN, active: null, levels: {}, endless: null }; };
  let runs = readRuns();
  const okGame = (g, size) => g && Array.isArray(g.board) && g.board.length === size * size && Number.isInteger(g.moves) && Number.isFinite(g.score);
  function saveRun() {
    if (!game || screen !== 'play') return;
    if (mode === 'level' && R.best(game.board) >= target) return; // a won challenge is never saved again (pagehide after a win)
    const run = { game, prevGame, secondChanceUsed, finished, at: Date.now() };
    if (mode === 'level') runs.levels[level] = run; else run.prevBest = prevBest, run.newBestShown = newBestShown, runs.endless = run;
    runs.active = { mode, level };
    persist(RUN_KEY, JSON.stringify(runs));
  }
  function dropRun(which) { if (which === 'endless') runs.endless = null; else delete runs.levels[which]; runs.active = null; persist(RUN_KEY, JSON.stringify(runs)); }
  function clearActive() { if (!runs.active) return; runs.active = null; persist(RUN_KEY, JSON.stringify(runs)); }
  // put a saved run on screen (after the level/Endless fields are set); a game that had ended shows its result card again
  function restoreRun(run) {
    game = run.game; prevGame = okGame(run.prevGame, n) ? run.prevGame : null; secondChanceUsed = !!run.secondChanceUsed; finished = false; pending = null; animating = false;
    showPlay(); say('Welcome back: your game is exactly where you left it.');
    afterMove(); // a game that had ended (out of moves, forge full, Endless over) shows its card again; otherwise no-op
    saveRun();
  }
  function resumeActive() {
    const a = runs.active; if (!a) return false;
    if (a.mode === 'level' && LEVELS[a.level - 1] && unlocked(a.level) && runs.levels[a.level]) { startLevel(a.level); return true; }
    if (a.mode === 'endless' && chapterDone(1) && runs.endless) { startEndless(); return true; }
    clearActive(); return false;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveRun(); });
  window.addEventListener('pagehide', saveRun);
  { const lc = window.TivexaLifecycle; if (lc && lc.pause) { const p = lc.pause; lc.pause = function () { saveRun(); return p.apply(this, arguments); }; } }

  // ---------------------------------------------------------------- screens
  function showLevels() { if (screen === 'play') saveRun(); clearActive(); screen = 'levels'; document.documentElement.classList.remove('playing'); $('#play-screen').hidden = true; $('#levels-screen').hidden = false; renderLevels(); window.scrollTo(0, 0); }
  function showPlay() { screen = 'play'; document.documentElement.classList.add('playing'); $('#levels-screen').hidden = true; $('#play-screen').hidden = false; render(); window.scrollTo(0, 0); }
  function renderLevels() {
    const done = store.solved.length, pct = Math.round((done / LEVELS.length) * 100);
    $('#progress-text').textContent = `${done} / ${LEVELS.length} challenges forged`;
    $('#progress-fill').style.width = pct + '%'; $('.bar').setAttribute('aria-valuenow', String(pct));
    const open = chapterDone(1), e = $('#endless');
    e.disabled = !open; e.setAttribute('aria-label', open ? 'Endless Forge, 4 by 4, no target' : 'Endless Forge, locked until chapter 1 is complete');
    $('#endless-info').textContent = open ? `4×4 · no target · best score ${store.endless.bestScore} · best tile ${store.endless.bestTile || '–'}` : '🔒 Finish chapter 1 to unlock';
    const box = $('#chapters'); box.replaceChildren();
    const next = LEVELS.findIndex((_, i) => unlocked(i + 1) && !solved(i + 1)) + 1;
    const chapters = [...new Set(LEVELS.map((l) => l.chapter))];
    for (const c of chapters) {
      const idx = LEVELS.map((l, i) => (l.chapter === c ? i + 1 : 0)).filter(Boolean), ls = idx.map((i) => LEVELS[i - 1]);
      const sec = document.createElement('section'); sec.className = 'chapter';
      const boards = [...new Set(ls.map((l) => `${l.n}×${l.n}`))].join(' → '), goals = [...new Set(ls.map((l) => l.target))];
      // fix round 1 (D3): the summary states the real range of the chapter's move limits
      const lims = ls.map((l) => l.moveLimit), lo = Math.min(...lims), hi = Math.max(...lims);
      sec.innerHTML = `<h2>Chapter ${c}<small>${boards} · goal ${goals.length > 1 ? goals[0] + '–' + goals.at(-1) : goals[0]} · limits ${lo === hi ? lo : lo + '–' + hi} moves · ${idx.filter(solved).length}/${idx.length}</small></h2><div class="chips"></div>`;
      for (const i of idx) {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.level = i;
        const lock = !unlocked(i); b.textContent = lock ? '🔒' : String(i); b.disabled = lock;
        b.className = solved(i) ? 'solved' : i === next ? 'current' : '';
        b.setAttribute('aria-label', `Challenge ${i}: make ${LEVELS[i - 1].target} in ${LEVELS[i - 1].moveLimit} moves${lock ? ', locked' : solved(i) ? ', complete' : ''}`);
        b.title = `Make ${LEVELS[i - 1].target} in ${LEVELS[i - 1].moveLimit} moves`;
        b.onclick = () => startLevel(i); sec.querySelector('.chips').append(b);
      }
      box.append(sec);
    }
    renderCrossPromo();
  }
  // R6: "More Tivexa games": the OTHER live games from the bundled catalog (catalog.js, a copy of infra's
  // tivexa-catalog.json); market:// on Android (https fallback in the shell), the Play page in a browser. Hidden when empty.
  function renderCrossPromo() {
  }
  // ---------------------------------------------------------------- play
  // fresh = true: Restart / Try again (the only ways to reset); otherwise a saved run of this challenge resumes (R-SAVE)
  function startLevel(i, fresh) {
    const L = LEVELS[i - 1]; mode = 'level'; level = i; n = L.n; target = L.target; limit = L.moveLimit || Infinity;
    $('#play-title').textContent = `Challenge ${i}`;
    const run = !fresh && runs.levels[i]; if (run && okGame(run.game, n)) return restoreRun(run);
    game = { ...R.start(n, L.seed), score: 0, moves: 0 }; finished = false; pending = null; animating = false; prevGame = null; secondChanceUsed = false;
    showPlay(); say(`Make ${target} in ${limit} moves. Swipe to combine equal tiles.`); saveRun();
  }
  function startEndless(fresh) {
    if (!chapterDone(1)) return;
    mode = 'endless'; level = 0; n = 4; target = Infinity; limit = Infinity; prevBest = store.endless.bestScore; newBestShown = false;
    const run = !fresh && runs.endless;
    if (run && okGame(run.game, 4)) { prevBest = Number.isFinite(run.prevBest) ? run.prevBest : prevBest; newBestShown = !!run.newBestShown; $('#play-title').textContent = 'Endless Forge'; return restoreRun(run); }
    const seed = endlessSeed !== null ? endlessSeed : (Math.random() * 4294967296) >>> 0;
    game = { ...R.start(4, seed), score: 0, moves: 0 }; finished = false; pending = null; animating = false; prevGame = null; secondChanceUsed = false;
    $('#play-title').textContent = 'Endless Forge'; showPlay(); say('No target: keep forging until no moves remain.'); saveRun();
  }
  function render(m) {
    const board = $('#board'); board.style.setProperty('--n', n); board.replaceChildren();
    const cell = Math.max(30, (board.clientWidth || 300) / n);
    (game ? game.board : []).forEach((v, i) => {
      const t = document.createElement('div'); t.className = 'tile' + (v > 1024 ? ' big' : ''); t.dataset.v = v; t.dataset.i = i;
      t.textContent = v || ''; const len = String(v).length;
      t.style.setProperty('--fs', Math.round(cell * (len >= 4 ? 0.28 : len === 3 ? 0.34 : 0.42)) + 'px');
      if (m && i === m.spawned) t.classList.add('pop'); if (m && m.merged.includes(i)) t.classList.add('merge');
      board.append(t);
    });
    $('#hud-score').textContent = game ? game.score : 0;
    if (mode === 'level' && limit !== Infinity) { $('#hud-moves-label').textContent = 'MOVES LEFT'; $('#hud-moves').textContent = Math.max(0, limit - (game ? game.moves : 0)); }
    else { $('#hud-moves-label').textContent = 'MOVES'; $('#hud-moves').textContent = game ? game.moves : 0; }
    if (mode === 'endless') { $('#hud-goal-label').textContent = 'BEST'; $('#hud-goal').textContent = Math.max(store.endless.bestScore, game ? game.score : 0); }
    else { $('#hud-goal-label').textContent = 'GOAL'; $('#hud-goal').textContent = target; }
  }
  function requestMove(dir) {
    if (screen !== 'play' || !game || finished || ad.showing || ad.due || anyDialog()) return;
    if (animating) { pending = dir; return; }
    const m = R.move(game, dir, n);
    if (!m) { say('No tiles can move that way.'); return; }
    prevGame = game; game = m.game; if (m.gain) audio.vibrate(12);
    saveRun(); // R-SAVE: every move (a win removes the run in win())
    render(m); animating = true;
    setTimeout(() => { animating = false; afterMove(); if (pending !== null && !finished) { const d = pending; pending = null; requestMove(d); } else pending = null; }, ANIM_MS);
  }
  function afterMove() {
    if (mode === 'level') {
      if (R.best(game.board) >= target) return win();
      // 1.0.1 (spec 0088 §2, relay 0091 §3): the body line speaks to the offer ("one undo ..."); without an offer (used, or
      // no swipe to undo) the 1.0.0 line with the best tile stays. The forge-full kicker repeated the title and is gone; the
      // move-limit kicker stays (it carries the limit number, which the title does not).
      if (game.moves >= limit) { finished = true; $('#stuck-kicker').hidden = false; $('#stuck-kicker').textContent = `MOVE LIMIT: ${limit}`; $('#stuck-title').textContent = 'Out of moves'; body.stuck = ['One undo gives you that move back.', `Best tile: ${R.best(game.board)} (goal ${target}). Same start, same tiles: try again with fewer moves.`]; gameOver('stuck'); return; } // fix round j1208 D6: "Out of moves" / "MOVE LIMIT: n"
      if (!R.canMove(game.board, n)) { finished = true; $('#stuck-kicker').hidden = true; $('#stuck-kicker').textContent = ''; $('#stuck-title').textContent = 'No moves left'; body.stuck = ['One undo puts your board back the way it was.', `Best tile: ${R.best(game.board)} (goal ${target}). Same start, same tiles: try a different order.`]; gameOver('stuck'); }
      return;
    }
    const tile = R.best(game.board);
    if (tile > store.endless.bestTile) { store.endless.bestTile = tile; save(); }
    if (game.score > store.endless.bestScore) {
      store.endless.bestScore = game.score; save();
      if (!newBestShown && prevBest > 0) { newBestShown = true; toast('New best score!'); }
    }
    render();
    if (!R.canMove(game.board, n)) {
      finished = true; const best = game.score >= store.endless.bestScore && newBestShown;
      $('#eo-kicker').textContent = best ? 'NEW BEST!' : 'ENDLESS FORGE'; $('#eo-title').textContent = best ? 'A new best score' : 'Game over';
      body['endless-over'] = ['One undo puts your board back the way it was.', `Score ${game.score} · best tile ${tile}. Best ever: score ${store.endless.bestScore}, tile ${store.endless.bestTile}.`];
      gameOver('endless-over');
      reviewTrigger('endless');
    }
  }
  // ---------------------------------------------------------------- game over: the second chance (rewarded, optional)
  // 1.0.1 (spec 0088 §1-§3): h1, body, PRIMARY "Second chance" (play badge, the pulse), its microcopy, SECONDARY "Try
  // again (free)", text link "Back to levels". The emphasis is ANDROID ONLY (relay 0093 §4: a portal web build keeps the
  // decline equal to the accept): html.nf-android, set for the native build (and ?android=1 for the writer's e2e).
  const body = { stuck: ['', ''], 'endless-over': ['', ''] }, TEXT_ID = { stuck: '#stuck-text', 'endless-over': '#eo-text' };
  function setBody(id, offered) { $(TEXT_ID[id]).textContent = body[id][offered ? 0 : 1]; }
  // the pulse: restarted on every opening; CSS runs it 400 ms after the opening, 5 cycles, scale in place only
  function pulse(b) { b.classList.remove('pulse'); void b.offsetWidth; if (!b.hidden) b.classList.add('pulse'); }
  // job 1296: the offer exists only when the adapter can serve a rewarded ad (the web `none` adapter cannot, and the web
  // build has no offer elements at all); with the native adapter this is exactly the 1.0.1 behaviour
  function gameOver(id) {
    const b = $(`#${id}-second`), offer = !!b && ADS.canServe('rewarded') && !secondChanceUsed && !!prevGame;
    if (b) { b.hidden = !offer; b.disabled = false; $(`#${id}-second-note`).hidden = !offer; $(`#${id}-second-note`).textContent = NOTE; }
    setBody(id, offer); $('#' + id).showModal(); if (b) pulse(b);
  }
  // ---------------------------------------------------------------- R6: in-app review (Android only; the page decides when)
  const REVIEW_KEY = 'tivexa-numberforge-review', DAY = 86400000;
  const reviewState = () => read(REVIEW_KEY) || { requestedAt: 0, done: false, endlessOvers: 0, log: [] };
  window.__forgeReviewResult = (id, status) => { const s = reviewState(); if (status === 'requested') s.done = true; s.log.push({ id, status, at: Date.now() }); try { localStorage.setItem(REVIEW_KEY, JSON.stringify(s)); } catch (e) { } };
  // once after the 10th completed level or the 3rd Endless game-over, never after a loss, at most once per 30 days,
  // never again once it was requested
  function reviewTrigger(kind) {
    const s = reviewState();
    if (kind === 'endless') s.endlessOvers = (s.endlessOvers || 0) + 1;
    const due = kind === 'win' ? store.solved.length >= 10 : s.endlessOvers >= 3;
    const allowed = !s.done && (!s.requestedAt || Date.now() - s.requestedAt >= 30 * DAY);
    if (due && allowed) {
      s.requestedAt = Date.now(); s.log.push({ asked: kind, at: s.requestedAt, native: !!window.ForgeReviewNative });
      if (window.ForgeReviewNative) try { window.ForgeReviewNative.request('rv' + s.requestedAt); } catch (e) { }
    }
    try { localStorage.setItem(REVIEW_KEY, JSON.stringify(s)); } catch (e) { }
  }
  function win() {
    finished = true; if (!solved(level)) { store.solved.push(level); save(); }
    dropRun(level); // R-SAVE: a solved challenge opens fresh next time
    const last = level === LEVELS.length, unlockedEndless = LEVELS[level - 1].chapter === 1 && chapterDone(1) && !(LEVELS[level] && LEVELS[level].chapter === 1);
    $('#win-title').textContent = last ? 'Campaign complete!' : 'Challenge complete';
    $('#win-text').textContent = `You forged ${target} in ${game.moves} of ${limit} moves (score ${game.score}).` + (unlockedEndless ? ' Endless Forge is now unlocked.' : '');
    $('#win-next').textContent = last ? 'Levels' : 'Next challenge'; $('#win').showModal();
    reviewTrigger('win');
  }
  // ---------------------------------------------------------------- timed interstitial (native; local simulation in a dev browser)
  // job 1296: the whole block is absent from the web build (//@web-strip); the adapter gate keeps it off for any adapter
  // that cannot serve an interstitial
  // ---------------------------------------------------------------- input
  // M2 S2b: the whole play screen is the gesture area (document-level listeners while the play screen shows). A gesture
  // starting on a button (‹ Levels, Menu…), on the ad banner strip or inside an open dialog is not a swipe.
  let touch = null;
  const swipeStart = (t) => screen === 'play' && !anyDialog() && !(t && t.closest && (t.closest('button, a, input, dialog, #ad-banner, .la-launch')));
  document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; touch = swipeStart(e.target) ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null; });
  document.addEventListener('pointerup', (e) => {
    if (!touch || touch.id !== e.pointerId) return; const dx = e.clientX - touch.x, dy = e.clientY - touch.y; touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    requestMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  });
  document.addEventListener('pointercancel', () => { touch = null; });
  // A swipe must not start the browser's own touch gesture (scroll/fling): that gesture swallowed the click of the next
  // tap on a button (qa/m1/DIAG_LOST_TAP.md). M2: on the whole play screen, not only the board.
  // Every drag on the play screen is cancelled, including one that starts on a button and is not a game swipe: otherwise
  // that drag starts a browser gesture which swallows the next tap's click (e2e-m2 lease 2942 at 412/875).
  document.addEventListener('touchmove', (e) => { if (screen === 'play' && !anyDialog() && e.cancelable) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', (e) => { const d = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].indexOf(e.key); if (d >= 0 && screen === 'play' && !anyDialog()) { e.preventDefault(); requestMove(d); } });
  // ---------------------------------------------------------------- controls
  $('#back').onclick = () => showLevels();
  $('#endless').onclick = () => startEndless();
  $('#menu-button').onclick = () => $('#menu').showModal(); $('#menu-close').onclick = () => $('#menu').close();
  // M2 D2: the confirmation REPLACES the Menu sheet (never stacked on it); Cancel goes back to the Menu.
  $('#reset-progress').onclick = () => { $('#menu').close(); $('#confirm-reset').showModal(); };
  $('#reset-no').onclick = () => { $('#confirm-reset').close(); $('#menu').showModal(); };
  $('#confirm-reset').addEventListener('cancel', (e) => { e.preventDefault(); $('#confirm-reset').close(); $('#menu').showModal(); });
  $('#reset-yes').onclick = () => { store = fresh(); save(); $('#confirm-reset').close(); renderLevels(); toast('Progress reset'); };
  $('#win-next').onclick = () => { $('#win').close(); if (level < LEVELS.length) startLevel(level + 1); else showLevels(); };
  $('#win-levels').onclick = () => { $('#win').close(); showLevels(); };
  $('#stuck-retry').onclick = () => { $('#stuck').close(); startLevel(level, true); };
  // R-SAVE: Restart on the play screen is the way to reset a game in progress (a saved game otherwise resumes)
  $('#restart').onclick = () => { if (screen !== 'play' || ad.showing) return; if (mode === 'level') startLevel(level, true); else startEndless(true); say('Restarted: a fresh board.'); }; $('#stuck-levels').onclick = () => { $('#stuck').close(); showLevels(); };
  $('#eo-again').onclick = () => { $('#endless-over').close(); startEndless(true); }; $('#eo-levels').onclick = () => { $('#endless-over').close(); showLevels(); };
  for (const id of ['win', 'stuck', 'endless-over']) $('#' + id).addEventListener('cancel', (e) => { e.preventDefault(); $('#' + id).close(); showLevels(); });
  window.addEventListener('resize', () => { if (screen === 'play') render(); });
  // Android Back (shell): an open dialog is closed by the shell; on the play screen Back returns to the levels.
  window.TivexaBack = () => { if (screen === 'play') { showLevels(); return true; } return false; };
})();
