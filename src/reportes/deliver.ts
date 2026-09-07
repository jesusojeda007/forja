import { Resend } from "resend";
import type { Env } from "../env";

// Entrega de un reporte al dueño: Telegram DM (gratis, reusa el bot token) +
// email (Resend). Texto libre — WhatsApp no aplica (exige plantilla aprobada
// para mensajes iniciados por el negocio). Cada canal es independiente y nunca
// tira: un reporte perdido no debe tumbar el cron nocturno.

export async function deliverOwnerReport(env: Env, text: string, subject: string): Promise<void> {
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.OWNER_TELEGRAM_CHAT_ID, text }),
      });
    } catch (e) {
      console.error("[reportes] telegram falló:", e);
    }
  }

  if (env.RESEND_API_KEY && env.OWNER_EMAIL) {
    try {
      const html = `<div style="font-family:system-ui,sans-serif;white-space:pre-wrap;font-size:14px;line-height:1.6">${escapeHtml(
        text,
      )}</div>`;
      await new Resend(env.RESEND_API_KEY).emails.send({
        from: `${env.BUSINESS_NAME} <onboarding@resend.dev>`,
        to: env.OWNER_EMAIL,
        subject,
        html,
      });
    } catch (e) {
      console.error("[reportes] email falló:", e);
    }
  }

  if (!env.OWNER_TELEGRAM_CHAT_ID && !(env.RESEND_API_KEY && env.OWNER_EMAIL)) {
    console.warn(
      "[reportes] sin canal de aviso al dueño (OWNER_TELEGRAM_CHAT_ID o RESEND_API_KEY+OWNER_EMAIL) — el reporte no llegó a nadie",
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
}
