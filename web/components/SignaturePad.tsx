import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { Button, errorMessage, useToast } from "./ui";

interface Props {
  value: MediaItem | null;
  onChange: (sig: MediaItem | null) => void;
  required?: boolean;
}

export function SignaturePad({ value, onChange, required }: Props) {
  const { t } = useT();
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [saving, setSaving] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, [value]);

  function pos(e: PointerEvent | React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent) {
    if (value) return;
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dirty.current = true;
    if (!hasStrokes) setHasStrokes(true);
  }

  function up() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    dirty.current = false;
    setHasStrokes(false);
    if (value) {
      api.delete(`/api/media/${value.id}`).catch(() => undefined);
      onChange(null);
    }
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || !dirty.current) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
      const form = new FormData();
      form.append("file", blob, "signature.png");
      form.append("kind", "signature");
      const item = await api.upload<MediaItem>("/api/media", form);
      onChange(item);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{required ? t("wf.signature") : t("wf.signature_optional")}</p>
      <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-white">
        {value ? (
          <img src={value.url} alt="signature" className="h-40 w-full object-contain" />
        ) : (
          <canvas
            ref={canvasRef}
            className="h-40 w-full touch-none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
          />
        )}
        {!value && !hasStrokes && <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">{t("wf.signature_hint")}</span>}
        {value && <span className="absolute right-2 top-2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">✓</span>}
      </div>
      <div className="mt-2 flex justify-between">
        <Button size="sm" variant="ghost" onClick={clear} disabled={!hasStrokes && !value}>
          {t("wf.signature_clear")}
        </Button>
        {!value && (
          <Button size="sm" variant="secondary" onClick={save} disabled={!hasStrokes} loading={saving}>
            {t("common.confirm")}
          </Button>
        )}
      </div>
    </div>
  );
}
