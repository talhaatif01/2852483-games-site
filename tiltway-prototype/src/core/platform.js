export function nativeCall() {
    const bridge = globalThis.Capacitor;
    return bridge?.isNativePlatform?.() && bridge.nativePromise ? bridge.nativePromise.bind(bridge) : null;
}
export function trackAppHeight(doc = document, win = window) {
    const set = () => doc.documentElement.style.setProperty("--app-h", `${win.innerHeight}px`);
    set();
    win.addEventListener("resize", set);
    return () => win.removeEventListener("resize", set);
}
export const needsIntro = (seen, id) => !seen.includes(id);
export const markSeen = (seen, id) => (seen.includes(id) ? [...seen] : [...seen, id]);
let keyboardUser = false;
export function installFocusPolicy(win = window) {
    win.addEventListener("keydown", () => (keyboardUser = true), true);
    win.addEventListener("pointerdown", () => (keyboardUser = false), true);
}
export const focusForKeyboard = (el) => {
    if (keyboardUser)
        el?.focus({ preventScroll: true });
};
