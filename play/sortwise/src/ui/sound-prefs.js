export const LAUNCH_AUDIO_KEY = "tivexa-launch-audio-v1:sortwise";
/** Valid stored module preferences, or null when absent or not usable. */
export function readSoundPrefs(store) {
    try {
        const raw = store?.getItem(LAUNCH_AUDIO_KEY);
        if (!raw)
            return null;
        const v = JSON.parse(raw);
        if (!v || typeof v !== "object" || Array.isArray(v))
            return null;
        const o = v;
        if (typeof o.music !== "boolean" || typeof o.sfx !== "boolean")
            return null;
        return { music: o.music, sfx: o.sfx, vibration: typeof o.vibration === "boolean" ? o.vibration : true };
    }
    catch {
        return null;
    }
}
/** Run once at start-up, before the module reads its key. Returns what was decided. */
export function migrateSoundPrefs(store, soundOn) {
    const existing = readSoundPrefs(store);
    if (existing)
        return { migrated: false, prefs: existing };
    const prefs = { music: soundOn, sfx: soundOn, vibration: true };
    try {
        store?.setItem(LAUNCH_AUDIO_KEY, JSON.stringify(prefs));
    }
    catch {
        // Storage unavailable: the module uses its defaults for this session.
    }
    return { migrated: true, prefs };
}
