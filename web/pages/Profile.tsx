import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { Language, Me } from "@shared/types";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { Button, Card, Field, Input, PageHeader, Select, errorMessage, useToast } from "../components/ui";

export function ProfilePage() {
  const { t } = useT();
  const { me, setMe } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const forced = params.get("force") === "1" || !!me?.must_change_password;
  const [name, setName] = useState(me?.name ?? "");
  const [language, setLanguage] = useState<Language>(me?.language ?? "de");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const profile = useMutation({
    mutationFn: () => api.patch<Me>("/api/auth/me", { name, language }),
    onSuccess: (m) => {
      setMe(m);
      localStorage.setItem("ff_lang", m.language);
      toast.push(t("common.saved"));
    },
    onError: (e) => toast.push(errorMessage(e), "error"),
  });
  const password = useMutation({
    mutationFn: () => api.post<Me>("/api/auth/change-password", { current_password: forced ? undefined : current, new_password: next }),
    onSuccess: (m) => {
      setMe(m);
      setCurrent("");
      setNext("");
      toast.push(t("profile.password_changed"));
      if (forced) nav("/", { replace: true });
    },
    onError: (e) => toast.push(errorMessage(e), "error"),
  });

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title={t("profile.title")} subtitle={me?.email} />
      {forced && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{t("auth.must_change")}</p>}

      <Card title={t("profile.change_password")}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            password.mutate();
          }}
        >
          {!forced && (
            <Field label={t("auth.current_password")}>
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
          )}
          <Field label={t("auth.new_password")} hint={t("auth.password_hint")}>
            <Input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Button type="submit" loading={password.isPending}>
            {t("auth.set_password")}
          </Button>
        </form>
      </Card>

      {!forced && (
        <Card title={t("common.details")}>
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              profile.mutate();
            }}
          >
            <Field label={t("common.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label={t("common.language")}>
              <Select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Button type="submit" loading={profile.isPending}>
              {t("common.save")}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
