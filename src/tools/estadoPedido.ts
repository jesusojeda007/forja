import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { OrdersRepo, orderItems, type Order } from "../db/orders";

const STATUS_TEXT: Record<string, string> = {
  pendiente: "registrado, falta confirmar el pago",
  reservado: "apartado, falta que confirmes la compra",
  pagado: "pago confirmado, preparando el envío",
  enviado: "en camino",
  entregado: "entregado",
  cancelado: "cancelado",
};

/**
 * Consulta el estado de un pedido para responder "¿dónde está lo mío?".
 * Busca por código (TS-0001), por el teléfono del cliente, o el último pedido
 * de esta conversación. NUNCA inventa un estado: si no encuentra, lo dice.
 */
export function estadoPedidoTool(
  env: Env,
  getConversationId: () => string | null,
) {
  return tool({
    description:
      "Consulta el estado de un pedido del cliente (registrado, pagado, en camino, entregado). " +
      "Usalo cuando el cliente pregunte por su pedido / envío. Si no encuentra el pedido, decilo y ofrecé pasar con un asesor — no inventes.",
    inputSchema: z.object({
      codigo: z.string().optional().describe("Número de pedido si el cliente lo da (ej. TS-0007)"),
      telefono: z.string().optional().describe("Teléfono del cliente, para buscar su pedido"),
    }),
    execute: async ({ codigo, telefono }) => {
      const db = new Db(env.DB);
      const orders = new OrdersRepo(db);
      let order: Order | null = null;

      if (codigo) order = await orders.byCode(codigo);
      if (!order && telefono) order = await orders.latestByContact(telefono);
      if (!order) {
        const convId = getConversationId();
        if (convId) order = await orders.latestByConversation(convId);
      }

      if (!order) {
        return { found: false, message: "No encontré un pedido con esos datos." };
      }

      return {
        found: true,
        code: order.code,
        status: order.status,
        status_texto: STATUS_TEXT[order.status] ?? order.status,
        total: order.total,
        currency: order.currency,
        productos: orderItems(order).map((i) => `${i.qty}x ${i.name}`),
        ciudad: order.city,
        creado: new Date(order.created_at).toISOString().slice(0, 10),
      };
    },
  });
}
