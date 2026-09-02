import type { Env } from "../env";
import type { Payment } from "../db/payments";

/**
 * Aviso al dueño sobre conciliación de pagos. Telegram DM (best-effort, igual
 * que el aviso de handoff): "confirmado" buena noticia, y los otros dos casos
 * piden un clic del dueño porque no hay que adivinar con dinero de por medio.
 */
export async function notifyOwnerPayment(
  env: Env,
  notice:
    | { kind: "confirmado"; monto: number; banco: string; payment: Payment }
    | { kind: "sin_match"; monto: number; banco: string }
    | { kind: "ambiguo"; monto: number; banco: string; candidatos: { id: string; monto: number }[] },
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.OWNER_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // sin canal configurado, no avisamos (best-effort)

  const dash = env.DASHBOARD_BASE_URL ?? "";
  let text: string;
  if (notice.kind === "confirmado") {
    text =
      `✅ Pago confirmado: Bs ${notice.monto} (${notice.banco}). ` +
      `La venta se marcó sola en el panel.`;
  } else if (notice.kind === "sin_match") {
    text =
      `⚠️ Depósito de Bs ${notice.monto} (${notice.banco}) sin un pedido pendiente que coincida. ` +
      `Puede ser un pago manual: márcalo en el panel → ${dash}/admin/leads`;
  } else {
    text =
      `⚠️ Depósito de Bs ${notice.monto} (${notice.banco}) coincide con ${notice.candidatos.length} pedidos ` +
      `de ese monto — no lo asigné para no adivinar. Elige cuál es: ${dash}/admin/leads`;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error("[notifyOwnerPayment] telegram failed:", e);
  }
}
