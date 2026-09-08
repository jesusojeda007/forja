import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { GalleryRepo } from "../db/gallery";
import { galleryItemUrl } from "../galeria/storage";
import { pickAdapter, sendChannelMedia } from "../replies/sender";
import type { ChannelId } from "../channels/shared";

/**
 * Galería (superpoder): manda una foto / video / audio REAL del negocio cuando
 * el cliente quiere ver algo ("¿me mandas foto del menú?", "¿cómo es el local?").
 * Sólo se ofrece cuando settings.galeria = "on" (settings-loader filtra la tool).
 */
export function sendGalleryItemTool(
  env: Env,
  _getConversationId: () => string | null,
  getChannel: () => ChannelId | null,
  getChannelUserId: () => string | null,
) {
  return tool({
    description:
      "Manda una foto, video o audio real del negocio cuando el cliente pide VER algo (el menú, el local, una propiedad, un trabajo previo, etc.). " +
      "Pasa en `query` lo que el cliente quiere ver, con sus palabras. Si no hay nada que encaje, responde tú con texto — no insistas.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Qué quiere ver el cliente, en sus palabras (ej. 'la carta del menú')"),
    }),
    execute: async ({ query }) => {
      const channel = getChannel();
      const channelUserId = getChannelUserId();
      if (!channel || !channelUserId) return { sent: false as const, reason: "no_channel" as const };

      const item = await new GalleryRepo(new Db(env.DB)).bestMatch(query);
      if (!item) return { sent: false as const, reason: "no_match" as const };

      try {
        await sendChannelMedia(
          pickAdapter(channel),
          { channel, channelUserId, url: galleryItemUrl(env, item.id), kind: item.kind as any },
          env,
        );
      } catch (e) {
        console.error("[sendGalleryItem] envío falló:", e);
        return { sent: false as const, reason: "send_failed" as const };
      }
      return { sent: true as const, label: item.label, kind: item.kind };
    },
  });
}
