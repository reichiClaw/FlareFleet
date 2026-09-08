import { now, stmt, ulid } from "./db";

export interface AuditInput {
  actor_id: string | null;
  actor_label: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  vehicle_id?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}

export function auditStatement(db: D1Database, a: AuditInput): D1PreparedStatement {
  return stmt(
    db,
    "INSERT INTO audit_log (id, actor_id, actor_label, action, entity_type, entity_id, vehicle_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ulid(),
    a.actor_id,
    a.actor_label,
    a.action,
    a.entity_type,
    a.entity_id ?? null,
    a.vehicle_id ?? null,
    a.details ? JSON.stringify(a.details) : null,
    a.ip ?? null,
    now(),
  );
}

export async function audit(db: D1Database, a: AuditInput): Promise<void> {
  await auditStatement(db, a).run();
}
