import type { Language } from "@shared/types";
import { t } from "./i18n";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, string>;
  params?: Record<string, string | number>;

  constructor(status: number, code: string, details?: Record<string, string>, params?: Record<string, string | number>) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
    this.params = params;
  }

  toResponse(lang: Language): Response {
    const body = {
      error: {
        code: this.code,
        message: t(lang, `errors.${this.code}`, this.params),
        details: this.details,
      },
    };
    return new Response(JSON.stringify(body), {
      status: this.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

export const badRequest = (code: string, details?: Record<string, string>, params?: Record<string, string | number>) =>
  new ApiError(400, code, details, params);
export const unauthorized = () => new ApiError(401, "unauthorized");
export const forbidden = () => new ApiError(403, "forbidden");
export const notFound = (code = "not_found") => new ApiError(404, code);
export const conflict = (code: string, params?: Record<string, string | number>) => new ApiError(409, code, undefined, params);
