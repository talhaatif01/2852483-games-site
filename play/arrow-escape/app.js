/* Arrow Escape (independent Tivexa app). Arrow-only rewrite of the intake's shared app.js (sha256 bbd5dcc6...).
   M2 (job 1083, owner 2026-11-04):
   - launch and audio through the shared Tivexa module (shared/launch-audio): one Begin button, the chime on that tap,
     then the ambient loop; Menu toggles for Music and Sound effects, saved; music pauses in the background, in dialogs
     and during an ad;
   - lives: 10, one per blocked tap (rotation, zoom, undo and clear taps never cost one); undo never refunds a life;
   - out of lives: "Restart level" or "Watch ad for +5 lives". On Android the ad is a REAL rewarded ad from Google's TEST
     unit (window.ArrowAdsNative, consent first, Sortwise pattern); the browser review build keeps the simulated panel.
     Load failure, skip or early close grants nothing and the dialog stays; a reward grants +5 lives once per ad and the
     game resumes exactly: same board, same cube pose (the view is not remounted) and the same play clock (an ad never
     resets it);
   - Restart / Undo / Level menu sit above the board (above the fold at 360x780); every control is at least 44 CSS px;
   - interstitial opportunity only at a level break after 180 s of active play, as in M1 (simulated). */
'use strict';
const $ = s => document.querySelector(s), board = $('#board');
const LEVELS = window.ARROW_LEVELS || [];
const SAVE_KEY = 'tivexa-arrowescape-v2', RULES = 'arrowescape-m2';
const QA = new URLSearchParams(location.search).get('qa') === '1';
let level = 1, data = null, state = [], moves = 0, wrong = 0, finished = false, store = {}, undoStack = [];
const adClock = CubeRules.createAdClock();
// A saved out-of-lives state shows its dialog only after Begin, never over the launch screen (emulator lease 2917).
// RC (job 1103): on Android, Begin also starts the ads layer: Google's consent (UMP) first, before any ad request, then
// the banner (its own slot under the game) and one preloaded interstitial. Never over the launch screen.
const NATIVE_ADS = !!(window.ArrowAdsNative && typeof window.ArrowAdsNative.start === 'function');
// RC layout (job 1118, owner relay 0029/0030): Begin -> Menu (Music / Sound effects / Vibration via the shared module,
// exactly as Number Forge) -> Levels -> Play (cube + HUD only). Haptics: 12 ms on every cleared block, 40 ms on a level
// complete, none on a blocked tap; all through audio.vibrate(), which respects the Vibration toggle.
const audio = TivexaLaunchAudio.init({ gameId: 'arrowescape', title: 'Arrow Escape', chime: 'startup.wav', music: 'music.wav', vibration: true, onBegin: () => { if (NATIVE_ADS) window.ArrowAdsNative.start(); showMenu(); } });
let screen = 'launch';
const st = window.__arrow = { rewardGrants: 0, rewardResults: [], interstitials: 0, adRequests: [], get clock() { return adClock.elapsed; }, get level() { return level; }, get wrong() { return wrong; }, get livesLeft() { return store.bank; }, get blocks() { return state.map(b => b.id); }, get finished() { return finished; }, get moves() { return moves; }, get undoDepth() { return undoStack.length; }, get screen() { return screen; }, get unlocked() { return unlocked(); }, audio: () => audio.state() };
// QA-only (automated checks): with ?qa=1 the tests may add active-play time instead of waiting 180 s (simulated clock).
if (QA) { st.addPlayTime = ms => adClock.tick(ms, true); st.openLevel = i => { level = i; start(true); showPlay(); }; }
let lastTick = performance.now();
// The clock runs only during active play: not after the level is solved, not at zero lives, not while any dialog is open, not while hidden or during an ad.
setInterval(() => { const now = performance.now(); adClock.tick(Math.min(1000, now - lastTick), audio.core.begun && screen === 'play' && !finished && store.bank > 0 && !document.hidden && !document.querySelector('dialog[open]') && !adShowing && !audio.core.reasons.includes('app-paused')); lastTick = now; }, 250);

// 1.0.1 B2: the life bank lives in the save (store.bank). On Android the WebView commits localStorage lazily, so a save
// made just before the app is killed can be lost (Number Forge RC, emulator lease 3068): window.ArrowStore
// (SharedPreferences, synchronous commit) keeps a durable copy and is read first. The browser build uses localStorage.
function load() { try { const d = window.ArrowStore && window.ArrowStore.get(SAVE_KEY); const s = JSON.parse(d || localStorage.getItem(SAVE_KEY) || '{}'); return s && typeof s === 'object' && !Array.isArray(s) && s.rulesVersion === RULES ? s : null; } catch { return null; } }
store = load() || { rulesVersion: RULES, solved: [], runs: {} };
store.bank = CubeRules.bankOf(store.bank); // a 1.0.0 save has no bank: it starts at the starting count
function save() { const v = JSON.stringify(store); try { if (window.ArrowStore) window.ArrowStore.set(SAVE_KEY, v); } catch { } try { localStorage.setItem(SAVE_KEY, v); } catch { $('#status').textContent = 'Storage unavailable: progress lasts for this session only.'; } }
function blocksOf(lv) { const n = lv.n; return [...lv.dirs].map((d, i) => ({ id: i, x: i % n, y: Math.floor(i / n) % n, z: Math.floor(i / (n * n)), d: Number(d) })); }
function saveRun() { store.runs[level] = { ids: state.map(b => b.id), wrong, moves }; save(); }
const unlocked = () => Math.min(LEVELS.length, Math.max(1, ...store.solved.map(n => n + 1)));

function start(fresh = false) {
  data = LEVELS[level - 1]; const all = blocksOf(data);
  const run = fresh ? null : store.runs[level];
  const ids = run && Array.isArray(run.ids) && run.ids.length ? new Set(run.ids) : null;
  state = all.filter(b => !ids || ids.has(b.id));
  wrong = ids ? Math.max(0, Number(run.wrong) || 0) : 0; // blocked taps on this level (a statistic; lives are the bank)
  moves = ids ? Math.max(0, Number(run.moves) || 0) : 0; finished = false; undoStack = [];
  saveRun();
  for (const d of ['#complete', '#lives']) if ($(d).open) $(d).close();
  $('#ad-preview').hidden = true; $('#next').disabled = false; $('#close').disabled = false;
  $('#status').textContent = '';
  // The cube view is mounted once per level (job 1035, DIAG_360.md); later renders only update its blocks.
  view = ArrowCube.mount(board, $('#controls'), state, data.n, tapBlock);
  render();
}

// ---- screens: Menu -> Levels -> Play (Back goes the other way; Back on the Menu leaves the app)
function show(name) {
  screen = name; clearTimeout(autoNext);
  for (const s of ['menu', 'levels', 'play']) $(`#${s}-screen`).hidden = s !== name;
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function showMenu() { show('menu'); $('#menu-progress').textContent = `${store.solved.length} / ${LEVELS.length} levels solved`; }
function showLevels() { if ($('#complete').open) $('#complete').close(); show('levels'); renderLevels(); }
function showPlay() {
  show('play');
  if (view) view.update(state); // the board was hidden: size it now
  if (store.bank <= 0 && !finished && audio.core.begun) setTimeout(openLives, 200); // a saved out-of-lives state, never over the launch screen
}
function renderLevels() {
  $('#progress').textContent = `${store.solved.length} / ${LEVELS.length} levels solved`;
  const list = $('#levels'); list.replaceChildren(); const open = unlocked();
  for (let i = 1; i <= LEVELS.length; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.level = i; b.textContent = i > open ? '🔒' : String(i);
    b.className = `${i === level ? 'active ' : ''}${store.solved.includes(i) ? 'solved' : ''}`;
    b.setAttribute('aria-label', `Level ${i}${i > open ? ', locked' : store.solved.includes(i) ? ', solved' : ''}`);
    b.disabled = i > open; b.onclick = () => { level = i; start(); showPlay(); }; list.append(b);
  }
}

let view = null;
function render() {
  $('#level').textContent = `Level ${level}`; // 1.0.1 B1: no "3×3×3" size label
  $('#counter').textContent = `♥ ${store.bank}`;
  $('#counter').setAttribute('aria-label', `${store.bank} ${store.bank === 1 ? 'life' : 'lives'}, ${state.length} blocks left`);
  $('#undo').disabled = finished || !undoStack.length;
  view.update(state);
}

function tapBlock(id) {
  st.lastTap = id; // read-only trace for the automated checks
  if (finished) return;
  if (store.bank <= 0) { openLives(); return; }
  const c = state.find(b => b.id === id); if (!c) return;
  if (!CubeRules.clear(c, state, data.n)) {
    wrong++; store.bank = CubeRules.loseLife(store.bank); saveRun(); render();
    $('#status').textContent = `Blocked path · ${store.bank} ${store.bank === 1 ? 'life' : 'lives'} left. Turn the cube to see what is in front of this arrow.`;
    if (store.bank === 0) setTimeout(() => { if (store.bank <= 0 && screen === 'play') openLives(); }, CARD_DELAY_MS); // not under the finger of the deciding tap
    return;
  }
  undoStack.push(c);
  state = state.filter(b => b.id !== id); moves++; saveRun(); render();
  audio.vibrate(12); st.haptics = [...(st.haptics || []), 12]; // every cleared block; never on a blocked tap
  $('#status').textContent = 'Block cleared. Keep looking for an open path.';
  if (!state.length) win();
}
/** Undo puts the last cleared block back. It never refunds a life (lives count blocked taps, not cleared blocks). */
function undo() {
  if (finished || !undoStack.length) return;
  const c = undoStack.pop(); state = [...state, c].sort((a, b) => a.id - b.id); moves = Math.max(0, moves - 1); saveRun(); render();
  $('#status').textContent = 'Undone: the block is back. Lives are unchanged.';
}

function win() {
  finished = true; if (!store.solved.includes(level)) store.solved.push(level); delete store.runs[level];
  store.bank = CubeRules.winLife(store.bank); store.completed = (store.completed || 0) + 1; save(); render(); // B2: +1 life per completed level
  r6AfterWin();
  $('#status').textContent = ''; // fix round 2 (review j1133 D2): no stale "Block cleared..." text behind the level-complete card
  const last = level === LEVELS.length;
  $('#complete-title').textContent = last ? 'Campaign complete!' : 'Level complete!';
  $('#complete-text').textContent = `Cleared in ${moves} moves. +1 life (♥ ${store.bank}). ${last ? 'Every level is solved.' : 'The next level is unlocked.'}`;
  $('#next').textContent = last ? 'Back to levels' : 'Next level →';
  setTimeout(() => { audio.vibrate(40); st.haptics = [...(st.haptics || []), 40]; }, 90); // level complete: a slightly longer pulse after the last block's
  // An interstitial opportunity exists only at this natural break, and only after 180 s of active play. Android (RC):
  // the real interstitial is shown when the player taps "Next level" (never over the result card); the browser build
  // keeps the local simulation inside the card.
  const due = adClock.atBreak(true);
  interstitialDue = due && NATIVE_ADS;
  const preview = due && !NATIVE_ADS;
  $('#ad-preview').hidden = !preview; $('#next').disabled = preview; $('#close').disabled = preview;
  // RC (job 1118): the card opens a moment after the winning tap, so that tap's own click can never land on a card button
  // that appears under the finger (rc-layout at 360/412: it hit "Levels").
  setTimeout(() => {
    if (!finished || screen !== 'play' || $('#complete').open) return;
    $('#complete').showModal();
    if (preview) { adClock.shown(); st.interstitials++; }
    // RC (owner 0029): a win advances into the next level by itself (after the card has been seen); a simulated ad in
    // the card holds it until the ad is closed. "Next level" goes at once; "Levels" goes to the Levels screen.
    else if (!last) autoNext = setTimeout(() => { if ($('#complete').open && screen === 'play') $('#next').click(); }, AUTO_NEXT_MS);
  }, CARD_DELAY_MS);
}
const CARD_DELAY_MS = 350;
const AUTO_NEXT_MS = 1800;
let interstitialDue = false, autoNext = 0;
/** Android: show the preloaded interstitial between levels, then continue. Nothing is granted or lost either way. */
function showInterstitialThen(next) {
  const id = `i${Date.now()}-${++adSeq}`;
  st.pendingInterstitial = { id, next, board: state.map(b => b.id).join(','), clock: adClock.elapsed };
  st.adRequests.push({ id, kind: 'interstitial', at: Date.now() });
  adShowing = true; audio.pause('ad');
  window.ArrowAdsNative.showInterstitial(id);
}
function interstitialResult(p, status) {
  adShowing = false; audio.resume('ad');
  if (status === 'closed') { adClock.shown(); st.interstitials++; }
  st.interstitialResults = [...(st.interstitialResults || []), { id: p.id, status, clockKept: adClock.elapsed === p.clock || status === 'closed' }];
  p.next();
}

// ---- out of lives: Restart level, or Watch ad for +5 lives
let adShowing = false, adSeq = 0;
const granted = new Set();
function openLives() {
  if ($('#lives').open) return;
  $('#reward-preview').hidden = true; $('#reward-watch').hidden = false; $('#reward-watch').disabled = false; $('#reward-msg').textContent = '';
  $('#lives').showModal();
}
function rewardResult(p, status) {
  const id = p.id, before = p.board;
  adShowing = false; audio.resume('ad');
  if (status === 'rewarded' && !granted.has(id)) { granted.add(id); store.bank = CubeRules.adLife(store.bank); st.rewardGrants++; saveRun(); } // B2: +1 life per ad
  const boardKept = state.map(b => b.id).join(',') === before;
  st.rewardResults.push({ id, status, boardKept, poseKept: JSON.stringify(view.quat) === JSON.stringify(p.quat), clockKept: adClock.elapsed === p.clock, livesLeft: store.bank, clock: adClock.elapsed });
  $('#reward-watch').disabled = false;
  if (status === 'rewarded') {
    if ($('#lives').open) $('#lives').close(); render();
    $('#status').textContent = `Reward received: +${CubeRules.REWARD_LIVES} life (♥ ${store.bank}). Your cube is exactly as you left it.`;
  } else {
    $('#reward-msg').textContent = status === 'closed' ? 'The ad was closed before the end, so no lives were added. Your cube is unchanged.'
      : status === 'consent' ? 'Ads are not available with your current privacy choices. You can restart the level for free.'
        : 'No ad could be shown right now, so no lives were added. Your cube is unchanged.';
    if (!$('#lives').open) $('#lives').showModal();
  }
}
// Android: the native bridge answers here (window.__arrowAdResult(requestId, status)); each request id is granted at most once.
window.__arrowAdResult = (id, status) => { if (st.pendingInterstitial && st.pendingInterstitial.id === id) { const p = st.pendingInterstitial; st.pendingInterstitial = null; interstitialResult(p, status); return; } if (st.pending && st.pending.id === id) { const p = st.pending; st.pending = null; rewardResult(p, status); } else st.rewardResults.push({ id, status, ignored: 'unknown or already settled request' }); };
$('#reward-watch').onclick = () => {
  const native = window.ArrowAdsNative && typeof window.ArrowAdsNative.showRewarded === 'function';
  if (!native) { $('#reward-preview').hidden = false; $('#reward-watch').hidden = true; return; } // browser review build: simulated panel
  const id = `r${Date.now()}-${++adSeq}`;
  st.pending = { id, board: state.map(b => b.id).join(','), quat: view.quat, clock: adClock.elapsed };
  st.adRequests.push({ id, at: Date.now() });
  adShowing = true; audio.pause('ad'); $('#reward-watch').disabled = true; $('#reward-msg').textContent = 'Loading the ad…';
  window.ArrowAdsNative.showRewarded(id);
};
// Browser review build only: the simulated rewarded paths (reward / cancel / error / duplicate callback).
for (const outcome of ['reward', 'cancel', 'error', 'duplicate']) {
  $(`#reward-${outcome}`).onclick = async () => {
    const buttons = [...document.querySelectorAll('#reward-preview button')]; buttons.forEach(b => b.disabled = true);
    $('#reward-msg').textContent = 'Simulated ad playing…';
    const id = `s${++adSeq}`; st.pending = { id, board: state.map(b => b.id).join(','), quat: view.quat, clock: adClock.elapsed }; adShowing = true; audio.pause('ad');
    let rewarded = false;
    const result = await ArrowAds.showRewarded(outcome, () => { rewarded = true; });
    buttons.forEach(b => b.disabled = false);
    const p = st.pending; st.pending = null;
    rewardResult(p, result === 'rewarded' && rewarded ? 'rewarded' : result === 'closed' ? 'closed' : 'unavailable');
    if (result === 'rewarded') $('#reward-preview').hidden = true;
  };
}
$('#life-restart').onclick = () => { store.bank = CubeRules.restartLives(store.bank); start(true); render(); $('#status').textContent = `Fresh start: the level is reset and you have ♥ ${store.bank}.`; };
$('#ad-close').onclick = () => { $('#ad-preview').hidden = true; $('#next').disabled = false; $('#close').disabled = false; if (level < LEVELS.length) autoNext = setTimeout(() => { if ($('#complete').open && screen === 'play') $('#next').click(); }, AUTO_NEXT_MS); };
const goNext = () => { clearTimeout(autoNext); if (level < LEVELS.length) { level++; start(); showPlay(); } else showLevels(); };
$('#next').onclick = () => { clearTimeout(autoNext); if (interstitialDue && NATIVE_ADS) { interstitialDue = false; $('#complete').close(); showInterstitialThen(goNext); } else goNext(); };
$('#close').onclick = () => showLevels();
$('#reset').onclick = () => start(true);
$('#undo').onclick = () => undo();
$('#back').onclick = () => showLevels();
$('#levels-back').onclick = () => showMenu();
$('#play-btn').onclick = () => showLevels();
// Fix round 1 (D6): How to play is a tappable row that opens the help card.
$('#how-btn').onclick = () => $('#help-card').showModal();
$('#help-close').onclick = () => $('#help-card').close();
audio.renderToggles($('#menu-toggles'));
// RC: Google's privacy options, in the Menu only where consent rules require the entry (UMP), Android only.
window.__arrowAdsState = (s) => { st.ads = s; $('#menu-privacy').hidden = !(s && s.privacyOptionsRequired); };
$('#menu-privacy').onclick = () => { if (NATIVE_ADS) window.ArrowAdsNative.showPrivacyOptions(); };
$('.note').textContent = NATIVE_ADS ? 'Progress stays on this device.' : 'Browser review build: ads are a local simulation · progress stays on this device';
// Android Back (shell): an open dialog is closed by the shell first; then Play -> Levels -> Menu -> the app exits.
window.TivexaBack = () => { if (screen === 'play') { showLevels(); return true; } if (screen === 'levels') { showMenu(); return true; } return false; };
// ---- 1.0.1 R6 (RC_COMMON R6, relay 0050 option A; appended by Edit per relay 0061)
// More Tivexa games: one card per catalog game other than this one (www/catalog.js, from staging tivexa-catalog.json).
// Android opens market:// (the shell falls back to the https Play page); the browser build opens the https page.
(function renderMoreGames() {
  const cat = window.TIVEXA_CATALOG, list = $('#more-games-list'); if (!cat || !list) return;
  const games = (cat.games || []).filter(g => g.package && g.package !== 'com.tivexa.arrowescape');
  list.replaceChildren(...games.map(g => {
    const a = document.createElement('a'); a.className = 'promo-card'; a.dataset.package = g.package; a.rel = 'noopener'; a.target = '_blank';
    a.href = NATIVE_ADS ? `market://details?id=${encodeURIComponent(g.package)}` : g.play_url;
    const img = document.createElement('img'); img.src = g.icon; img.alt = ''; img.width = 48; img.height = 48;
    const t = document.createElement('span'); const n = document.createElement('strong'); n.textContent = g.name; const s = document.createElement('small'); s.textContent = 'On Google Play';
    t.append(n, s); a.append(img, t); return a;
  }));
  if (cat.developer_page) $('#all-games').href = cat.developer_page;
  $('#more-games').hidden = !games.length;
})();
// Rate prompt: the Google Play In-App Review API (window.ArrowReviewNative, com.google.android.play:review) once the
// player has completed 10 levels; asked only right after a win (never after a loss), at most once per 30 days, and never
// again once a request went through. Google decides whether its card appears. Browser build: recorded, no card.
const REVIEW_KEY = 'tivexa-arrowescape-review', REVIEW_AFTER = 10, REVIEW_GAP_MS = 30 * 864e5;
st.reviewRequests = []; st.reviewResults = [];
function reviewState() { try { const d = window.ArrowStore && window.ArrowStore.get(REVIEW_KEY); return JSON.parse(d || localStorage.getItem(REVIEW_KEY) || '{}') || {}; } catch { return {}; } }
function setReviewState(r) { const v = JSON.stringify(r); try { if (window.ArrowStore) window.ArrowStore.set(REVIEW_KEY, v); } catch { } try { localStorage.setItem(REVIEW_KEY, v); } catch { } }
function r6AfterWin(now = Date.now()) {
  if (Math.max(store.completed || 0, store.solved.length) < REVIEW_AFTER) return;
  const r = reviewState(); if (r.requested || (r.lastAsk && now - r.lastAsk < REVIEW_GAP_MS)) return;
  r.lastAsk = now; r.asks = (r.asks || 0) + 1; setReviewState(r);
  const id = `v${now}-${++adSeq}`; st.reviewRequests.push({ id, at: now, completed: store.completed });
  if (window.ArrowReviewNative && typeof window.ArrowReviewNative.request === 'function') { try { window.ArrowReviewNative.request(id); } catch { window.__arrowReviewResult(id, 'unavailable'); } }
  else window.__arrowReviewResult(id, 'unavailable'); // browser build: no Play, a silent no-op (retried after 30 days)
}
window.__arrowReviewResult = (id, status) => { const r = reviewState(); if (status === 'requested') r.requested = true; r.last = status; setReviewState(r); st.reviewResults.push({ id, status }); };
if (QA) { st.reviewState = () => reviewState(); st.setBank = n => { store.bank = n; save(); render(); }; st.store = () => JSON.parse(JSON.stringify(store)); st.r6AfterWin = t => r6AfterWin(t); }

level = Math.min(unlocked(), LEVELS.length);
start(); // the current level is ready behind the launch screen; screens appear after Begin
