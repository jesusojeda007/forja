import type { ChannelAdapter, ChannelId } from "../channels/shared";
import type { Env } from "../env";
import { telegramAdapter } from "../channels/telegram";
import { manychatAdapter } from "../channels/manychat";
import { twilioAdapter } from "../channels/twilio";
import { metaAdapter } from "../channels/meta";
import { whatsappAdapter } from "../channels/whatsapp";
import { zernioAdapter } from "../channels/zernio";

const MIN_DELAY_MS = 800;
const MAX_DELAY_MS = 1500;
const MS_PER_CHAR = 30;

// Human-like inter-chunk delay: proportional to chunk length (~30ms/char),
// clamped to [800, 1500]ms so replies feel typed, not dumped.
export function chunkDelayMs(chunk: string): number {
  const proportional = chunk.length * MS_PER_CHAR;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, proportional));
}

export async function sendChunkedReply(
  adapter: ChannelAdapter,
  channel: ChannelId,
  channelUserId: string,
  chunks: string[],
  env: Env,
  interChunkDelayMs?: number,
): Promise<void> {
  // Default to a human-like, length-proportional pause between chunks.
  const delay =
    interChunkDelayMs ??
    (chunks.length > 1 ? chunkDelayMs(chunks[0]) : undefined);
  await adapter.sendReply(
    { channel, channelUserId, chunks, interChunkDelayMs: delay },
    env,
  );
}

/**
 * Manda media por el canal con degradación: `adapter.sendMedia` si existe →
 * `adapter.sendImage` para imágenes → en última instancia la URL como texto
 * (WhatsApp/Telegram le hacen preview). Nunca lanza.
 */
export async function sendChannelMedia(
  adapter: ChannelAdapter,
  req: { channel: ChannelId; channelUserId: string; url: string; kind: "image" | "video" | "audio"; caption?: string },
  env: Env,
): Promise<void> {
  try {
    if (adapter.sendMedia) return await adapter.sendMedia(req, env);
    if (req.kind === "image" && adapter.sendImage) {
      return await adapter.sendImage(
        { channel: req.channel, channelUserId: req.channelUserId, url: req.url, caption: req.caption },
        env,
      );
    }
  } catch (e) {
    console.error(`[sendChannelMedia] ${req.channel} falló, mando la URL como texto:`, e);
  }
  const text = req.caption ? `${req.caption}\n${req.url}` : req.url;
  await adapter.sendReply(
    { channel: req.channel, channelUserId: req.channelUserId, chunks: [text], interChunkDelayMs: 0 },
    env,
  );
}

export function pickAdapter(channel: ChannelId): ChannelAdapter {
  if (channel === "telegram") return telegramAdapter;
  if (channel === "manychat") return manychatAdapter;
  if (channel === "twilio") return twilioAdapter;
  if (channel === "whatsapp") return whatsappAdapter;
  if (channel === "zernio") return zernioAdapter;
  if (channel === "messenger" || channel === "instagram") return metaAdapter;
  throw new Error(`unknown channel: ${channel}`);
}
