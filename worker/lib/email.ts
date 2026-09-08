import type { Env } from "../env";

export interface Attachment {
  filename: string;
  type: string;
  content: Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function emailAvailable(env: Env): boolean {
  return !!env.EMAIL && env.EMAIL_ENABLED !== "false" && !!env.EMAIL_FROM;
}

function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${linked}</div>`;
}

/**
 * Sends an e-mail through the Cloudflare Email Service binding.
 * Failures are logged, never thrown: e-mail is a convenience, not part of the protocol.
 */
export async function sendEmail(
  env: Env,
  to: string | string[],
  subject: string,
  text: string,
  attachments: Attachment[] = [],
): Promise<boolean> {
  if (!emailAvailable(env)) return false;
  const recipients = (Array.isArray(to) ? to : [to]).map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) return false;
  try {
    await env.EMAIL!.send({
      to: recipients,
      from: { email: env.EMAIL_FROM, name: env.APP_NAME },
      subject,
      text,
      html: textToHtml(text),
      attachments: attachments.map((a) => ({
        filename: a.filename,
        type: a.type,
        content: toBase64(a.content),
        disposition: "attachment",
      })),
    });
    return true;
  } catch (err) {
    console.error("email send failed", err);
    return false;
  }
}
