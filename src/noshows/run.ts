/**
 * Recupera no-shows (superpoder) — dos toques nocturnos, opt-in.
 *
 *  • RECORDATORIO: a cada cita `booked` que empieza dentro de ~18-42 h, un
 *    mensaje breve ("tu cita es mañana a las X, ¿sigue en pie?"). La respuesta
 *    del cliente entra al bot normal. Marca la cita `reminded`.
 *  • RECUPERACIÓN: a cada cita cuya hora ya pasó (3 h a 3 días) que sigue en
 *    `booked`/`reminded` y NO tuvo mensajes del cliente tras la hora de la cita
 *    (no-show silencioso), un mensaje ("no pudiste venir, ¿reagendamos?").
 *    Marca la cita `recovered`.
 *
 * El cambio de `status` es el candado anti-doble-envío (como followup_sends).
 * Respeta la pausa global y la de cada conversación. Corre en el bloque
 * nocturno de scheduled() (index.ts). Sólo hace algo si settings.noshows = "on".
 */
import { generateText } from "ai";
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { MessagesRepo } from "../db/messages";
import { ConversationsRepo } from "../db/conversations";
import { AppointmentsRepo, type AppointmentRow } from "../db/appointments";
import { loadLlmOverrides } from "../settings-loader";
import { createModel } from "../llm/provider";
import { pickAdapter } from "../replies/sender";
import type { ChannelId } from "../channels/shared";

export interface RunNoShowsResult {
  remindersSent: number;
  recoveriesSent: number;
}

type Phase = "reminder" | "recovery";

function whenText(startTs: number, language: string): string {
  const locale = language && language.length >= 2 ? language : "es-MX";
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(
      new Date(startTs),
    );
  } catch {
    return new Date(startTs).toISOString();
  }
}

function fallbackMessage(phase: Phase, appt: AppointmentRow, env: Env): string {
  const svc = appt.service ? ` de ${appt.service}` : "";
  const when = whenText(appt.start_ts, env.BOT_LANGUAGE);
  return phase === "reminder"
    ? `Hola, te recuerdo tu cita${svc} el ${when}. ¿Sigue en pie? Si necesitas moverla, dime y la reagendamos.`
    : `Hola, vi que no pudimos verte en tu cita${svc} del ${when}. ¿Te busco un nuevo horario?`;
}

async function craftMessage(
  phase: Phase,
  appt: AppointmentRow,
  env: Env,
  model: unknown,
): Promise<string> {
  const when = whenText(appt.start_ts, env.BOT_LANGUAGE);
  const svc = appt.service ?? "una cita";
  const brief =
    phase === "reminder"
      ? `El cliente tiene una cita de "${svc}" el ${when}. Escríbele UN mensaje breve (1-2 líneas) recordándosela y preguntándole con naturalidad si sigue en pie, ofreciendo reagendar si no.`
      : `El cliente tenía una cita de "${svc}" el ${when} y no llegó ni avisó. Escríbele UN mensaje breve (1-2 líneas), sin reproche, preguntándole si quiere que le busques un nuevo horario.`;
  try {
    const r = await generateText({
      model: model as any,
      prompt: `Eres ${env.BOT_NAME}, atiendes los chats de ${env.BUSINESS_NAME} en primera persona: humano, cálido, español, sin emojis, nada pushy.\n\n${brief}\n\nResponde SOLO con el mensaje, sin comillas.`,
    });
    const text = (r.text ?? "").trim();
    return text || fallbackMessage(phase, appt, env);
  } catch (e) {
    console.warn(`[noshows] craft ${phase} fail — uso plantilla:`, (e as Error)?.message ?? e);
    return fallbackMessage(phase, appt, env);
  }
}

export async function runNoShows(
  env: Env,
  opts: { now?: number; limit?: number } = {},
): Promise<RunNoShowsResult> {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 20;
  const zero: RunNoShowsResult = { remindersSent: 0, recoveriesSent: 0 };

  const db = new Db(env.DB);
  const settings = new SettingsRepo(db);

  if ((await settings.get(SETTING_KEYS.noshows)) !== "on") return zero;
  if ((await settings.get(SETTING_KEYS.botPaused)) === "1") return zero;

  const appts = new AppointmentsRepo(db);
  const msgs = new MessagesRepo(db);
  const convs = new ConversationsRepo(db);
  const { model, modelId } = createModel(env, "fast", await loadLlmOverrides(env));

  const send = async (phase: Phase, appt: AppointmentRow): Promise<boolean> => {
    const claimed =
      phase === "reminder"
        ? await appts.markReminded(appt.id, now)
        : await appts.markRecovered(appt.id, now);
    if (!claimed) return false; // otra corrida lo tomó

    try {
      const text = await craftMessage(phase, appt, env, model);
      if (appt.conversation_id) {
        await msgs.append(appt.conversation_id, "assistant", text, { modelUsed: modelId });
        await convs.touchLastMessage(appt.conversation_id, now);
      }
      await pickAdapter(appt.channel as ChannelId).sendReply(
        {
          channel: appt.channel as ChannelId,
          channelUserId: appt.channel_user_id,
          chunks: [text],
          interChunkDelayMs: 0,
        },
        env,
      );
      return true;
    } catch (e) {
      // El claim queda: mejor un toque perdido que dos. Se registra el fallo.
      console.error(`[noshows] ${phase} falló para ${appt.id}:`, e);
      return false;
    }
  };

  let remindersSent = 0;
  for (const appt of await appts.pickForReminder(now, limit)) {
    if (await send("reminder", appt)) remindersSent++;
  }

  let recoveriesSent = 0;
  for (const appt of await appts.pickForRecovery(now, limit)) {
    if (await send("recovery", appt)) recoveriesSent++;
  }

  if (remindersSent || recoveriesSent) {
    console.log(`[noshows] recordatorios=${remindersSent} recuperaciones=${recoveriesSent}`);
  }
  return { remindersSent, recoveriesSent };
}
