// The default `qrcode` entry pulls in pngjs/Node streams, which do not run in
// Workers. The core + SVG renderer are pure JS and work everywhere.
// @ts-expect-error - internal module without type declarations
import QRCodeCore from "qrcode/lib/core/qrcode.js";
// @ts-expect-error - internal module without type declarations
import svgTag from "qrcode/lib/renderer/svg-tag.js";

export function qrSvg(text: string, size = 512): string {
  const data = QRCodeCore.create(text, { errorCorrectionLevel: "M" });
  return svgTag.render(data, { width: size, margin: 1, color: { dark: "#0f172aff", light: "#ffffffff" } }) as string;
}
