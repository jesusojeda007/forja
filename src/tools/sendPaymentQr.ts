import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { PaymentsRepo } from "../db/payments";
import { LeadsRepo } from "../db/leads";
import { pickAdapter } from "../replies/sender";
import type { ChannelId } from "../channels/shared";

/**
 * Envía el QR de pago del negocio por el canal activo (imagen + caption con el
 * total e instrucciones del dueño). Pensado para el flujo boliviano de QR
 * interoperable: el cliente escanea con su app bancaria y el dinero cae
 * directo a la cuenta del dueño — Forja no toca el dinero, solo entrega el QR
 * en el momento de la decisión y registra el interés.
 *
 * Con `monto`, además registra un pago `pendiente` (tabla payments): el correo
 * de notificación del banco concilia contra esos registros para marcar la
 * venta sola (ver src/payments/reconcile.ts).
 */
export function sendPaymentQrTool(
  env: Env,
  getConversationId: () => string | null,
  getChannel: () => ChannelId | null,
  getChannelUserId: () => string | null,
) {
  return tool({
    description:
      "Envía el código QR de pago del negocio al cliente. Úsalo cuando el cliente decidió comprar y va a pagar. Opcionalmente indica el monto total a pagar.",
    inputSchema: z.object({
      monto: z.number().positive().optional().describe("Monto total a pagar (solo el número)"),
      referencia: z.string().optional().describe("Qué está pagando el cliente, en pocas palabras"),
    }),
    execute: async ({ monto, referencia }) => {
      // El QR y las instrucciones viven en settings (Configuración del panel).
      // Sin QR configurado la tool es honesta: devuelve sent:false y el bot
      // cae a las instrucciones de la KB en vez de inventar.
      const db = new Db(env.DB);
      const settings = await new SettingsRepo(db).all();
      const qrUrl = (settings[SETTING_KEYS.paymentQrUrl] ?? "").trim();
      if (!qrUrl) {
        return {
          sent: false,
          reason: "El negocio no configuró un QR de pago todavía.",
        };
      }
      const channel = getChannel();
      const channelUserId = getChannelUserId();
      if (!channel || !channelUserId) {
        return { sent: false, reason: "sin canal activo" };
      }
      const instructions = (settings[SETTING_KEYS.paymentInstructions] ?? "").trim();
      const parts = [
        instructions || "Escanea este QR con la app de tu banco para completar el pago.",
        monto != null ? `Total a pagar: ${monto}` : undefined,
        referencia ? `Concepto: ${referencia}` : undefined,
      ].filter(Boolean);
      const caption = parts.join("\n");
      try {
        await pickAdapter(channel).sendImage?.({ channel, channelUserId, url: qrUrl, caption }, env);
      } catch (e) {
        // Si el canal falla, la URL pública sirve como fallback (el cliente la
        // abre y ve el QR). Nunca rompemos la conversación por esto.
        console.error("[sendPaymentQr] sendImage failed:", e);
        return { sent: false, reason: "no se pudo enviar la imagen", qrUrl };
      }

      // Pago pendiente para la conciliación por correo del banco. Best-effort:
      // si falla el registro, el QR igual llegó y el dueño marca la venta.
      let registrado = false;
      if (monto != null) {
        try {
          const convId = getConversationId();
          const lead = convId
            ? await new LeadsRepo(db).latestByConversation(convId)
            : null;
          await new PaymentsRepo(db).create({
            conversationId: convId,
            leadId: lead?.id ?? null,
            monto,
            referencia,
          });
          registrado = true;
        } catch (e) {
          console.error("[sendPaymentQr] no pude registrar el pago pendiente:", e);
        }
      }
      return { sent: true, monto, referencia, registrado };
    },
  });
}
