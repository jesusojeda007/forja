import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";

export function captureLeadTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Captura un lead (cliente interesado) para que el dueño venda o despache después. " +
      "Guarda en D1 + opcionalmente exporta a Google Sheets / Notion / Airtable. " +
      "Volvé a llamarla con los mismos datos + los nuevos a medida que la conversación avanza (nombre, producto, y al cerrar: dirección de entrega).",
    inputSchema: z.object({
      name: z.string().optional().describe("Nombre del cliente"),
      contact: z.string().optional().describe("Teléfono o email"),
      intent: z.string().describe("Qué quiere el cliente, en 1-2 frases"),
      notes: z.string().optional(),
      producto: z.string().optional().describe("Producto(s) que le interesan"),
      monto: z.number().optional().describe("Monto total aproximado de la compra, solo el número"),
      ciudad: z.string().optional().describe("Ciudad de entrega"),
      direccion: z
        .string()
        .optional()
        .describe("Dirección de entrega: barrio/zona, calle, número y una referencia"),
      zona_envio: z
        .enum(["incluido", "cliente_paga", "interior"])
        .optional()
        .describe(
          "Clasificación según las reglas del negocio: 'incluido' (envío sin costo), " +
            "'cliente_paga' (fuera de la zona incluida, paga al recibir), 'interior' (otra ciudad)",
        ),
      ubicacion_mapa: z
        .string()
        .optional()
        .describe("Link de Google Maps si el cliente compartió su ubicación"),
    }),
    execute: async ({ name, contact, intent, notes, ...rest }) => {
      const convId = getConversationId();
      const leads = new LeadsRepo(new Db(env.DB));
      // Campos estructurados → metadata (columnas del panel + datos de entrega).
      const metadata: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null && v !== "") metadata[k] = v;
      }
      const leadId = await leads.create({
        conversationId: convId,
        name,
        contact,
        channelUserId: null,
        intent,
        notes,
        metadata: Object.keys(metadata).length ? metadata : undefined,
      });

      // Optional external export — Pro-tier feature, skipped if no creds
      // (Implementation deferred to Task 7.4 — adds Google Sheets export)

      return { leadId, message: "Lead capturado." };
    },
  });
}
