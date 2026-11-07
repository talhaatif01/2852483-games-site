/* Tivexa launch + audio module v1 (job 1049). Game-agnostic; see README.md.
   - Launch screen: Tivexa wordmark, the game title and ONE "Begin" button. The logo animation leads into the button.
   - Begin is the user activation: the startup chime starts on that tap (if Sound effects is on), then the game's ambient
     loop fades in (if Music is on). Begin never changes a saved preference.
   - Preferences (Music, Sound effects, optional Vibration) default ON and persist under a per-game key.
   - Music pauses while the page is hidden (visibilitychange / pagehide / Android onPause through window.TivexaLifecycle),
     while a <dialog> is open (unless it has data-la-keep-music), and for any reason a game adds (pause('ad') etc.).
   No network, no dependencies. Exposes globalThis.TivexaLaunchAudio; in Node, module.exports = { createCore }. */
(function (root) {
  'use strict';
  const VERSION = 1, DEFAULTS = { music: true, sfx: true, vibration: true };
  const keyFor = (gameId) => `tivexa-launch-audio-v${VERSION}:${gameId}`;

  /** Pure part (no DOM): preferences, pause reasons and the music decision. Unit-tested in Node. */
  function createCore({ gameId, storage, vibration = false }) {
    if (!gameId || !/^[a-z0-9-]+$/.test(gameId)) throw new Error('gameId must be lower-case letters, digits or dashes');
    const names = vibration ? ['music', 'sfx', 'vibration'] : ['music', 'sfx'];
    let prefs = {};
    for (const n of names) prefs[n] = DEFAULTS[n];
    try { const s = JSON.parse(storage.getItem(keyFor(gameId)) || 'null'); if (s && typeof s === 'object') for (const n of names) if (typeof s[n] === 'boolean') prefs[n] = s[n]; } catch (e) { /* defaults */ }
    const reasons = new Set(); let begun = false;
    const core = {
      key: keyFor(gameId), names,
      get prefs() { return { ...prefs }; },
      get begun() { return begun; },
      get reasons() { return [...reasons].sort(); },
      setPref(name, value) {
        if (!names.includes(name)) throw new Error('unknown preference ' + name);
        prefs[name] = !!value; try { storage.setItem(keyFor(gameId), JSON.stringify(prefs)); } catch (e) { }
        return core.prefs;
      },
      begin() { const first = !begun; begun = true; return { first, chime: first && prefs.sfx, music: prefs.music }; },
      pause(reason) { reasons.add(String(reason)); },
      resume(reason) { reasons.delete(String(reason)); },
      /** Music plays only after Begin, with Music on and no pause reason. */
      shouldPlayMusic() { return begun && prefs.music && reasons.size === 0; },
      canVibrate() { return names.includes('vibration') && prefs.vibration; },
    };
    return core;
  }

  /** DOM part. opts: { gameId, title, kicker?, chime, music, musicVolume=0.28, chimeVolume=0.3, fadeMs=1800,
   *  chimeLeadMs=900, vibration=false, onBegin(), mount=document.body } */
  function init(opts) {
    const doc = root.document, core = createCore({ gameId: opts.gameId, storage: root.localStorage, vibration: !!opts.vibration });
    const musicVolume = opts.musicVolume ?? 0.28, fadeMs = opts.fadeMs ?? 1800, lead = opts.chimeLeadMs ?? 900;
    const chime = new Audio(opts.chime), music = new Audio(opts.music);
    chime.volume = opts.chimeVolume ?? 0.3; music.loop = true; music.volume = 0; chime.preload = music.preload = 'auto';
    chime.id = 'la-chime'; music.id = 'la-music'; chime.hidden = music.hidden = true;
    const trace = { beginAt: null, chimePlayingAt: null, chimeError: null, musicStartAt: null, musicError: null, fadeDoneAt: null };
    let fadeTimer = null, startTimer = null;
    function fadeIn() {
      clearInterval(fadeTimer); const t0 = performance.now(), v0 = music.volume;
      fadeTimer = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / fadeMs); music.volume = v0 + (musicVolume - v0) * k; if (k >= 1) { clearInterval(fadeTimer); trace.fadeDoneAt = performance.now(); } }, 50);
    }
    function sync() {
      if (core.shouldPlayMusic()) {
        if (music.paused) { music.play().then(() => { if (trace.musicStartAt === null) trace.musicStartAt = performance.now(); fadeIn(); }).catch((e) => { trace.musicError = String(e && e.name || e); }); }
      } else { clearInterval(fadeTimer); if (!music.paused) music.pause(); if (doc.hidden) chime.pause(); }
    }
    // ---- launch screen
    const screen = doc.createElement('section');
    screen.id = 'la-launch'; screen.className = 'la-launch'; screen.setAttribute('aria-label', `${opts.title} launch screen`);
    screen.innerHTML = `<div class="la-glow" aria-hidden="true"></div><div class="la-mark" role="img" aria-label="Tivexa">TIVEXA</div><p class="la-studios">STUDIOS</p><h1 class="la-title"></h1><button type="button" id="la-begin" class="la-begin">Begin</button>`;
    screen.querySelector('.la-title').textContent = opts.title;
    (opts.mount || doc.body).append(screen, chime, music);
    const beginBtn = screen.querySelector('#la-begin');
    beginBtn.addEventListener('click', () => {
      trace.beginAt = performance.now();
      const b = core.begin();
      if (b.chime) { chime.currentTime = 0; chime.addEventListener('playing', () => { if (trace.chimePlayingAt === null) trace.chimePlayingAt = performance.now(); }, { once: true }); chime.play().catch((e) => { trace.chimeError = String(e && e.name || e); }); }
      // the loop fades in after the chime has had its moment (at once if Sound effects is off)
      clearTimeout(startTimer); startTimer = setTimeout(sync, b.chime ? lead : 0);
      screen.classList.add('la-leaving'); setTimeout(() => { screen.hidden = true; }, 260);
      if (opts.onBegin) opts.onBegin();
    });
    // ---- pause sources
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) core.pause('hidden'); else core.resume('hidden'); sync(); });
    root.addEventListener('pagehide', () => { core.pause('hidden'); sync(); });
    root.addEventListener('pageshow', () => { if (!doc.hidden) { core.resume('hidden'); sync(); } });
    const dialogs = () => [...doc.querySelectorAll('dialog[open]')].filter((d) => !d.hasAttribute('data-la-keep-music')).length;
    new MutationObserver(() => { if (dialogs()) core.pause('dialog'); else core.resume('dialog'); sync(); }).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    // Android shell hook: MainActivity calls these from onPause / onResume.
    root.TivexaLifecycle = { pause() { core.pause('app-paused'); sync(); }, resume() { core.resume('app-paused'); sync(); } };
    const api = {
      core, version: VERSION, trace,
      get prefs() { return core.prefs; },
      setPref(name, v) { core.setPref(name, v); if (name === 'sfx' && !v) chime.pause(); sync(); },
      pause(reason) { core.pause(reason); sync(); }, resume(reason) { core.resume(reason); sync(); },
      /** A short effect sound for games that have one (respects Sound effects). */
      playEffect(audio) { if (core.begun && core.prefs.sfx && audio) { try { audio.currentTime = 0; audio.play().catch(() => { }); } catch (e) { } } },
      /** Haptics: Android bridge (window.TivexaHaptics, no SDK) or the Vibration API; respects the Vibration toggle. */
      vibrate(ms) { if (!core.canVibrate()) return false; try { if (root.TivexaHaptics && root.TivexaHaptics.vibrate) { root.TivexaHaptics.vibrate(ms | 0); return true; } if (root.navigator.vibrate) return root.navigator.vibrate(ms | 0); } catch (e) { } return false; },
      /** Renders the toggles (each row at least 48 CSS px high) into a container, e.g. a menu dialog. */
      renderToggles(container) {
        const label = { music: 'Music', sfx: 'Sound effects', vibration: 'Vibration' };
        for (const n of core.names) {
          const row = doc.createElement('label'); row.className = 'la-toggle';
          row.innerHTML = `<span></span><input type="checkbox" role="switch" id="la-pref-${n}">`;
          row.querySelector('span').textContent = label[n];
          const input = row.querySelector('input'); input.checked = core.prefs[n];
          input.addEventListener('change', () => api.setPref(n, input.checked));
          container.append(row);
        }
      },
      state() { return { begun: core.begun, prefs: core.prefs, reasons: core.reasons, musicPaused: music.paused, musicVolume: +music.volume.toFixed(3), musicMuted: music.muted, chimePaused: chime.paused, trace: { ...trace } }; },
      elements: { screen, begin: beginBtn, chime, music },
    };
    return api;
  }
  const exported = { createCore, init, keyFor, VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported; else root.TivexaLaunchAudio = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
