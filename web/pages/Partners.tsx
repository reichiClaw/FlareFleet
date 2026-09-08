import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Company, CompanyType, Driver } from "@shared/types";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, SegmentedControl, Select, Textarea, Toggle, errorMessage, useToast } from "../components/ui";

type CompanyForm = Omit<Company, "id">;
const emptyCompany: CompanyForm = { name: "", company_type: "subcontractor", contact_name: "", phone: "", email: "", notes: "", is_active: true };
type DriverForm = Omit<Driver, "id" | "company_name">;
const emptyDriver: DriverForm = { company_id: null, name: "", phone: "", email: "", is_active: true };

export function PartnersPage() {
  const { t } = useT();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"companies" | "drivers">("companies");
  const [editCompany, setEditCompany] = useState<(CompanyForm & { id?: string }) | null>(null);
  const [editDriver, setEditDriver] = useState<(DriverForm & { id?: string }) | null>(null);

  const companies = useQuery<{ results: Company[] }>({ queryKey: ["companies", "all"], queryFn: () => api.get("/api/companies?include_inactive=1") });
  const drivers = useQuery<{ results: Driver[] }>({ queryKey: ["drivers", "all"], queryFn: () => api.get("/api/drivers?include_inactive=1") });

  const saveCompany = useMutation({
    mutationFn: (c: CompanyForm & { id?: string }) => (c.id ? api.patch(`/api/companies/${c.id}`, c) : api.post("/api/companies", c)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      setEditCompany(null);
      toast.push(t("common.saved"));
    },
    onError: (e) => toast.push(errorMessage(e), "error"),
  });
  const saveDriver = useMutation({
    mutationFn: (d: DriverForm & { id?: string }) => (d.id ? api.patch(`/api/drivers/${d.id}`, d) : api.post("/api/drivers", d)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drivers"] });
      setEditDriver(null);
      toast.push(t("common.saved"));
    },
    onError: (e) => toast.push(errorMessage(e), "error"),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t("partners.title")}
        action={
          <Button size="sm" onClick={() => (tab === "companies" ? setEditCompany({ ...emptyCompany }) : setEditDriver({ ...emptyDriver }))}>
            + {t("common.new")}
          </Button>
        }
      />
      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "companies", label: t("partners.companies") },
          { value: "drivers", label: t("partners.drivers") },
        ]}
      />
      <div className="mt-4 space-y-2">
        {tab === "companies" &&
          (companies.isLoading ? (
            <Loading />
          ) : !companies.data?.results.length ? (
            <EmptyState text={t("common.empty")} />
          ) : (
            companies.data.results.map((c) => (
              <button key={c.id} type="button" disabled={!can("admin")} onClick={() => setEditCompany({ ...c })} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    {!c.is_active && <Badge>{t("common.inactive")}</Badge>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {t(`company.${c.company_type}`)}
                    {c.contact_name ? ` · ${c.contact_name}` : ""}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </div>
                </div>
              </button>
            ))
          ))}
        {tab === "drivers" &&
          (drivers.isLoading ? (
            <Loading />
          ) : !drivers.data?.results.length ? (
            <EmptyState text={t("common.empty")} />
          ) : (
            drivers.data.results.map((d) => (
              <button key={d.id} type="button" disabled={!can("admin")} onClick={() => setEditDriver({ ...d })} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{d.name}</span>
                    {!d.is_active && <Badge>{t("common.inactive")}</Badge>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {d.company_name ?? "–"}
                    {d.phone ? ` · ${d.phone}` : ""}
                    {d.email ? ` · ${d.email}` : ""}
                  </div>
                </div>
              </button>
            ))
          ))}
      </div>

      <Modal
        open={!!editCompany}
        onClose={() => setEditCompany(null)}
        title={editCompany?.id ? t("common.edit") : t("partners.new_company")}
        footer={
          <Button className="w-full" loading={saveCompany.isPending} onClick={() => editCompany && saveCompany.mutate(editCompany)} disabled={!editCompany?.name.trim()}>
            {t("common.save")}
          </Button>
        }
      >
        {editCompany && (
          <form className="space-y-3" onSubmit={(e: FormEvent) => e.preventDefault()}>
            <Field label={t("common.name")} required>
              <Input value={editCompany.name} onChange={(e) => setEditCompany({ ...editCompany, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t("common.type")}>
              <Select value={editCompany.company_type} onChange={(e) => setEditCompany({ ...editCompany, company_type: e.target.value as CompanyType })}>
                <option value="supplier">{t("company.supplier")}</option>
                <option value="subcontractor">{t("company.subcontractor")}</option>
                <option value="internal">{t("company.internal")}</option>
              </Select>
            </Field>
            <Field label={t("partners.contact")}>
              <Input value={editCompany.contact_name} onChange={(e) => setEditCompany({ ...editCompany, contact_name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("common.phone")}>
                <Input type="tel" value={editCompany.phone} onChange={(e) => setEditCompany({ ...editCompany, phone: e.target.value })} />
              </Field>
              <Field label={t("common.email")}>
                <Input type="email" value={editCompany.email} onChange={(e) => setEditCompany({ ...editCompany, email: e.target.value })} />
              </Field>
            </div>
            <Field label={t("common.notes")}>
              <Textarea value={editCompany.notes} onChange={(e) => setEditCompany({ ...editCompany, notes: e.target.value })} />
            </Field>
            {editCompany.id && <Toggle checked={editCompany.is_active} onChange={(v) => setEditCompany({ ...editCompany, is_active: v })} label={t("common.active")} />}
          </form>
        )}
      </Modal>

      <Modal
        open={!!editDriver}
        onClose={() => setEditDriver(null)}
        title={editDriver?.id ? t("common.edit") : t("partners.new_driver")}
        footer={
          <Button className="w-full" loading={saveDriver.isPending} onClick={() => editDriver && saveDriver.mutate(editDriver)} disabled={!editDriver?.name.trim()}>
            {t("common.save")}
          </Button>
        }
      >
        {editDriver && (
          <form className="space-y-3" onSubmit={(e: FormEvent) => e.preventDefault()}>
            <Field label={t("common.name")} required>
              <Input value={editDriver.name} onChange={(e) => setEditDriver({ ...editDriver, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t("partners.company")}>
              <Select value={editDriver.company_id ?? ""} onChange={(e) => setEditDriver({ ...editDriver, company_id: e.target.value || null })}>
                <option value="">–</option>
                {companies.data?.results
                  .filter((c) => c.company_type !== "supplier")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("common.phone")}>
                <Input type="tel" value={editDriver.phone} onChange={(e) => setEditDriver({ ...editDriver, phone: e.target.value })} />
              </Field>
              <Field label={t("common.email")}>
                <Input type="email" value={editDriver.email} onChange={(e) => setEditDriver({ ...editDriver, email: e.target.value })} />
              </Field>
            </div>
            {editDriver.id && <Toggle checked={editDriver.is_active} onChange={(v) => setEditDriver({ ...editDriver, is_active: v })} label={t("common.active")} />}
          </form>
        )}
      </Modal>
    </div>
  );
}
