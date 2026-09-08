/**
 * Reportes automáticos (superpoder) — un resumen del período al dueño.
 *
 * settings.reportes: "off" (default) | "semanal" (los lunes, últimos 7 días) |
 * "diario" (cada noche, últimas 24 h). Corre en el bloque nocturno de
 * scheduled(). Candado report_sends por period_key. Corre aunque el bot esté
 * pausado — es un aviso al DUEÑO, no al cliente.
 */
import { generateText } from "ai";
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { loadLlmOverrides } from "../settings-loader";
import { createModel } from "../llm/provider";
import { getNiche } from "../niches";
import { businessTimeZone, todayInTz } from "../time/resolveDate";
import { deliverOwnerReport } from "./deliver";

const D = 24 * 60 * 60 * 1000;

export interface ReportMetrics {
  conversations: number;
  newLeads: number;
  leadsByStatus: Record<string, number>;
  assistantMessages: number;
  savedHours: number;
  topChannel: string | null;
  topTopics: string[];
  noShowsRecovered: number;
  bestDay: string | null;
}

export async function gatherMetrics(env: Env, sinceMs: number, nowMs: number): Promise<ReportMetrics> {
  const db = new Db(env.DB);
  const [convRow, leadRows, asstRow, channelRows, topicRows, recoveredRow, dayRows] = await Promise.all([
    db.first<{ n: number }>(
      "SELECT COUNT(DISTINCT conversation_id) as n FROM messages WHERE created_at >= ? AND created_at < ?",
      [sinceMs, nowMs],
    ),
    db.all<{ status: string; n: number }>(
      "SELECT status, COUNT(*) as n FROM leads WHERE created_at >= ? AND created_at < ? GROUP BY status",
      [sinceMs, nowMs],
    ),
    db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM messages WHERE role = 'assistant' AND created_at >= ? AND created_at < ?",
      [sinceMs, nowMs],
    ),
    db.all<{ channel: string; n: number }>(
      `SELECT c.channel, COUNT(m.id) as n FROM messages m JOIN conversations c ON m.conversation_id = c.id
       WHERE m.created_at >= ? AND m.created_at < ? GROUP BY c.channel ORDER BY n DESC LIMIT 1`,
      [sinceMs, nowMs],
    ),
    db.all<{ topics: string | null }>(
      "SELECT topics FROM conversation_insights WHERE analyzed_at >= ? AND analyzed_at < ?",
      [sinceMs, nowMs],
    ),
    db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM appointments WHERE recovered_at >= ? AND recovered_at < ?",
      [sinceMs, nowMs],
    ).catch(() => ({ n: 0 })),
    db.all<{ day: string; n: number }>(
      `SELECT date(created_at / 1000, 'unixepoch') as day, COUNT(*) as n FROM messages
       WHERE role = 'user' AND created_at >= ? AND created_at < ? GROUP BY day ORDER BY n DESC LIMIT 1`,
      [sinceMs, nowMs],
    ),
  ]);

  const leadsByStatus: Record<string, number> = {};
  let newLeads = 0;
  for (const r of leadRows) {
    leadsByStatus[r.status] = r.n;
    newLeads += r.n;
  }

  const topicCount = new Map<string, number>();
  for (const r of topicRows) {
    if (!r.topics) continue;
    try {
      const arr = JSON.parse(r.topics);
      if (Array.isArray(arr)) {
        for (const t of arr) {
          if (typeof t === "string" && t.trim()) {
            const k = t.trim().toLowerCase();
            topicCount.set(k, (topicCount.get(k) ?? 0) + 1);
          }
        }
      }
    } catch {
      /* topics mal formado — ignora */
    }
  }
  const topTopics = [...topicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);

  const asst = asstRow?.n ?? 0;
  return {
    conversations: convRow?.n ?? 0,
    newLeads,
    leadsByStatus,
    assistantMessages: asst,
    savedHours: Math.round(((asst * 2) / 60) * 10) / 10,
    topChannel: channelRows[0]?.channel ?? null,
    topTopics,
    noShowsRecovered: recoveredRow?.n ?? 0,
    bestDay: dayRows[0]?.day ?? null,
  };
}

/** "2026-W37" — semana ISO de una fecha (para el candado del reporte semanal). */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // lunes = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // jueves de esta semana
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / D - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function fallbackText(env: Env, cadence: "semanal" | "diario", m: ReportMetrics): string {
  const niche = getNiche(env);
  const período = cadence === "semanal" ? "Esta semana" : "Hoy";
  const lines = [
    `📊 ${env.BUSINESS_NAME} — reporte ${cadence}`,
    "",
    `${período} tu bot atendió ${m.conversations} conversaciones (${m.assistantMessages} respuestas).`,
    `${m.newLeads} ${niche.recordPlural.toLowerCase()} nuevos.`,
  ];
  const sold = m.leadsByStatus.sold ?? 0;
  if (sold > 0) lines.push(`${sold} con estado "${niche.statusLabels.sold}".`);
  if (m.noShowsRecovered > 0) lines.push(`${m.noShowsRecovered} no-shows recuperados.`);
  if (m.topTopics.length) lines.push(`Temas más frecuentes: ${m.topTopics.join(", ")}.`);
  if (m.bestDay) lines.push(`Tu día más movido: ${m.bestDay}.`);
  lines.push(`Tiempo estimado que te ahorró: ~${m.savedHours} h.`);
  return lines.join("\n");
}

export interface RunReportResult {
  sent: boolean;
  periodKey?: string;
}

export async function runReport(
  env: Env,
  opts: { now?: number; force?: boolean; forceCadence?: "semanal" | "diario" } = {},
): Promise<RunReportResult> {
  const now = opts.now ?? Date.now();
  const db = new Db(env.DB);
  const settings = new SettingsRepo(db);

  const mode = await settings.get(SETTING_KEYS.reportes);
  const cadence: "semanal" | "diario" | null =
    opts.forceCadence ?? (mode === "semanal" || mode === "diario" ? mode : null);
  if (!cadence) return { sent: false };

  const tz = businessTimeZone(env);
  const todayIso = todayInTz(tz, new Date(now));
  const isMonday = new Date(`${todayIso}T00:00:00Z`).getUTCDay() === 1;

  if (cadence === "semanal" && !isMonday && !opts.force) return { sent: false };

  // El botón "enviar prueba" usa una key propia (nunca choca con la real, así
  // el reporte programado sigue saliendo). El cron normal usa la key del período.
  const periodKey = opts.force
    ? `test-${now}`
    : cadence === "semanal"
      ? isoWeekKey(new Date(now))
      : todayIso;

  // Candado: si ya se envió este período, salir.
  const claim = await db.run(
    "INSERT OR IGNORE INTO report_sends (period_key, sent_at) VALUES (?, ?)",
    [periodKey, now],
  );
  if ((claim.meta.changes ?? 0) === 0 && !opts.force) return { sent: false, periodKey };

  const sinceMs = cadence === "semanal" ? now - 7 * D : now - D;
  const metrics = await gatherMetrics(env, sinceMs, now);

  let text: string;
  try {
    const { model } = createModel(env, "fast", await loadLlmOverrides(env));
    const r = await generateText({
      model: model as any,
      prompt: `Eres ${env.BOT_NAME}. Escribe un reporte ${cadence} BREVE para el dueño de ${env.BUSINESS_NAME}, en español, tono cercano y claro, sin emojis excesivos (máximo 1-2), sin markdown. Empieza con una línea de saludo/resumen y luego 4-7 líneas con los números que importan. Datos del período:
${JSON.stringify(metrics, null, 2)}

Traduce los números a valor para el negocio (ej. "te trajo X prospectos", "te ahorró ~Y horas"). No inventes datos que no estén arriba. Responde SOLO con el texto del reporte.`,
    });
    text = (r.text ?? "").trim() || fallbackText(env, cadence, metrics);
  } catch (e) {
    console.warn("[reportes] redacción falló — uso plantilla:", (e as Error)?.message ?? e);
    text = fallbackText(env, cadence, metrics);
  }

  const subject = `${env.BUSINESS_NAME} — reporte ${cadence} (${periodKey})`;
  await deliverOwnerReport(env, text, subject);

  return { sent: true, periodKey };
}
