import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportJob } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { fmtDateTime } from "../lib/format";
import { Badge, Button, Card, ErrorBox, PageHeader, cx, errorMessage, useToast } from "../components/ui";

export function ImportPage() {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const history = useQuery<{ results: ImportJob[] }>({ queryKey: ["imports"], queryFn: () => api.get("/api/imports") });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<ImportJob>("/api/imports", form);
    },
    onSuccess: (j) => {
      setJob(j);
      qc.invalidateQueries({ queryKey: ["imports"] });
    },
    onError: (e) => toast.push(errorMessage(e), "error"),
  });

  const commit = useMutation({
    mutationFn: (onlyValid: boolean) => api.post<ImportJob>(`/api/imports/${job!.id}/commit`, { only_valid: onlyValid }),
    onSuccess: (j) => {
      setJob(j);
      qc.invalidateQueries({ queryKey: ["imports"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.push(t("import.committed", { created: j.created_count, updated: j.updated_count }));
    },
    onError: (e) => toast.push(errorMessage(e), "error"),
  });

  const openJob = useMutation({
    mutationFn: (id: string) => api.get<ImportJob>(`/api/imports/${id}`),
    onSuccess: setJob,
  });

  const rows = (job?.rows ?? []).filter((r) => !showErrorsOnly || r.action === "error");
  const columns = job ? Object.values(job.columns) : [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("import.title")} subtitle={t("import.hint")} />
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          <Button onClick={() => fileRef.current?.click()} loading={upload.isPending}>
            {t("import.choose")}
          </Button>
          <a href={`/api/imports/template`} className="text-sm text-blue-700 hover:underline">
            {t("import.template")}
          </a>
        </div>
        {upload.error && (
          <div className="mt-3">
            <ErrorBox error={upload.error} />
          </div>
        )}
      </Card>

      {job && (
        <Card
          className="mt-4"
          title={
            <span className="flex flex-wrap items-center gap-2">
              {job.filename}
              <Badge tone={job.status === "committed" ? "green" : job.status === "failed" ? "red" : "blue"}>{t(`import.status.${job.status}`)}</Badge>
            </span>
          }
          action={<span className="text-xs text-slate-500">{fmtDateTime(job.created_at, lang)}</span>}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{t("import.rows", { count: job.row_count })}</Badge>
            <Badge tone="green">{t("import.valid", { count: job.valid_count })}</Badge>
            {job.error_count > 0 && (
              <button type="button" onClick={() => setShowErrorsOnly(!showErrorsOnly)} className={cx("rounded-full px-2 py-0.5 text-xs font-medium", showErrorsOnly ? "bg-red-600 text-white" : "bg-red-100 text-red-800")}>
                {t("import.errors", { count: job.error_count })}
              </button>
            )}
            {job.status === "committed" && (
              <span className="text-slate-600">
                {job.created_count} {t("import.create")} · {job.updated_count} {t("import.update")}
              </span>
            )}
          </div>
          {columns.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              {t("import.columns_found")}: {columns.join(", ")}
            </p>
          )}

          {job.status === "validated" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => commit.mutate(true)} loading={commit.isPending} disabled={job.valid_count === 0}>
                {t("import.commit")} ({job.valid_count})
              </Button>
            </div>
          )}

          <div className="-mx-4 mt-4 overflow-x-auto px-4">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2">{t("import.row")}</th>
                  <th className="py-1 pr-2">{t("import.action")}</th>
                  <th className="py-1 pr-2">{t("vehicle.internal_number")}</th>
                  <th className="py-1 pr-2">{t("vehicle.category")}</th>
                  <th className="py-1 pr-2">{t("vehicle.manufacturer")}</th>
                  <th className="py-1 pr-2">{t("vehicle.model")}</th>
                  <th className="py-1 pr-2">{t("vehicle.serial_number")}</th>
                  <th className="py-1 pr-2">{t("vehicle.expected_arrival")}</th>
                  <th className="py-1 pr-2">{t("common.error")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.row_number} className={r.action === "error" ? "bg-red-50" : ""}>
                    <td className="py-1.5 pr-2 font-mono">{r.row_number}</td>
                    <td className="py-1.5 pr-2">
                      <Badge tone={r.action === "error" ? "red" : r.action === "update" ? "amber" : "green"}>{r.action === "error" ? t("common.error") : t(`import.${r.action}`)}</Badge>
                    </td>
                    <td className="py-1.5 pr-2 font-mono">
                      {r.result_vehicle_id ? (
                        <Link to={`/vehicles/${r.result_vehicle_id}`} className="text-blue-700 hover:underline">
                          {String(r.data.internal_number ?? "→")}
                        </Link>
                      ) : (
                        String(r.data.internal_number ?? "")
                      )}
                    </td>
                    <td className="py-1.5 pr-2">{String(r.data.category ?? "")}</td>
                    <td className="py-1.5 pr-2">{String(r.data.manufacturer ?? "")}</td>
                    <td className="py-1.5 pr-2">{String(r.data.model ?? "")}</td>
                    <td className="py-1.5 pr-2 font-mono">{String(r.data.serial_number ?? "")}</td>
                    <td className="py-1.5 pr-2">{String(r.data.expected_arrival ?? "")}</td>
                    <td className="py-1.5 pr-2 text-red-700">{r.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-4" title={t("import.history")}>
        {!history.data?.results.length ? (
          <p className="text-sm text-slate-500">{t("common.empty")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.data.results.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 py-2">
                <button type="button" onClick={() => openJob.mutate(j.id)} className="min-w-0 flex-1 truncate text-left text-blue-700 hover:underline">
                  {j.filename}
                </button>
                <span className="text-xs text-slate-500">
                  {j.row_count} · {fmtDateTime(j.created_at, lang)}
                </span>
                <Badge tone={j.status === "committed" ? "green" : j.status === "failed" ? "red" : "blue"}>{t(`import.status.${j.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
