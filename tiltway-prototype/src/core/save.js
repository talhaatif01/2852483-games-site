export function parseSave(spec, raw) {
    if (!raw)
        return spec.empty();
    try {
        const doc = JSON.parse(raw);
        if (!doc || typeof doc !== "object" || typeof doc.version !== "number" || !Number.isInteger(doc.version))
            return spec.empty();
        if (doc.version < 1 || doc.version > spec.version)
            return spec.empty();
        return spec.migrate(doc.data, doc.version) ?? spec.empty();
    }
    catch {
        return spec.empty();
    }
}
export function serializeSave(spec, value) {
    return JSON.stringify({ version: spec.version, data: value });
}
export function loadSave(spec, store) {
    try {
        return parseSave(spec, store?.getItem(spec.key) ?? null);
    }
    catch {
        return spec.empty();
    }
}
/** The WebView copy plus (on Android) the durable native copy. */
export class DurableSave {
    constructor(spec, web, native) {
        this.spec = spec;
        this.web = web;
        this.native = native;
        this.value = loadSave(spec, web);
    }
    /** Merge in the native copy (call once at startup). Returns true when it changed anything. */
    async restore() {
        if (!this.native)
            return false;
        try {
            const r = (await this.native("ProgressStore", "get"));
            const merged = this.spec.merge(this.value, parseSave(this.spec, r?.value ?? null));
            const changed = serializeSave(this.spec, merged) !== serializeSave(this.spec, this.value);
            this.value = merged;
            if (changed)
                await this.save(merged);
            return changed;
        }
        catch {
            return false; // the WebView copy stays in use
        }
    }
    /** Write both copies; resolves once the native copy is committed (or immediately in a browser). */
    async save(value) {
        this.value = value;
        const raw = serializeSave(this.spec, value);
        try {
            this.web?.setItem(this.spec.key, raw);
        }
        catch {
            // storage full or blocked: the native copy (if any) still holds it
        }
        if (this.native) {
            try {
                await this.native("ProgressStore", "set", { value: raw });
            }
            catch {
                // keep playing; the WebView copy holds it
            }
        }
    }
}
