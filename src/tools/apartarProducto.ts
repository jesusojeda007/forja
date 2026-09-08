import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { OrdersRepo } from "../db/orders";
import { LeadsRepo } from "../db/leads";

/**
 * Aparta (reserva) un producto para un cliente que TODAVÍA no compró, por unas
 * horas. Crea un pedido en estado 'reservado' con vencimiento. Si el cliente
 * después confirma la compra, se usa registrarPedido normal.
 */
export function apartarProductoTool(
  env: Env,
  getConversationId: () => string | null,
) {
  return tool({
    description:
      "Aparta un producto para un cliente que quiere reservarlo pero todavía NO confirma la compra (ej. 'guardame uno, paso mañana'). " +
      "Crea un pedido reservado por las horas indicadas. NO usar cuando el cliente ya decidió comprar (ahí va registrarPedido).",
    inputSchema: z.object({
      producto: z.string().describe("Nombre del producto, del catálogo"),
      cantidad: z.number().int().min(1).default(1),
      precio_unitario: z.number(),
      horas: z.number().int().min(1).max(72).describe("Por cuántas horas apartarlo (máximo el de las reglas del negocio)"),
      cliente: z.string().optional(),
      contacto: z.string().optional().describe("Teléfono del cliente"),
      nota: z.string().optional(),
    }),
    execute: async ({ producto, cantidad, precio_unitario, horas, cliente, contacto, nota }) => {
      const convId = getConversationId();
      const db = new Db(env.DB);
      const qty = cantidad ?? 1;

      let leadId: string | null = null;
      try {
        if (convId) leadId = (await new LeadsRepo(db).latestByConversation(convId))?.id ?? null;
      } catch {
        leadId = null;
      }

      const { code } = await new OrdersRepo(db).create({
        conversationId: convId,
        leadId,
        items: [{ name: producto, qty, price: precio_unitario }],
        total: precio_unitario * qty,
        currency: "BOB",
        customerName: cliente,
        contact: contacto,
        status: "reservado",
        reservedUntil: Date.now() + horas * 3_600_000,
        notes: nota,
      });

      return {
        code,
        horas,
        status: "reservado",
        message: `Producto apartado ${horas} h con el número ${code}. Si no confirma la compra en ese plazo, vuelve a estar disponible.`,
      };
    },
  });
}
