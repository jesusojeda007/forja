import type { Env } from "../env";
import { isPro } from "../config";
import { searchKbTool } from "./searchKb";
import { handoffHumanTool } from "./handoffHuman";
import { pauseBotTool } from "./pauseBot";
import { snoozeUserTool } from "./snoozeUser";
import { captureLeadTool } from "./captureLead";
import { scheduleAppointmentTool } from "./scheduleAppointment";
import { catalogQueryTool } from "./catalogQuery";
import { sendPaymentQrTool } from "./sendPaymentQr";
import { sendProductPhotoTool } from "./sendProductPhoto";
import { registrarPedidoTool } from "./registrarPedido";
import { apartarProductoTool } from "./apartarProducto";
import { estadoPedidoTool } from "./estadoPedido";
import { anotarEnEsperaTool } from "./anotarEnEspera";
import { getNiche } from "../niches";
import { sendGalleryItemTool } from "./sendGalleryItem";
import type { ChannelId } from "../channels/shared";

export interface ToolContext {
  env: Env;
  getConversationId: () => string | null;
  /** Canal/usuario activos de la conversación (para tools que envían media). */
  getChannel: () => ChannelId | null;
  getChannelUserId: () => string | null;
}

export function buildTools(ctx: ToolContext) {
  // Free tier base set. captureLead y scheduleAppointment van aquí a propósito: el bot
  // Starter (free) captura prospectos Y agenda citas — Cal.com lo pone el dueño con su
  // propia cuenta/llave, sin costo para Forja, así que es valor central sin gate. Lo Pro
  // es consultar catálogo/inventario y las tools avanzadas por nicho.
  const tools: Record<string, any> = {
    searchKb: searchKbTool(ctx.env),
    handoffHuman: handoffHumanTool(ctx.env, ctx.getConversationId),
    pauseBot: pauseBotTool(ctx.env, ctx.getConversationId),
    snoozeUser: snoozeUserTool(ctx.env, ctx.getConversationId),
    captureLead: captureLeadTool(ctx.env, ctx.getConversationId),
    scheduleAppointment: scheduleAppointmentTool(
      ctx.env,
      ctx.getConversationId,
      ctx.getChannel,
      ctx.getChannelUserId,
    ),
    // El QR de pago no gatea a Pro: es la herramienta de cierre de venta del
    // nicho tienda y no requiere ningún servicio externo de Forja.
    sendPaymentQr: sendPaymentQrTool(ctx.env, ctx.getConversationId, ctx.getChannel, ctx.getChannelUserId),
    // Galería (superpoder): settings-loader la excluye de enabledToolNames salvo
    // que settings.galeria = "on", así el prompt sólo la anuncia cuando aplica.
    sendGalleryItem: sendGalleryItemTool(ctx.env, ctx.getConversationId, ctx.getChannel, ctx.getChannelUserId),
  };

  // Pro tier additions
  if (isPro(ctx.env)) {
    tools.catalogQuery = catalogQueryTool(ctx.env);
    // Mandar fotos del producto: mismo tier que consultar catálogo (necesita la fuente).
    tools.sendProductPhoto = sendProductPhotoTool(ctx.env, ctx.getChannel, ctx.getChannelUserId);

    // Herramientas de tienda: registrar pedidos, consultar su estado y anotar
    // en lista de espera. Solo tienen sentido con el pack "tienda".
    if (getNiche(ctx.env).id === "tienda") {
      tools.registrarPedido = registrarPedidoTool(ctx.env, ctx.getConversationId);
      tools.apartarProducto = apartarProductoTool(ctx.env, ctx.getConversationId);
      tools.estadoPedido = estadoPedidoTool(ctx.env, ctx.getConversationId);
      tools.anotarEnEspera = anotarEnEsperaTool(
        ctx.env,
        ctx.getConversationId,
        ctx.getChannel,
        ctx.getChannelUserId,
      );
    }
  }

  return tools;
}
