import { Db } from "./client";
import type { LeadBand } from "../cazador/score";

export interface LeadScoreRow {
  conversation_id: string;
  score: number;
  band: LeadBand;
  reason: string;
  scored_at: number;
  alerted_at: number | null;
}

export interface TopOpenRow extends LeadScoreRow {
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  last_message_at: number;
}

export interface UpsertScore {
  score: number;
  band: LeadBand;
  reason: string;
  scoredAt: number;
  /** Si se pasa, sobreescribe alerted_at (para marcar el aviso). */
  alertedAt?: number | null;
}

export class LeadScoresRepo {
  constructor(private readonly db: Db) {}

  get(conversationId: string): Promise<LeadScoreRow | null> {
    return this.db.first<LeadScoreRow>("SELECT * FROM lead_scores WHERE conversation_id = ?", [conversationId]);
  }

  async upsert(conversationId: string, s: UpsertScore): Promise<void> {
    // Conserva alerted_at salvo que se pase explícito.
    const keepAlerted = s.alertedAt === undefined;
    await this.db.run(
      `INSERT INTO lead_scores (conversation_id, score, band, reason, scored_at, alerted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         score = excluded.score,
         band = excluded.band,
         reason = excluded.reason,
         scored_at = excluded.scored_at${keepAlerted ? "" : ", alerted_at = excluded.alerted_at"}`,
      [conversationId, s.score, s.band, s.reason, s.scoredAt, keepAlerted ? null : s.alertedAt ?? null],
    );
  }

  async markAlerted(conversationId: string, at: number): Promise<void> {
    await this.db.run("UPDATE lead_scores SET alerted_at = ? WHERE conversation_id = ?", [at, conversationId]);
  }

  /** Leads abiertos (sin ticket cerrado / no vendidos aún) ordenados por score. */
  async topOpen(limit: number): Promise<TopOpenRow[]> {
    return this.db.all<TopOpenRow>(
      `SELECT s.*, c.channel, c.channel_user_id, c.display_name, c.last_message_at
       FROM lead_scores s
       JOIN conversations c ON c.id = s.conversation_id
       WHERE s.score > 0
       ORDER BY s.score DESC, s.scored_at DESC
       LIMIT ?`,
      [limit],
    );
  }
}
