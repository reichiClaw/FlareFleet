import { Hono } from "hono";
import type { AuditEntry } from "@shared/types";
import type { AppVariables, Env } from "../env";
import { requireAuth } from "../lib/auth";
import { all, json, paginate, parsePage } from "../lib/db";

const audit = new Hono<{ Bindings: Env; Variables: AppVariables }>();
audit.use("*", requireAuth("admin"));

function filters(url: URL) {
  const where: string[] = [];
  const params: unknown[] = [];
  const action = url.searchParams.get("action");
  const actor = url.searchParams.get("actor_id");
  const vehicle = url.searchParams.get("vehicle_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const q = url.searchParams.get("q")?.trim();
  if (action) {
    where.push("action LIKE ?");
    params.push(`${action}%`);
  }
  if (actor) {
    where.push("actor_id = ?");
    params.push(actor);
  }
  if (vehicle) {
    where.push("vehicle_id = ?");
    params.push(vehicle);
  }
  if (from) {
    where.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    where.push("created_at <= ?");
    params.push(`${to}T23:59:59.999Z`);
  }
  if (q) {
    where.push("(actor_label LIKE ? OR details LIKE ? OR entity_id LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  return { sql: `SELECT * FROM audit_log${where.length ? " WHERE " + where.join(" AND ") : ""}`, params };
}

audit.get("/", async (c) => {
  const url = new URL(c.req.url);
  const { sql, params } = filters(url);
  const res = await paginate<Record<string, unknown>>(c.env.DB, sql, params, "created_at DESC", parsePage(url, 50));
  return c.json({ ...res, results: res.results.map((a) => ({ ...(a as unknown as AuditEntry), details: json(a.details, null) })) });
});

audit.get("/export.csv", async (c) => {
  const url = new URL(c.req.url);
  const { sql, params } = filters(url);
  const rows = await all<Record<string, unknown>>(c.env.DB, `${sql} ORDER BY created_at DESC LIMIT 10000`, ...params);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["created_at;actor;action;entity_type;entity_id;vehicle_id;ip;details"];
  for (const r of rows) lines.push([r.created_at, r.actor_label, r.action, r.entity_type, r.entity_id, r.vehicle_id, r.ip, r.details].map(esc).join(";"));
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
});

export default audit;
