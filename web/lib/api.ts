import type { ApiError as ApiErrorBody } from "@shared/types";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, string>;
  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken = "";
export function setCsrfToken(token: string) {
  csrfToken = token;
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `HTTP ${res.status}`, err?.details);
  }
  return body as T;
}

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = { accept: "application/json" };
  if (json) h["content-type"] = "application/json";
  if (csrfToken) h["x-csrf-token"] = csrfToken;
  return h;
}

export const api = {
  get: <T>(url: string) => fetch(url, { headers: headers(false), credentials: "same-origin" }).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(url, { method: "POST", headers: headers(true), credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => handle<T>(r)),
  put: <T>(url: string, body?: unknown) =>
    fetch(url, { method: "PUT", headers: headers(true), credentials: "same-origin", body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  patch: <T>(url: string, body?: unknown) =>
    fetch(url, { method: "PATCH", headers: headers(true), credentials: "same-origin", body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  delete: <T>(url: string) => fetch(url, { method: "DELETE", headers: headers(false), credentials: "same-origin" }).then((r) => handle<T>(r)),
  upload: <T>(url: string, form: FormData) =>
    fetch(url, { method: "POST", headers: headers(false), credentials: "same-origin", body: form }).then((r) => handle<T>(r)),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
