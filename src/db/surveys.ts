import { Db } from "./client";

// Encuestas de satisfacción (superpoder). Una fila por conversación "cerrada"
// (hubo lead, cita o ticket resuelto). La PRIMARY KEY conversation_id es el
// candado anti-doble-envío (INSERT OR IGNORE), como followup_sends. La respuesta
// del cliente (rating 1-5 + comentario) actualiza la misma fila.

const H = 60 * 60 * 1000;
const D = 24 * H;

// La conversación tiene que llevar quieta al menos esto (para no encuestar en
// caliente) y como mucho esto (pasado ese punto ya no tiene sentido).
export const QUIET_MIN_MS = 2 * H;
export const QUIET_MAX_MS = 24 * H;
// Cuánto tiempo después del envío seguimos aceptando la respuesta del cliente.
export const RESPONSE_WINDOW_MS = 3 * D;

export interface SurveyTarget {
  id: string;
  channel: string;
  channel_user_id: string;
}

export interface SurveyRow {
  conversation_id: string;
  channel: string;
  channel_user_id: string;
  sent_at: number;
  rating: number | null;
  comment: string | null;
  responded_at: number | null;
}

export interface SurveyStats {
  n: number;
  avg: number | null;
  detractors: number;
  promoters: number;
}

export class SurveyRepo {
  constructor(private readonly db: Db) {}

  /** Conversaciones cerradas y quietas, sin encuesta previa. */
  async pickForSend(now: number, limit: number): Promise<SurveyTarget[]> {
    return this.db.all<SurveyTarget>(
      `SELECT c.id, c.channel, c.channel_user_id
       FROM conversations c
       WHERE c.channel != 'instagram'
         AND c.last_message_at <= ? AND c.last_message_at >= ?
         AND (c.paused_until IS NULL OR c.paused_until < ?)
         AND NOT EXISTS (SELECT 1 FROM survey_sends s WHERE s.conversation_id = c.id)
         AND (
           EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)
           OR EXISTS (SELECT 1 FROM appointments a WHERE a.conversation_id = c.id)
           OR EXISTS (SELECT 1 FROM tickets t WHERE t.conversation_id = c.id AND t.status = 'resolved')
         )
       ORDER BY c.last_message_at ASC
       LIMIT ?`,
      [now - QUIET_MIN_MS, now - QUIET_MAX_MS, now, limit],
    );
  }

  /** Candado: inserta la fila de envío. false = ya existía. */
  async markSent(conversationId: string, channel: string, channelUserId: string, now: number): Promise<boolean> {
    const r = await this.db.run(
      `INSERT OR IGNORE INTO survey_sends (conversation_id, channel, channel_user_id, sent_at)
       VALUES (?, ?, ?, ?)`,
      [conversationId, channel, channelUserId, now],
    );
    return (r.meta.changes ?? 0) > 0;
  }

  /** Encuesta enviada, sin responder y dentro de la ventana de respuesta. */
  async pending(conversationId: string, now: number): Promise<SurveyRow | null> {
    return this.db.first<SurveyRow>(
      `SELECT * FROM survey_sends
       WHERE conversation_id = ? AND responded_at IS NULL AND sent_at >= ?`,
      [conversationId, now - RESPONSE_WINDOW_MS],
    );
  }

  /** Candado: registra la respuesta sólo si aún no había una. */
  async recordResponse(
    conversationId: string,
    rating: number,
    comment: string,
    now: number,
  ): Promise<boolean> {
    const r = await this.db.run(
      `UPDATE survey_sends SET rating = ?, comment = ?, responded_at = ?
       WHERE conversation_id = ? AND responded_at IS NULL`,
      [rating, comment || null, now, conversationId],
    );
    return (r.meta.changes ?? 0) > 0;
  }

  async stats(sinceMs: number): Promise<SurveyStats> {
    const row = await this.db.first<{ n: number; avg: number | null; detractors: number; promoters: number }>(
      `SELECT COUNT(rating) AS n,
              AVG(rating) AS avg,
              COALESCE(SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END), 0) AS detractors,
              COALESCE(SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END), 0) AS promoters
       FROM survey_sends
       WHERE responded_at IS NOT NULL AND responded_at >= ?`,
      [sinceMs],
    );
    return {
      n: row?.n ?? 0,
      avg: row?.avg ?? null,
      detractors: row?.detractors ?? 0,
      promoters: row?.promoters ?? 0,
    };
  }

  async recentComments(limit: number): Promise<Pick<SurveyRow, "conversation_id" | "rating" | "comment" | "responded_at">[]> {
    return this.db.all(
      `SELECT conversation_id, rating, comment, responded_at
       FROM survey_sends
       WHERE comment IS NOT NULL AND comment != ''
       ORDER BY responded_at DESC
       LIMIT ?`,
      [limit],
    );
  }
}
