import { useRef, useState } from "react";
import type { MediaItem } from "@shared/types";
import { api } from "../lib/api";
import { resizeImage } from "../lib/image";
import { useT } from "../lib/i18n";
import { Button, cx, errorMessage, useToast } from "./ui";

interface Props {
  photos: MediaItem[];
  onChange: (photos: MediaItem[]) => void;
  min?: number;
  max?: number;
  compact?: boolean;
}

export function PhotoCapture({ photos, onChange, min = 0, max = 20, compact }: Props) {
  const { t } = useT();
  const toast = useToast();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, max - photos.length);
    setUploading((n) => n + files.length);
    const added: MediaItem[] = [];
    for (const f of files) {
      try {
        const blob = await resizeImage(f);
        const form = new FormData();
        form.append("file", blob, f.name.replace(/\.[^.]+$/, "") + ".jpg");
        form.append("kind", "photo");
        added.push(await api.upload<MediaItem>("/api/media", form));
      } catch (e) {
        toast.push(errorMessage(e), "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (added.length) onChange([...photos, ...added]);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  }

  async function remove(p: MediaItem) {
    onChange(photos.filter((x) => x.id !== p.id));
    api.delete(`/api/media/${p.id}`).catch(() => undefined);
  }

  return (
    <div>
      <div className={cx("grid gap-2", compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4")}>
        {photos.map((p) => (
          <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
            <img src={p.url} alt={p.caption || p.filename} className="h-full w-full object-cover" loading="lazy" />
            <button
              type="button"
              onClick={() => remove(p)}
              aria-label={t("wf.remove_photo")}
              className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-1 text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`u${i}`} className="flex aspect-square animate-pulse items-center justify-center rounded-xl bg-slate-200 text-xs text-slate-500">
            {t("wf.uploading")}
          </div>
        ))}
        {photos.length + uploading < max && (
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 8a2 2 0 0 1 2-2h1.2a2 2 0 0 0 1.6-.8l.9-1.2A2 2 0 0 1 11.3 3h1.4a2 2 0 0 1 1.6.8l.9 1.2a2 2 0 0 0 1.6.8H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span className="text-xs font-medium">{t("wf.add_photo")}</span>
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span className={cx(min > 0 && photos.length < min && "font-medium text-amber-700")}>
          {min > 0 ? t("wf.photos_min", { count: min }) : t("common.photo_count", { count: photos.length })}
        </span>
        <Button size="sm" variant="ghost" onClick={() => galleryRef.current?.click()} disabled={photos.length + uploading >= max}>
          {t("wf.add_from_gallery")}
        </Button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
    </div>
  );
}
