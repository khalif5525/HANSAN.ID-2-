/**
 * Identifier helpers — prefixed, sortable-enough, collision-resistant
 * IDs for domain entities. Uses crypto.randomUUID (Node 18+/browsers).
 */

export type EntityPrefix =
  | "ord"
  | "item"
  | "tkt"
  | "rsv"
  | "cus"
  | "sup"
  | "po"
  | "rcv"
  | "mov"
  | "adj"
  | "exp"
  | "ref"
  | "pay"
  | "usr"
  | "ten"
  | "out"
  | "aud"
  | "vch";

export function createId(prefix: EntityPrefix): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? fallbackId();
  return `${prefix}_${uuid}`;
}

function fallbackId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
