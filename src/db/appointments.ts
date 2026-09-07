import { Db } from "./client";

// Registro local de citas reservadas por el bot (tool scheduleAppointment).
// Cal.com es la fuente de verdad del calendario; esto sólo alimenta el
// superpoder "Recupera no-shows" (recordatorio la noche anterior + mensaje de
// recuperación si el cliente no dio señales tras la hora de la cita).

const H = 60 * 60 * 1000;
const D = 24 * H;

// Ventana del recordatorio: la cita empieza dentro de este rango desde "ahora".
export const REMINDER_FROM_MS = 18 * H;
export const REMINDER_TO_MS = 42 * H;

// Ventana de recuperación: la cita YA pasó, entre estos dos límites.
export const RECOVERY_MIN_AGO_MS = 3 * H; // deja pasar un rato
export const RECOVERY_MAX_AGO_MS = 3 * D;
// Un mensaje del cliente después de (start_ts - GRACE) cuenta como "dio señales".
const RECOVERY_GRACE_MS = 2 * H;

export interface CreateAppointmentInput {
  conversationId: string | null;
  channel: string;
  channelUserId: string;
  service?: string;
  attendeeName?: string;
  startTs: number;
  bookingId?: string;
}

export interface AppointmentRow {
  id: string;
  conversation_id: string | null;
  channel: string;
  channel_user_id: string;
  service: string | null;
  attendee_name: string | null;
  start_ts: number;
  booking_id: string | null;
  status: string;
}

export class AppointmentsRepo {
  constructor(private readonly db: Db) {}

  async create(input: CreateAppointmentInput): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO appointments
         (id, conversation_id, channel, channel_user_id, service, attendee_name, start_ts, booking_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?)`,
      [
        id,
        input.conversationId,
        input.channel,
        input.channelUserId,
        input.service ?? null,
        input.attendeeName ?? null,
        input.startTs,
        input.bookingId ?? null,
        Date.now(),
      ],
    );
    return id;
  }

  /** Citas `booked` cuya hora cae en la ventana del recordatorio. */
  async pickForReminder(now: number, limit: number): Promise<AppointmentRow[]> {
    return this.db.all<AppointmentRow>(
      `SELECT a.* FROM appointments a
       LEFT JOIN conversations c ON c.id = a.conversation_id
       WHERE a.status = 'booked'
         AND a.channel != 'instagram'
         AND a.start_ts >= ? AND a.start_ts <= ?
         AND (c.paused_until IS NULL OR c.paused_until < ?)
       ORDER BY a.start_ts ASC
       LIMIT ?`,
      [now + REMINDER_FROM_MS, now + REMINDER_TO_MS, now, limit],
    );
  }

  /**
   * Citas cuya hora ya pasó (dentro de la ventana de recuperación), aún en
   * `booked`/`reminded`, y SIN mensajes del cliente después de (start_ts - 2h)
   * — no-show silencioso.
   */
  async pickForRecovery(now: number, limit: number): Promise<AppointmentRow[]> {
    return this.db.all<AppointmentRow>(
      `SELECT a.* FROM appointments a
       LEFT JOIN conversations c ON c.id = a.conversation_id
       WHERE a.status IN ('booked', 'reminded')
         AND a.channel != 'instagram'
         AND a.start_ts <= ? AND a.start_ts >= ?
         AND (c.paused_until IS NULL OR c.paused_until < ?)
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.conversation_id = a.conversation_id
             AND m.role = 'user'
             AND m.created_at >= a.start_ts - ?
         )
       ORDER BY a.start_ts ASC
       LIMIT ?`,
      [
        now - RECOVERY_MIN_AGO_MS,
        now - RECOVERY_MAX_AGO_MS,
        now,
        RECOVERY_GRACE_MS,
        limit,
      ],
    );
  }

  /** Candado: pasa a `reminded` sólo si sigue en `booked`. */
  async markReminded(id: string, now: number): Promise<boolean> {
    const r = await this.db.run(
      "UPDATE appointments SET status = 'reminded', reminded_at = ? WHERE id = ? AND status = 'booked'",
      [now, id],
    );
    return (r.meta.changes ?? 0) > 0;
  }

  /** Candado: pasa a `recovered` desde `booked` o `reminded`. */
  async markRecovered(id: string, now: number): Promise<boolean> {
    const r = await this.db.run(
      "UPDATE appointments SET status = 'recovered', recovered_at = ? WHERE id = ? AND status IN ('booked', 'reminded')",
      [now, id],
    );
    return (r.meta.changes ?? 0) > 0;
  }
}
