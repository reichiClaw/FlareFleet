import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { useT } from "../lib/i18n";

interface Props {
  onResult: (text: string) => void;
  active?: boolean;
}

/** Extracts a vehicle code from a scanned QR payload (full URL or bare code). */
export function parseQrTarget(text: string): string | null {
  const s = text.trim();
  const m = s.match(/\/q\/([A-Za-z0-9-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9-]{3,40}$/.test(s)) return s;
  return null;
}

export function QrScanner({ onResult, active = true }: Props) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    doneRef.current = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        tick();
      } catch {
        setError(t("scan.no_camera"));
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || doneRef.current) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const size = Math.min(video.videoWidth, video.videoHeight);
        canvas.width = 480;
        canvas.height = 480;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, 480, 480);
        const img = ctx.getImageData(0, 0, 480, 480);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          doneRef.current = true;
          if (navigator.vibrate) navigator.vibrate(60);
          onResult(code.data);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [active, onResult, t]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-3/5 w-3/5 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>
      {error && <div className="absolute inset-x-0 bottom-0 bg-slate-900/80 p-3 text-center text-sm text-white">{error}</div>}
    </div>
  );
}
