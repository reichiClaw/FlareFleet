import type { Context } from "hono";
import type { ZodTypeAny, z } from "zod";
import { ApiError } from "./errors";

export async function parseBody<T extends ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "validation", { body: "invalid_json" });
  }
  return parseWith(schema, raw);
}

export function parseWith<T extends ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "_";
      if (!details[path]) details[path] = issue.message;
    }
    throw new ApiError(400, "validation", details);
  }
  return result.data;
}
