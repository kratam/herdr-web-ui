import { join } from "node:path";
import { readStateDocument, writeStateDocument } from "./state-document.ts";

export interface GgAttention {
  snoozed_until?: string | null;
  reviewed_priority?: number;
  priority_confirmed_at?: string;
  priority_intent?: string;
  priority_override?: { value: number; updated_at: string };
}
/** Személyes átnézés, nem core-futtatási kapu. Egy Ovis-szerver minden böngészője megosztja. */
export class GgAttentionStore {
  private path: string;
  constructor(stateDir: string) { this.path = join(stateDir, "gg-attention.json"); }
  snapshot(): Record<string, GgAttention> {
    const doc = readStateDocument(this.path);
    if (doc.kind === "missing") return {};
    if (doc.kind !== "json" || !doc.value || typeof doc.value !== "object" || Array.isArray(doc.value)) throw Error("invalid_attention_state");
    const raw = doc.value as { version?: unknown; items?: unknown };
    if (raw.version !== 1 || !raw.items || typeof raw.items !== "object" || Array.isArray(raw.items)) throw Error("invalid_attention_state");
    for (const [key, entry] of Object.entries(raw.items)) {
      if (!key || !entry || typeof entry !== "object" || Array.isArray(entry)) throw Error("invalid_attention_state");
      const value = entry as GgAttention;
      if (value.snoozed_until != null && (typeof value.snoozed_until !== "string" || !Number.isFinite(Date.parse(value.snoozed_until)))) throw Error("invalid_attention_state");
      if (value.reviewed_priority !== undefined && (!Number.isInteger(value.reviewed_priority) || value.reviewed_priority < 0 || value.reviewed_priority > 4)) throw Error("invalid_attention_state");
      if (value.priority_override && (!Number.isInteger(value.priority_override.value) || value.priority_override.value < 0 || value.priority_override.value > 4 || !Number.isFinite(Date.parse(value.priority_override.updated_at)))) throw Error("invalid_attention_state");
    }
    return raw.items as Record<string, GgAttention>;
  }
  get(key: string): GgAttention { return this.snapshot()[key] ?? {}; }
  set(key: string, change: GgAttention): void {
    const items = this.snapshot();
    items[key] = { ...items[key], ...change };
    writeStateDocument(this.path, JSON.stringify({ version: 1, items }), false);
  }
}
