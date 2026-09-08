// Canal Kapso — proveedor de WhatsApp (proxy sobre la Cloud API de Meta, con
// onboarding, webhooks y envío por API).
//
// Desde la óptica del bot Kapso es UN canal de WhatsApp (`channel: "kapso"`).
// Para responder hace falta el número del cliente (`message.from`) y el
// `phone_number_id` del negocio (viene en el webhook) — ambos se empacan en
// `channelUserId` (`<phone_number_id>::<from>`), así no hay env var extra.
//
//  • Entrante: POST /webhooks/kapso · header `X-Webhook-Event: whatsapp.message.received`
//    · firma `X-Webhook-Signature` = HMAC-SHA256 hex del cuerpo crudo (secreto del webhook).
//  • Saliente: POST https://api.kapso.ai/meta/whatsapp/v24.0/<phone_number_id>/messages
//    con header `X-API-Key: <API key>` y cuerpo con forma de Meta ({messaging_product,to,type,...}).
//
// La media entrante (`message.kapso.media_url`) es autenticada: se sirve por un
// proxy FIRMADO (/webhooks/kapso/media) igual que WhatsApp Cloud / Zernio — URL
// pública con HMAC + expiración, la API key queda del lado del server.
import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";
import type { Env } from "../env";

const KAPSO_API = "https://api.kapso.ai/meta/whatsapp/v24.0";
const ID_DELIM = "::";
const MEDIA_TTL_MS = 10 * 60 * 1000;

// ─── identidad de canal ──────────────────────────────────────────────────────

/** Empaca `<phone_number_id>::<teléfono del cliente>` en un solo channelUserId. */
export function packKapsoId(phoneNumberId: string, to: string): string {
  return `${phoneNumberId}${ID_DELIM}${to}`;
}

export function unpackKapsoId(packed: string): { phoneNumberId: string; to: string } {
  const i = packed.indexOf(ID_DELIM);
  if (i === -1) return { phoneNumberId: "", to: packed };
  return { phoneNumberId: packed.slice(0, i), to: packed.slice(i + ID_DELIM.length) };
}

// ─── firma del webhook ───────────────────────────────────────────────────────

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Valida el `X-Webhook-Signature` (HMAC-SHA256 hex del cuerpo crudo con el
 * secreto del webhook). Fail-closed: sin secret o sin firma → false.
 */
export async function verifyKapsoSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;
  const expected = await hmacHex(secret, rawBody);
  return timingSafeEqual(expected, signatureHeader.trim());
}

// ─── proxy firmado para media entrante ───────────────────────────────────────

async function signedKapsoMediaUrl(mediaUrl: string, env: Env, origin: string): Promise<string | null> {
  const secret = env.KAPSO_WEBHOOK_SECRET ?? "";
  const base = (origin || env.DASHBOARD_BASE_URL || "").replace(/\/$/, "");
  if (!secret || !base) return null;
  const exp = Date.now() + MEDIA_TTL_MS;
  const sig = await hmacHex(secret, `${mediaUrl}.${exp}`);
  return `${base}/webhooks/kapso/media?u=${encodeURIComponent(mediaUrl)}&exp=${exp}&sig=${sig}`;
}

/**
 * Sirve la media entrante de Kapso: valida firma + expiración, hace fetch de la
 * URL de Kapso con `X-API-Key` y devuelve los bytes. Público pero firmado.
 */
export async function serveKapsoMedia(
  u: string | null,
  exp: string | null,
  sig: string | null,
  env: Env,
): Promise<Response> {
  const secret = env.KAPSO_WEBHOOK_SECRET ?? "";
  const apiKey = env.KAPSO_API_KEY ?? "";
  if (!secret || !apiKey) return new Response("not configured", { status: 404 });
  const expNum = Number(exp);
  if (!u || !exp || !sig || !Number.isFinite(expNum)) return new Response("bad request", { status: 400 });
  if (Date.now() > expNum) return new Response("expired", { status: 410 });
  const expected = await hmacHex(secret, `${u}.${exp}`);
  if (!timingSafeEqual(expected, sig)) return new Response("bad signature", { status: 403 });

  const res = await fetch(u, { headers: { "X-API-Key": apiKey } });
  if (!res.ok) return new Response("media fetch failed", { status: 502 });
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return new Response(res.body, { status: 200, headers: { "Content-Type": contentType } });
}

// ─── entrante ────────────────────────────────────────────────────────────────

interface KapsoMessage {
  id?: string;
  timestamp?: string;
  type?: string;
  from?: string;
  from_user_id?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string; voice?: boolean };
  video?: { id?: string; caption?: string };
  document?: { id?: string };
  contacts?: { profile?: { name?: string } }[];
  kapso?: { direction?: string; status?: string; has_media?: boolean; media_url?: string; content?: string };
}

interface KapsoWebhookBody {
  message?: KapsoMessage;
  conversation?: { id?: string; phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string } }[];
  phone_number_id?: string;
}

/**
 * Convierte un webhook de Kapso en 0..1 mensajes entrantes. Solo procesa
 * mensajes con `message.kapso.direction === "inbound"` de tipo texto, imagen o
 * audio (video/documento/ubicación se ignoran, como en WhatsApp Cloud).
 * `origin` es la base pública del worker (para firmar la URL del proxy de media).
 */
export async function parseKapsoEvent(
  body: KapsoWebhookBody,
  env: Env,
  origin: string,
): Promise<IncomingMessage[]> {
  const m = body.message;
  if (!m || m.kapso?.direction !== "inbound") return [];

  const from = m.from;
  const phoneNumberId = body.phone_number_id ?? body.conversation?.phone_number_id ?? "";
  if (!from || !phoneNumberId) return [];

  const name = m.contacts?.[0]?.profile?.name ?? body.contacts?.[0]?.profile?.name;

  let text: string | undefined;
  let imageUrl: string | undefined;
  let audioUrl: string | undefined;

  if (m.type === "text") {
    text = m.text?.body || undefined;
  } else if (m.type === "image") {
    text = m.image?.caption || undefined;
    if (m.kapso?.media_url) imageUrl = (await signedKapsoMediaUrl(m.kapso.media_url, env, origin)) ?? undefined;
  } else if (m.type === "audio") {
    if (m.kapso?.media_url) audioUrl = (await signedKapsoMediaUrl(m.kapso.media_url, env, origin)) ?? undefined;
  } else {
    return []; // video, document, location, sticker, etc.
  }

  if (!text && !imageUrl && !audioUrl) return [];

  return [
    {
      channel: "kapso",
      channelUserId: packKapsoId(phoneNumberId, String(from)),
      displayName: name,
      text,
      imageUrl,
      audioUrl,
      isOwnerMessage: false,
      receivedAt: Date.now(),
      rawPayload: body,
    },
  ];
}

// ─── adaptador ───────────────────────────────────────────────────────────────

function requireApiKey(env: Env): string {
  const apiKey = env.KAPSO_API_KEY;
  if (!apiKey) throw new Error("Kapso: falta KAPSO_API_KEY.");
  return apiKey;
}

async function kapsoSend(env: Env, channelUserId: string, payload: Record<string, unknown>, label: string): Promise<void> {
  const apiKey = requireApiKey(env);
  const { phoneNumberId, to } = unpackKapsoId(channelUserId);
  const res = await fetch(`${KAPSO_API}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`kapso ${label} ${res.status}: ${errBody}`);
  }
}

export const kapsoAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, env: Env): Promise<IncomingMessage> {
    const body = (await request.json()) as KapsoWebhookBody;
    const origin = new URL(request.url).origin;
    const [first] = await parseKapsoEvent(body, env, origin);
    if (!first) throw new Error("kapso webhook sin mensaje procesable");
    return first;
  },

  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    requireApiKey(env);
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      await kapsoSend(
        env,
        reply.channelUserId,
        { type: "text", text: { preview_url: false, body: reply.chunks[i] } },
        "sendReply",
      );
    }
  },

  async sendImage({ channelUserId, url, caption }, env: Env) {
    await kapsoSend(env, channelUserId, { type: "image", image: { link: url, caption } }, "sendImage");
  },

  async sendMedia({ channelUserId, url, kind, caption }, env: Env) {
    const media = kind === "audio" ? { link: url } : { link: url, caption };
    await kapsoSend(env, channelUserId, { type: kind, [kind]: media }, `sendMedia ${kind}`);
  },
};
