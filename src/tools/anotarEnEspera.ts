import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import type { ChannelId } from "../channels/shared";

/**
 * Anota a un cliente en la lista de espera de un producto agotado. El cron
 * nocturno cruza la lista contra el catálogo y avisa al dueño qué productos
 * volvieron con gente esperando.
 */
export function anotarEnEsperaTool(
  env: Env,
  getConversationId: () => string | null,
  getChannel: () => ChannelId | null,
  getChannelUserId: () => string | null,
) {
  return tool({
    description:
      "Anota al cliente para avisarle cuando un producto agotado vuelva a haber stock. " +
      "Usalo cuando el cliente lo pida o cuando el producto que quiere está en 0.",
    inputSchema: z.object({
      producto: z.string().min(1).describe("Nombre del producto agotado"),
      sku: z.string().optional(),
      cliente: z.string().optional().describe("Nombre del cliente"),
    }),
    execute: async ({ producto, sku, cliente }) => {
      const channel = getChannel();
      const channelUserId = getChannelUserId();
      if (!channel || !channelUserId) {
        return { anotado: false, reason: "sin canal activo" };
      }
      const db = new Db(env.DB);
      // Evita duplicar al mismo cliente para el mismo producto (aún sin avisar).
      const existing = await db.first<{ id: string }>(
        `SELECT id FROM stock_waitlist
         WHERE channel = ? AND channel_user_id = ? AND product_name = ? COLLATE NOCASE
           AND notified_at IS NULL`,
        [channel, channelUserId, producto],
      );
      if (existing) return { anotado: true, duplicado: true };

      await db.run(
        `INSERT INTO stock_waitlist
          (id, conversation_id, channel, channel_user_id, sku, product_name, customer_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          getConversationId(),
          channel,
          channelUserId,
          sku ?? null,
          producto,
          cliente ?? null,
          Date.now(),
        ],
      );
      return { anotado: true };
    },
  });
}
