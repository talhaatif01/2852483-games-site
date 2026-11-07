let ctx = null;
let enabled = true;
export function setSoundEnabled(on) {
    enabled = on;
    if (!on)
        void ctx?.suspend();
}
/** Pause audio while the app is in the background. */
export function suspendAudio() {
    void ctx?.suspend();
}
function context() {
    if (!enabled)
        return null;
    try {
        ctx ?? (ctx = new AudioContext());
        if (ctx.state === "suspended")
            void ctx.resume();
        return ctx;
    }
    catch {
        return null;
    }
}
function tone(ac, freq, start, dur, type, peak) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
}
export function play(cue) {
    const ac = context();
    if (!ac)
        return;
    const t = ac.currentTime;
    switch (cue) {
        case "select":
            tone(ac, 660, t, 0.07, "sine", 0.08);
            break;
        case "swap":
            tone(ac, 392, t, 0.09, "triangle", 0.12);
            tone(ac, 523, t + 0.05, 0.1, "triangle", 0.1);
            break;
        case "deny":
            tone(ac, 196, t, 0.12, "square", 0.04);
            break;
        case "hint":
            tone(ac, 880, t, 0.12, "sine", 0.06);
            tone(ac, 988, t + 0.08, 0.12, "sine", 0.05);
            break;
        case "unlock":
            [523, 659, 784].forEach((f, i) => tone(ac, f, t + i * 0.06, 0.18, "sine", 0.1));
            break;
        case "win":
            [523, 659, 784, 1047].forEach((f, i) => tone(ac, f, t + i * 0.09, 0.32, "triangle", 0.12));
            break;
    }
}
