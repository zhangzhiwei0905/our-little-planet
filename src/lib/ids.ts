import { randomBytes } from "node:crypto";

export function newId(): string {
  return randomBytes(8).toString("hex").slice(0, 12);
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** 本地时区的 YYYY-MM-DD */
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
