import { Link } from "react-router-dom";
import type { VehicleSummary } from "@shared/types";
import { StatusBadge, cx } from "./ui";

type Item = VehicleSummary & { location?: string; open_damage_count?: number; expected_arrival?: string | null; return_due?: string | null };

export function VehicleCard({ v, meta, to }: { v: Item; meta?: string; to?: string }) {
  return (
    <Link to={to ?? `/vehicles/${v.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition active:bg-slate-50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-slate-900">{v.internal_number}</span>
          {v.license_plate && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{v.license_plate}</span>}
        </div>
        <div className="truncate text-sm text-slate-800">
          {v.manufacturer} {v.model}
        </div>
        <div className="truncate text-xs text-slate-500">
          {v.category_name}
          {v.location ? ` · ${v.location}` : ""}
          {meta ? ` · ${meta}` : ""}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusBadge status={v.status} />
        {!!v.open_damage_count && v.open_damage_count > 0 && <span className={cx("text-xs font-medium text-red-600")}>⚠ {v.open_damage_count}</span>}
      </div>
    </Link>
  );
}
