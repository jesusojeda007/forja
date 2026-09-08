/**
 * Cazador de ventas (superpoder) — corre tras cada turno cuando cazador="on".
 *
 * Puntúa el calor del lead por señales (score.ts, sin LLM), guarda el score, y
 * si cruzó a caliente/muy_caliente le avisa al dueño EN EL MOMENTO (Telegram +
 * email, reusando deliverOwnerReport). Un aviso por episodio caliente; se
 * re-avisa si vuelve a subir después de RE_ALERT_MS.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { MessagesRepo } from "../db/messages";
import { LeadScoresRepo } from "../db/leadScores";
import { scoreConversation, type LeadBand } from "./score";
import { deliverOwnerReport } from "../reportes/deliver";

const RE_ALERT_MS = 3 * 24 * 60 * 60 * 1000; // 3 días
const HOT: LeadBand[] = ["caliente", "muy_caliente"];
const BAND_EMOJI: Record<LeadBand, string> = {
  frio: "🧊",
  tibio: "🌤️",
  caliente: "🔥",
  muy_caliente: "🔥🔥",
};

export interface RunCazadorResult {
  score: number;
  band: LeadBand;
  alerted: boolean;
}

export async function runCazador(
  env: Env,
  conversationId: string,
  opts: { now?: number } = {},
): Promise<RunCazadorResult> {
  const now = opts.now ?? Date.now();
  const db = new Db(env.DB);

  if ((await new SettingsRepo(db).get(SETTING_KEYS.cazador)) !== "on") {
    return { score: 0, band: "frio", alerted: false };
  }

  const msgs = new MessagesRepo(db);
  const history = await msgs.lastN(conversationId, 30);
  const userTexts = history.filter((m) => m.role === "user").map((m) => m.content);

  const [leadRow, apptRow] = await Promise.all([
    db.first<{ n: number }>("SELECT COUNT(*) as n FROM leads WHERE conversation_id = ?", [conversationId]),
    db
      .first<{ n: number }>("SELECT COUNT(*) as n FROM appointments WHERE conversation_id = ?", [conversationId])
      .catch(() => ({ n: 0 })),
  ]);

  const { score, band, reason } = scoreConversation({
    userTexts,
    hasLead: (leadRow?.n ?? 0) > 0,
    hasAppointment: (apptRow?.n ?? 0) > 0,
  });

  const scores = new LeadScoresRepo(db);
  const prev = await scores.get(conversationId);
  await scores.upsert(conversationId, { score, band, reason, scoredAt: now });

  const shouldAlert =
    HOT.includes(band) &&
    (!prev?.alerted_at || now - prev.alerted_at > RE_ALERT_MS);

  if (!shouldAlert) return { score, band, alerted: false };

  try {
    const name = history.find((m) => m.role === "user") ? await displayName(db, conversationId) : null;
    const link = `${(env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "")}/admin/conversations?c=${encodeURIComponent(conversationId)}`;
    const quien = name ? name : "Un cliente";
    const text =
      `${BAND_EMOJI[band]} ${quien} está listo para comprar (score ${score}/100).\n` +
      (reason ? `Por qué: ${reason}.\n` : "") +
      `Ábrelo y ciérralo: ${link}`;
    await deliverOwnerReport(env, text, `${env.BUSINESS_NAME} — lead caliente`);
    await scores.markAlerted(conversationId, now);
  } catch (e) {
    console.error("[cazador] no se pudo avisar:", (e as Error)?.message ?? e);
    return { score, band, alerted: false };
  }

  return { score, band, alerted: true };
}

async function displayName(db: Db, conversationId: string): Promise<string | null> {
  const row = await db.first<{ display_name: string | null }>(
    "SELECT display_name FROM conversations WHERE id = ?",
    [conversationId],
  );
  return row?.display_name ?? null;
}
