// Canal Zernio — proveedor unificado de bandeja de entrada (Instagram, Messenger,
// WhatsApp, Telegram, X…) con una sola cuenta y un solo webhook.
//
// Desde la óptica del bot Zernio es UN canal (`channel: "zernio"`): no importa
// sobre qué red viaje el mensaje por debajo. Lo que sí importa para responder es
// la conversación (`conversation.id`) y la cuenta social (`account.accountId`),
// así que ambos se empacan en `channelUserId` (`<accountId>::<conversationId>`).
//
//  • Entrante: POST /webhooks/zernio con `event: "message.received"`, firmado con
//    HMAC-SHA256 hex en `X-Zernio-Signature` (secreto del webhook).
//  • Saliente: POST https://zernio.com/api/v1/inbox/conversations/<id>/messages
//    con `Authorization: Bearer <API key>` y `{ accountId, message }`.
//
// La media de Instagram/Facebook/Telegram llega como link CDN directo (se pasa
// tal cual). La de WhatsApp apunta a un endpoint autenticado de Zernio que
// expira: se sirve por un proxy FIRMADO (/webhooks/zernio/media) igual que el de
// WhatsApp Cloud — la URL es pública pero con HMAC + expiración y la API key
// queda del lado del server.
import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";
import type { Env } from "../env";

const ZERNIO_API = "https://zernio.com/api/v1";
const ID_DELIM = "::";
const MEDIA_TTL_MS = 10 * 60 * 1000; // la URL firmada del proxy vive 10 min

// ─── identidad de canal ──────────────────────────────────────────────────────

/** Empaca la cuenta social + la conversación en un solo `channelUserId`. */
export function packZernioId(accountId: string, conversationId: string): string {
  return `${accountId}${ID_DELIM}${conversationId}`;
}

/** Separa `<accountId>::<conversationId>`; el conversationId puede llevar `::`. */
export function unpackZernioId(packed: string): { accountId: string; conversationId: string } {
  const i = packed.indexOf(ID_DELIM);
  if (i === -1) return { accountId: "", conversationId: packed };
  return {
    accountId: packed.slice(0, i),
    conversationId: packed.slice(i + ID_DELIM.length),
  };
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
 * Valida el `X-Zernio-Signature` (HMAC-SHA256 hex del cuerpo crudo, con el
 * secreto del webhook). Comparación en tiempo constante. Fail-closed: sin secret
 * o sin firma → false.
 */
export async function verifyZernioSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;
  const expected = await hmacHex(secret, rawBody);
  return timingSafeEqual(expected, signatureHeader.trim());
}

// ─── proxy firmado para media de WhatsApp vía Zernio ─────────────────────────

/** URL pública firmada del proxy para una URL de media autenticada de Zernio. */
async function signedZernioMediaUrl(
  zernioUrl: string,
  env: Env,
  origin: string,
): Promise<string | null> {
  const secret = env.ZERNIO_WEBHOOK_SECRET ?? "";
  const base = (origin || env.DASHBOARD_BASE_URL || "").replace(/\/$/, "");
  if (!secret || !base) return null;
  const exp = Date.now() + MEDIA_TTL_MS;
  const sig = await hmacHex(secret, `${zernioUrl}.${exp}`);
  return `${base}/webhooks/zernio/media?u=${encodeURIComponent(zernioUrl)}&exp=${exp}&sig=${sig}`;
}

/**
 * Sirve la media entrante de WhatsApp vía Zernio: valida firma + expiración,
 * hace fetch de la URL de Zernio con `Authorization: Bearer <API key>` y
 * devuelve los bytes. Público pero firmado — la API key nunca sale del server.
 */
export async function serveZernioMedia(
  u: string | null,
  exp: string | null,
  sig: string | null,
  env: Env,
): Promise<Response> {
  const secret = env.ZERNIO_WEBHOOK_SECRET ?? "";
  const apiKey = env.ZERNIO_API_KEY ?? "";
  if (!secret || !apiKey) return new Response("not configured", { status: 404 });
  const expNum = Number(exp);
  if (!u || !exp || !sig || !Number.isFinite(expNum)) {
    return new Response("bad request", { status: 400 });
  }
  if (Date.now() > expNum) return new Response("expired", { status: 410 });
  const expected = await hmacHex(secret, `${u}.${exp}`);
  if (!timingSafeEqual(expected, sig)) return new Response("bad signature", { status: 403 });

  const res = await fetch(u, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return new Response("media fetch failed", { status: 502 });
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return new Response(res.body, { status: 200, headers: { "Content-Type": contentType } });
}

// ─── entrante ────────────────────────────────────────────────────────────────

interface ZernioAttachment {
  type?: string;
  url?: string;
}

interface ZernioWebhookBody {
  id?: string;
  event?: string;
  message?: {
    id?: string;
    conversationId?: string;
    platform?: string;
    direction?: string;
    text?: string | null;
    attachments?: ZernioAttachment[];
    sender?: { id?: string; name?: string; username?: string };
  };
  conversation?: { id?: string };
  account?: { id?: string; accountId?: string };
}

/**
 * Convierte un webhook de Zernio en 0..1 mensajes entrantes. Solo procesa
 * `message.received` con `direction: "incoming"`; todo lo demás se ignora.
 * `origin` es la base pública del worker (para firmar la media de WhatsApp).
 *
 * Async (como parseWhatsAppEvents) porque firmar la URL del proxy de media es
 * asíncrono.
 */
export async function parseZernioEvent(
  body: ZernioWebhookBody,
  env: Env,
  origin: string,
): Promise<IncomingMessage[]> {
  if (body.event !== "message.received") return [];
  const m = body.message;
  if (!m || m.direction !== "incoming") return [];

  const accountId = body.account?.accountId ?? body.account?.id ?? "";
  const conversationId = body.conversation?.id ?? m.conversationId ?? "";
  if (!accountId || !conversationId) return [];

  const isWhatsApp = m.platform === "whatsapp";

  const text = m.text || undefined;
  let imageUrl: string | undefined;
  let audioUrl: string | undefined;

  const imageAtt = m.attachments?.find((a) => a.type === "image" && a.url)?.url;
  const audioAtt = m.attachments?.find((a) => a.type === "audio" && a.url)?.url;

  // WhatsApp: la URL de media de Zernio es autenticada y expira → proxy firmado.
  // Resto de redes: link CDN directo, se pasa tal cual.
  if (imageAtt) {
    imageUrl = isWhatsApp ? (await signedZernioMediaUrl(imageAtt, env, origin)) ?? undefined : imageAtt;
  }
  if (audioAtt) {
    audioUrl = isWhatsApp ? (await signedZernioMediaUrl(audioAtt, env, origin)) ?? undefined : audioAtt;
  }

  if (!text && !imageUrl && !audioUrl) return [];

  return [
    {
      channel: "zernio",
      channelUserId: packZernioId(accountId, conversationId),
      displayName: m.sender?.name,
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

export const zernioAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, env: Env): Promise<IncomingMessage> {
    const body = (await request.json()) as ZernioWebhookBody;
    const origin = new URL(request.url).origin;
    const [first] = await parseZernioEvent(body, env, origin);
    if (!first) throw new Error("zernio webhook sin mensaje procesable");
    return first;
  },

  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    const apiKey = env.ZERNIO_API_KEY;
    if (!apiKey) throw new Error("Zernio: falta ZERNIO_API_KEY.");
    const { accountId, conversationId } = unpackZernioId(reply.channelUserId);
    const url = `${ZERNIO_API}/inbox/conversations/${encodeURIComponent(conversationId)}/messages`;
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ accountId, message: reply.chunks[i] }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error(`zernio sendReply ${res.status}: ${errBody}`);
      }
    }
  },

  async sendImage({ channelUserId, url: imageUrl, caption }, env: Env) {
    const apiKey = env.ZERNIO_API_KEY;
    if (!apiKey) throw new Error("Zernio: falta ZERNIO_API_KEY.");
    const { accountId, conversationId } = unpackZernioId(channelUserId);
    const res = await fetch(
      `${ZERNIO_API}/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          accountId,
          attachmentUrl: imageUrl,
          attachmentType: "image",
          message: caption,
        }),
      },
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`zernio sendImage ${res.status}: ${errBody}`);
    }
  },
};
