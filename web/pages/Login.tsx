import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Me } from "@shared/types";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { Button, Field, Input, Select, errorMessage } from "../components/ui";

interface Status {
  needs_setup: boolean;
  org_name: string;
  default_language: "de" | "en";
  email_enabled: boolean;
}

function Shell({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-14 w-14" />
          <h1 className="text-2xl font-bold text-slate-900">{t("app.name")}</h1>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useT();
  const nav = useNavigate();
  const { me, setMe } = useAuth();
  const status = useQuery<Status>({ queryKey: ["auth-status"], queryFn: () => api.get("/api/auth/status") });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) nav("/", { replace: true });
  }, [me, nav]);

  useEffect(() => {
    if (status.data?.needs_setup) nav("/setup", { replace: true });
  }, [status.data, nav]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const m = await api.post<Me>("/api/auth/login", { email, password });
      setMe(m);
      nav(m.must_change_password ? "/profile?force=1" : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title={t("auth.login")} hint={status.data?.org_name}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("auth.email")}>
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label={t("auth.password")}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          {t("auth.login")}
        </Button>
        <div className="text-center">
          <Link to="/forgot-password" className="text-sm text-blue-700 hover:underline">
            {t("auth.forgot")}
          </Link>
        </div>
      </form>
    </Shell>
  );
}

export function SetupPage() {
  const { t } = useT();
  const nav = useNavigate();
  const { setMe } = useAuth();
  const [form, setForm] = useState({ email: "", name: "", password: "", org_name: "", language: "de" as "de" | "en" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const m = await api.post<Me>("/api/auth/setup", form);
      localStorage.setItem("ff_lang", form.language);
      setMe(m);
      nav("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title={t("auth.setup_title")} hint={t("auth.setup_hint")}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("auth.org_name")}>
          <Input required value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })} />
        </Field>
        <Field label={t("common.name")}>
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t("auth.email")}>
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label={t("auth.password")} hint={t("auth.password_hint")}>
          <Input type="password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label={t("common.language")}>
          <Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as "de" | "en" })}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </Select>
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          {t("auth.create_account")}
        </Button>
      </form>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<{ email_enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await api.post("/api/auth/forgot-password", { email }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title={t("auth.forgot_title")} hint={t("auth.forgot_hint")}>
      {done ? (
        <p className="text-sm text-slate-700">{done.email_enabled ? t("auth.forgot_sent") : t("auth.forgot_no_email")}</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label={t("auth.email")}>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" className="w-full" loading={busy}>
            {t("auth.send_link")}
          </Button>
        </form>
      )}
      <div className="mt-4 text-center">
        <Link to="/login" className="text-sm text-blue-700 hover:underline">
          {t("auth.back_to_login")}
        </Link>
      </div>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const { t } = useT();
  const nav = useNavigate();
  const { setMe } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const invite = params.get("invite") === "1";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const m = await api.post<Me>("/api/auth/reset-password", { token, new_password: password });
      setMe(m);
      nav("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title={invite ? t("auth.invite_title") : t("auth.reset_title")}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("auth.new_password")} hint={t("auth.password_hint")}>
          <Input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>
          {t("auth.set_password")}
        </Button>
      </form>
      <div className="mt-4 text-center">
        <Link to="/login" className="text-sm text-blue-700 hover:underline">
          {t("auth.back_to_login")}
        </Link>
      </div>
    </Shell>
  );
}
