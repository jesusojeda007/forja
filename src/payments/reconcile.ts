import type { Env } from "../env";
import { Db } from "../db/client";
import { PaymentsRepo, type Payment } from "../db/payments";
import { LeadsRepo } from "../db/leads";
import { parseBankPaymentEmail } from "./email-parser";
import { notifyOwnerPayment } from "./notify";

/**
 * Ventana de match: un correo del banco concilia pagos QR enviados en las
 * últimas 48h. Suficiente para una venta del día; evita confirmar un pedido
 * de la semana pasada pagado hoy por otra cosa.
 */
export const PAYMENT_MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Tolerancia de centavos para el match por monto. */
const EPS = 0.01;

export type ReconcileResult =
  | { resultado: "ignorado" } // no huele a notificación de pago
  | { resultado: "duplicado" } // ya procesamos este correo
  | { resultado: "confirmado"; paymentId: string; monto: number }
  | { resultado: "sin_match"; monto: number; banco: string }
  | { resultado: "ambiguo"; monto: number; candidatos: { id: string; monto: number }[] };

export async function handlePaymentEmail(
  env: Env,
  email: { from: string; to: string; subject: string; text: string },
): Promise<ReconcileResult> {
  const payments = new PaymentsRepo(new Db(env.DB));
  const hash = await sha256(`${email.from}|${email.subject}|${email.text.slice(0, 2000)}`);
  if (await payments.seenEmail(hash)) return { resultado: "duplicado" };

  const parsed = parseBankPaymentEmail({ from: email.from, subject: email.subject, text: email.text });
  if (!parsed) {
    await payments.logEmail(hash, "ignorado", null, null);
    return { resultado: "ignorado" };
  }

  const pending = await payments.listPending(PAYMENT_MATCH_WINDOW_MS);
  const candidatos = pending.filter((p) => Math.abs(p.monto - parsed.monto) < EPS);

  if (candidatos.length === 1) {
    const p = candidatos[0];
    await payments.markConfirmed(p.id, `${parsed.banco} ${email.from} — ${email.subject.slice(0, 120)}`);
    // El punto de la conciliación: la venta se marca sola cuando es inequívoca.
    if (p.lead_id) {
      try {
        await new LeadsRepo(new Db(env.DB)).setStatus(p.lead_id, "sold");
      } catch (e) {
        console.error("[payments] no pude marcar el lead como vendido:", e);
      }
    }
    await payments.logEmail(hash, "confirmado", parsed.monto, parsed.banco);
    await notifyOwnerPayment(env, {
      kind: "confirmado",
      monto: parsed.monto,
      banco: parsed.banco,
      payment: p,
    });
    return { resultado: "confirmado", paymentId: p.id, monto: parsed.monto };
  }

  if (candidatos.length === 0) {
    await payments.logEmail(hash, "sin_match", parsed.monto, parsed.banco);
    await notifyOwnerPayment(env, { kind: "sin_match", monto: parsed.monto, banco: parsed.banco });
    return { resultado: "sin_match", monto: parsed.monto, banco: parsed.banco };
  }

  await payments.logEmail(hash, "ambiguo", parsed.monto, parsed.banco);
  await notifyOwnerPayment(env, {
    kind: "ambiguo",
    monto: parsed.monto,
    banco: parsed.banco,
    candidatos: candidatos.map((c) => ({ id: c.id, monto: c.monto })),
  });
  return {
    resultado: "ambiguo",
    monto: parsed.monto,
    candidatos: candidatos.map((c) => ({ id: c.id, monto: c.monto })),
  };
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
