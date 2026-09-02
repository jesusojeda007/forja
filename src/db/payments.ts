import { Db } from "./client";

export interface Payment {
  id: string;
  conversation_id: string | null;
  lead_id: string | null;
  monto: number;
  referencia: string | null;
  status: "pendiente" | "confirmado";
  created_at: number;
  confirmed_at: number | null;
  confirmed_by: string | null;
}

/**
 * Pagos por QR registrados cuando el bot envía el QR con monto. La
 * conciliación (src/payments/reconcile.ts) matchea el correo del banco contra
 * los `pendiente` por monto y ventana de tiempo.
 */
export class PaymentsRepo {
  constructor(private readonly db: Db) {}

  async create(input: {
    conversationId: string | null;
    leadId: string | null;
    monto: number;
    referencia?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO payments (id, conversation_id, lead_id, monto, referencia, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', ?)`,
      [id, input.conversationId, input.leadId, input.monto, input.referencia ?? null, Date.now()],
    );
    return id;
  }

  /** Pendientes dentro de la ventana (más viejos = expirados, no matchean). */
  async listPending(windowMs: number): Promise<Payment[]> {
    return this.db.all<Payment>(
      "SELECT * FROM payments WHERE status = 'pendiente' AND created_at >= ? ORDER BY created_at DESC",
      [Date.now() - windowMs],
    );
  }

  async markConfirmed(id: string, confirmedBy: string): Promise<void> {
    await this.db.run(
      "UPDATE payments SET status = 'confirmado', confirmed_at = ?, confirmed_by = ? WHERE id = ?",
      [Date.now(), confirmedBy, id],
    );
  }

  /** Ya procesamos este correo? (dedupe por hash del contenido). */
  async seenEmail(hash: string): Promise<boolean> {
    const row = await this.db.first<{ hash: string }>(
      "SELECT hash FROM payment_email_log WHERE hash = ?",
      [hash],
    );
    return !!row;
  }

  async logEmail(hash: string, resultado: string, monto: number | null, banco: string | null): Promise<void> {
    await this.db.run(
      `INSERT INTO payment_email_log (hash, monto, banco, resultado, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hash) DO NOTHING`,
      [hash, monto, banco, resultado, Date.now()],
    );
  }
}
