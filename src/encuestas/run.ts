/**
 * Encuestas de satisfacción (superpoder) — opt-in (settings.encuestas = "auto").
 *
 *  • ENVÍO (nocturno): a cada conversación "cerrada" (hubo lead, cita o ticket
 *    resuelto) que lleva entre 2 y 24 h quieta y aún no fue encuestada, un
 *    mensaje corto pidiendo una nota del 1 al 5. Marca survey_sends (candado).
 *  • CAPTURA (en vivo, desde agent.ingest): si el cliente responde con una nota
 *    a una encuesta pendiente, se registra, se le agradece y NO se pasa el turno
 *    al bot. Nota <= 2 → aviso al dueño en el momento.
 *
 * Respeta la pausa global. Corre en el bloque nocturno de scheduled() (index.ts).
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { MessagesRepo } from "../db/messages";
import { ConversationsRepo } from "../db/conversations";
import { SurveyRepo } from "../db/surveys";
import { parseRating } from "./parse";
import { pickAdapter } from "../replies/sender";
import { deliverOwnerReport } from "../reportes/deliver";
import type { ChannelId } from "../channels/shared";

type Lang = "es" | "en" | "pt";

function lang(env: Env): Lang {
  const l = (env.BOT_LANGUAGE ?? "es").slice(0, 2).toLowerCase();
  return l === "en" || l === "pt" ? l : "es";
}

const ASK: Record<Lang, string> = {
  es: "¡Gracias por escribirnos! ¿Cómo estuvo la atención? Respóndeme con una nota del 1 (mala) al 5 (excelente) 🙏",
  en: "Thanks for reaching out! How was the service? Reply with a score from 1 (poor) to 5 (excellent) 🙏",
  pt: "Obrigado pelo contato! Como foi o atendimento? Responda com uma nota de 1 (ruim) a 5 (excelente) 🙏",
};

const THANKS_HIGH: Record<Lang, string> = {
  es: "¡Gracias! Nos alegra un montón 🙌",
  en: "Thank you! That makes our day 🙌",
  pt: "Obrigado! Ficamos muito felizes 🙌",
};
const THANKS_MID: Record<Lang, string> = {
  es: "¡Gracias por tu opinión! La tomamos en cuenta para mejorar.",
  en: "Thanks for your feedback! We'll use it to improve.",
  pt: "Obrigado pela sua opinião! Vamos usá-la para melhorar.",
};
const THANKS_LOW: Record<Lang, string> = {
  es: "Gracias por decírnoslo. Lo revisamos y alguien del equipo te va a contactar.",
  en: "Thanks for letting us know. We'll look into it and someone from the team will reach out.",
  pt: "Obrigado por nos avisar. Vamos verificar e alguém da equipe entrará em contato.",
};

export interface RunEncuestasResult {
  sent: number;
}

async function isOn(settings: SettingsRepo): Promise<boolean> {
  return (await settings.get(SETTING_KEYS.encuestas)) === "auto";
}

export async function runEncuestas(
  env: Env,
  opts: { now?: number; limit?: number } = {},
): Promise<RunEncuestasResult> {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 20;
  const db = new Db(env.DB);
  const settings = new SettingsRepo(db);

  if (!(await isOn(settings))) return { sent: 0 };
  if ((await settings.get(SETTING_KEYS.botPaused)) === "1") return { sent: 0 };

  const surveys = new SurveyRepo(db);
  const msgs = new MessagesRepo(db);
  const convs = new ConversationsRepo(db);
  const text = ASK[lang(env)];

  let sent = 0;
  for (const t of await surveys.pickForSend(now, limit)) {
    if (!(await surveys.markSent(t.id, t.channel, t.channel_user_id, now))) continue;
    try {
      await msgs.append(t.id, "assistant", text);
      await convs.touchLastMessage(t.id, now);
      await pickAdapter(t.channel as ChannelId).sendReply(
        { channel: t.channel as ChannelId, channelUserId: t.channel_user_id, chunks: [text], interChunkDelayMs: 0 },
        env,
      );
      sent++;
    } catch (e) {
      console.error(`[encuestas] envío falló para ${t.id}:`, e);
    }
  }

  if (sent) console.log(`[encuestas] enviadas=${sent}`);
  return { sent };
}

/**
 * Llamado desde agent.ingest antes de bufferear. Devuelve true si el mensaje era
 * la respuesta a una encuesta pendiente (y ya se manejó): el caller corta el
 * turno. false = seguir con el bot normal.
 */
export async function captureSurveyReply(
  env: Env,
  conversationId: string,
  channel: string,
  channelUserId: string,
  text: string,
  opts: { now?: number } = {},
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const db = new Db(env.DB);
  const settings = new SettingsRepo(db);
  if (!(await isOn(settings))) return false;

  const surveys = new SurveyRepo(db);
  if (!(await surveys.pending(conversationId, now))) return false;

  // Un mensaje largo casi nunca es una nota: es una pregunta nueva.
  if ((text ?? "").trim().length > 120) return false;
  const rating = parseRating(text);
  if (rating === null) return false;

  const comment = extractComment(text, rating);
  if (!(await surveys.recordResponse(conversationId, rating, comment, now))) return false;

  const l = lang(env);
  const reply = rating >= 4 ? THANKS_HIGH[l] : rating === 3 ? THANKS_MID[l] : THANKS_LOW[l];
  const msgs = new MessagesRepo(db);
  const convs = new ConversationsRepo(db);
  try {
    await msgs.append(conversationId, "user", text);
    await msgs.append(conversationId, "assistant", reply);
    await convs.touchLastMessage(conversationId, now);
    await pickAdapter(channel as ChannelId).sendReply(
      { channel: channel as ChannelId, channelUserId, chunks: [reply], interChunkDelayMs: 0 },
      env,
    );
  } catch (e) {
    console.error(`[encuestas] no pude agradecer en ${conversationId}:`, e);
  }

  if (rating <= 2) {
    try {
      const name = await displayName(db, conversationId);
      const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
      const link = `${base}/admin/conversations?c=${encodeURIComponent(conversationId)}`;
      const quien = name || "Un cliente";
      const body =
        `😕 Reseña baja: ${rating}/5 de ${quien}.\n` +
        (comment ? `Dijo: "${comment}"\n` : "") +
        `Ábrelo y respóndele: ${link}`;
      await deliverOwnerReport(env, body, `${env.BUSINESS_NAME} — reseña baja`);
    } catch (e) {
      console.error("[encuestas] no se pudo avisar de la reseña baja:", e);
    }
  }

  return true;
}

/** Lo que el cliente escribió además de la nota (p. ej. "2 porque esperé"). */
function extractComment(text: string, rating: number): string {
  const stripped = (text ?? "")
    .replace(new RegExp(`\\b${rating}\\b\\s*(?:\\/\\s*5|estrellas?|de\\s*5)?`), " ")
    .replace(/👍|👎/g, " ")
    .replace(/^\s*(?:porque|pq|xq)\s+/i, "")
    .trim();
  return stripped.length >= 3 ? stripped : "";
}

async function displayName(db: Db, conversationId: string): Promise<string | null> {
  const row = await db.first<{ display_name: string | null }>(
    "SELECT display_name FROM conversations WHERE id = ?",
    [conversationId],
  );
  return row?.display_name ?? null;
}
