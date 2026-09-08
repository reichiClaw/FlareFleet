import type { Language } from "@shared/types";

const locale = (lang: Language) => (lang === "de" ? "de-DE" : "en-GB");

export function fmtDateTime(iso: string | null | undefined, lang: Language): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale(lang), { dateStyle: "medium", timeStyle: "short" });
}

export function fmtDate(iso: string | null | undefined, lang: Language): string {
  if (!iso) return "–";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale(lang), { dateStyle: "medium" });
}

export function fmtRelative(iso: string | null | undefined, lang: Language): string {
  if (!iso) return "–";
  const diff = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  const min = Math.round(diff / 60000);
  if (Math.abs(min) < 60) return rtf.format(-min, "minute");
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return rtf.format(-h, "hour");
  const d = Math.round(h / 24);
  if (Math.abs(d) < 30) return rtf.format(-d, "day");
  return fmtDate(iso, lang);
}

export function fmtNum(n: number | null | undefined, lang: Language, unit = ""): string {
  if (n == null) return "–";
  return `${n.toLocaleString(locale(lang))}${unit ? ` ${unit}` : ""}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function toLocalInputDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInputDateTime(v: string): string {
  return new Date(v).toISOString();
}

export function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
}
