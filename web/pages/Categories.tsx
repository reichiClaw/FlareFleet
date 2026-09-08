import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, MeterMode } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { Badge, Button, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Toggle, errorMessage, useToast } from "../components/ui";

type Form = { id?: string; name: string; meter_mode: MeterMode; is_active: boolean; vehicle_count?: number };

export function CategoriesPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<Form | null>(null);
  const q = useQuery<{ results: Category[] }>({ queryKey: ["categories"], queryFn: () => api.get("/api/categories") });

  const save = useMutation({
    mutationFn: (f: Form) => (f.id ? api.patch(`/api/categories/${f.id}`, { name: f.name, meter_mode: f.meter_mode, is_active: f.is_active }) : api.post("/api/categories", f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setEdit(null);
      toast.push(t("common.saved"));
    },
    onError: (e) => toast.push(errorMessage(e), "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setEdit(null);
    },
    onError: (e) => toast.push(errorMessage(e), "error"),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("cats.title")} action={<Button size="sm" onClick={() => setEdit({ name: "", meter_mode: "both", is_active: true })}>+ {t("common.new")}</Button>} />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.results.length ? (
        <EmptyState text={t("common.empty")} />
      ) : (
        <div className="space-y-2">
          {q.data.results.map((c) => (
            <button key={c.id} type="button" onClick={() => setEdit({ ...c })} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">{c.name}</span>
                  {!c.is_active && <Badge>{t("common.inactive")}</Badge>}
                </div>
                <div className="text-xs text-slate-500">
                  {t(`meter.${c.meter_mode}`)} · {t("cats.vehicle_count", { count: c.vehicle_count ?? 0 })}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? t("common.edit") : t("cats.new")}
        footer={
          <div className="flex gap-2">
            {edit?.id && (
              <Button variant="danger" onClick={() => remove.mutate(edit.id!)} loading={remove.isPending} disabled={!!edit.vehicle_count}>
                {t("common.delete")}
              </Button>
            )}
            <Button className="flex-1" onClick={() => edit && save.mutate(edit)} loading={save.isPending} disabled={!edit?.name.trim()}>
              {t("common.save")}
            </Button>
          </div>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label={t("common.name")} required>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t("cats.meter_mode")}>
              <Select value={edit.meter_mode} onChange={(e) => setEdit({ ...edit, meter_mode: e.target.value as MeterMode })}>
                {(["both", "odometer", "hours", "none"] as MeterMode[]).map((m) => (
                  <option key={m} value={m}>
                    {t(`meter.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {edit.id && <Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label={t("common.active")} description={edit.vehicle_count ? t("cats.in_use") : undefined} />}
          </div>
        )}
      </Modal>
    </div>
  );
}
