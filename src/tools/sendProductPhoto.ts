import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { loadCatalog } from "../catalog/source";
import { rankCatalog } from "./catalogQuery";
import { pickAdapter } from "../replies/sender";
import { fold } from "./catalogQuery";
import type { ChannelId } from "../channels/shared";

/**
 * Memoria corta de qué producto ya se le fotografió a cada cliente, para no
 * spamear la misma foto si el modelo llama la tool dos veces. Vive en el
 * proceso del Durable Object (una instancia por conversación). TTL 10 min.
 */
const recentlySent = new Map<string, Map<string, number>>();
const SENT_TTL_MS = 10 * 60_000;

function alreadySent(key: string, name: string): boolean {
  const m = recentlySent.get(key);
  if (!m) return false;
  const at = m.get(fold(name));
  return at != null && Date.now() - at < SENT_TTL_MS;
}
function markSent(key: string, name: string): void {
  let m = recentlySent.get(key);
  if (!m) {
    m = new Map();
    recentlySent.set(key, m);
  }
  m.set(fold(name), Date.now());
}

/**
 * Envía al cliente la(s) foto(s) de un producto del catálogo por el canal
 * activo (Telegram, WhatsApp, Meta…), con un caption breve: nombre, precio y
 * link del producto. La foto y el link salen del catálogo — nunca se inventan.
 *
 * Si el canal no soporta imágenes o la foto falla, devuelve las URLs para que
 * el bot al menos comparta el link en texto. Nunca rompe la conversación.
 */
export function sendProductPhotoTool(
  env: Env,
  getChannel: () => ChannelId | null,
  getChannelUserId: () => string | null,
) {
  return tool({
    description:
      "Envía al cliente la foto de uno o más productos del catálogo (con nombre, precio y link). " +
      "Úsalo como PRIMERA acción apenas sepas de qué producto habla el cliente, sin esperar a que pida la foto. " +
      "Pasa el nombre del producto tal como lo mencionó el cliente; usa cantidad 2-3 si vas a mostrar varios.",
    inputSchema: z.object({
      producto: z
        .string()
        .min(1)
        .describe("Nombre o palabra clave del producto que el cliente quiere ver"),
      cantidad: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe("Cuántos productos mostrar si la búsqueda trae varios (por defecto 1)"),
    }),
    execute: async ({ producto, cantidad }) => {
      const channel = getChannel();
      const channelUserId = getChannelUserId();
      if (!channel || !channelUserId) {
        return { sent: false, reason: "sin canal activo" };
      }

      const catalog = await loadCatalog(env);
      const hits = rankCatalog(catalog, producto, Math.min(cantidad ?? 1, 4));
      if (hits.length === 0) {
        return { sent: false, reason: "no encontré ese producto en el catálogo" };
      }

      // Salta los que ya se le enviaron a este cliente hace poco.
      const key = `${channel}:${channelUserId}`;
      const fresh = hits.filter((h) => !alreadySent(key, h.name));
      if (fresh.length === 0) {
        return { sent: false, reason: "ya se le envió la foto de ese producto en esta conversación" };
      }

      const withPhoto = fresh.filter((h) => h.image);
      if (withPhoto.length === 0) {
        // Sin foto en la fuente: devolvé el link para que el bot lo mande en texto.
        return {
          sent: false,
          reason: "esos productos no tienen foto en el catálogo",
          productos: hits.map((h) => ({ nombre: h.name, precio: h.price, link: h.url ?? null })),
        };
      }

      // Marca ANTES de enviar: si el modelo llamó la tool dos veces casi a la
      // vez, la segunda ya ve estos productos como enviados.
      for (const item of withPhoto) markSent(key, item.name);

      const adapter = pickAdapter(channel);
      const enviados: string[] = [];
      const fallidos: { nombre: string; link: string | null }[] = [];
      for (const item of withPhoto) {
        const caption = [
          item.name,
          `Bs ${item.price}`,
          item.url ? item.url : undefined,
        ]
          .filter(Boolean)
          .join("\n");
        try {
          await adapter.sendImage?.({ channel, channelUserId, url: item.image!, caption }, env);
          enviados.push(item.name);
        } catch (e) {
          console.error("[sendProductPhoto] sendImage falló:", e);
          fallidos.push({ nombre: item.name, link: item.url ?? null });
        }
      }

      return {
        sent: enviados.length > 0,
        enviados,
        fallidos: fallidos.length ? fallidos : undefined,
      };
    },
  });
}
