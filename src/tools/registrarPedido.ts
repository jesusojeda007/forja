import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { OrdersRepo } from "../db/orders";
import { LeadsRepo } from "../db/leads";

/**
 * Registra un pedido de la tienda cuando el cliente decide comprar. NO confirma
 * el pago (eso lo verifica el dueño). Deja el pedido en 'pendiente' — o
 * 'reservado' si el cliente solo está apartando — para que el dueño lo prepare
 * y despache desde el panel.
 */
export function registrarPedidoTool(
  env: Env,
  getConversationId: () => string | null,
) {
  return tool({
    description:
      "Registra el pedido del cliente cuando YA decidió comprar. NO confirma pagos. " +
      "Devuelve el número de pedido (código) para dárselo al cliente. " +
      "Llamalo una sola vez por pedido, con todos los productos juntos. " +
      "Si el cliente todavía NO compra y solo quiere apartar algo, usá apartarProducto en su lugar.",
    inputSchema: z.object({
      productos: z
        .array(
          z.object({
            nombre: z.string().describe("Nombre del producto tal como está en el catálogo"),
            cantidad: z.number().int().min(1).default(1),
            precio_unitario: z.number().describe("Precio de una unidad, del catálogo"),
            sku: z.string().optional(),
          }),
        )
        .min(1),
      cliente: z.string().optional().describe("Nombre del cliente"),
      contacto: z.string().optional().describe("Teléfono del cliente"),
      ciudad: z.string().optional(),
      direccion: z.string().optional().describe("Dirección de entrega con referencia"),
      zona_envio: z.enum(["incluido", "cliente_paga", "interior"]).optional(),
      link_mapa: z.string().optional().describe("Link de Google Maps si compartió ubicación"),
      nota: z.string().optional().describe("Detalle extra: color elegido, indicaciones de entrega, etc."),
    }),
    execute: async ({
      productos,
      cliente,
      contacto,
      ciudad,
      direccion,
      zona_envio,
      link_mapa,
      nota,
    }) => {
      const convId = getConversationId();
      const db = new Db(env.DB);
      const total = productos.reduce((s, p) => s + p.precio_unitario * (p.cantidad ?? 1), 0);

      // Enlaza al lead de la conversación si existe (para el CRM del panel).
      let leadId: string | null = null;
      try {
        if (convId) {
          const lead = await new LeadsRepo(db).latestByConversation(convId);
          leadId = lead?.id ?? null;
        }
      } catch {
        leadId = null;
      }

      const orders = new OrdersRepo(db);
      const { code } = await orders.create({
        conversationId: convId,
        leadId,
        items: productos.map((p) => ({
          name: p.nombre,
          sku: p.sku,
          qty: p.cantidad ?? 1,
          price: p.precio_unitario,
        })),
        total,
        currency: "BOB",
        customerName: cliente,
        contact: contacto,
        city: ciudad,
        address: direccion,
        deliveryZone: zona_envio,
        mapUrl: link_mapa,
        status: "pendiente",
        notes: nota,
      });

      return {
        code,
        total,
        currency: "BOB",
        status: "pendiente",
        message: `Pedido ${code} registrado. Total Bs ${total}. Falta que el cliente pague y que el dueño confirme.`,
      };
    },
  });
}
