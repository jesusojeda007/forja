import { Db } from "./client";

export interface ClientRow {
  channel_user_id: string;
  name: string;
  contact: string | null;
  /** Canales donde escribió (csv: "whatsapp,telegram"). */
  channels: string | null;
  conversations: number;
  /** Estado del lead más reciente (enum canónico new|contacted|sold|lost). */
  pipeline: string | null;
  last_activity: number;
  /** Suma de pagos CONFIRMADOS — lo que realmente compró. */
  ltv: number;
  pending_count: number;
  pending_sum: number;
  leads_total: number;
  leads_sold: number;
}

export interface ClientDetail {
  channel_user_id: string;
  name: string;
  contact: string | null;
  conversations: {
    id: string;
    channel: string;
    last_message_at: number;
    display_name: string | null;
  }[];
  leads: {
    id: string;
    status: string;
    intent: string;
    notes: string | null;
    metadata: string | null;
    created_at: number;
  }[];
  payments: {
    id: string;
    monto: number;
    status: string;
    referencia: string | null;
    channel: string;
    created_at: number;
  }[];
  facts: { fact: string; learned_at: number }[];
  labels: { interest: string | null; objection: string | null; summary: string | null }[];
  tickets: { id: string; category: string | null; summary: string; status: string | null; created_at: number }[];
  messages: { role: string; content: string; created_at: number }[];
}

/**
 * CRM derivado (nivel 1): agrupa lo que ya existe por identidad de canal
 * (channel_user_id — el teléfono en WhatsApp). Sin tabla nueva ni migración:
 * conversaciones + leads + payments + customer_facts + conv_labels + tickets
 * vistos por CLIENTE en vez de por hilo. La identidad cross-canal (misma
 * persona en dos apps) queda para un nivel 2 con tabla customers.
 */
export class ClientsRepo {
  constructor(private readonly db: Db) {}

  /** Lista de clientes con búsqueda y filtros de negocio. */
  async list(opts: { q?: string; filter?: string; limit?: number } = {}): Promise<ClientRow[]> {
    const wheres: string[] = [];
    const params: (string | number)[] = [];
    if (opts.q && opts.q.trim()) {
      wheres.push(
        "(COALESCE(ln.name, '') LIKE ? OR cu.identity LIKE ? OR COALESCE(ln.contact, '') LIKE ?)",
      );
      const like = `%${opts.q.trim()}%`;
      params.push(like, like, like);
    }
    if (opts.filter === "compraron") wheres.push("COALESCE(pay.ltv, 0) > 0");
    if (opts.filter === "pendientes") wheres.push("COALESCE(pay.pending_count, 0) > 0");
    if (opts.filter === "sincomprar") wheres.push("COALESCE(pay.ltv, 0) = 0");
    const whereSql = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
    params.push(opts.limit ?? 200);

    return this.db.all<ClientRow>(
      `SELECT
        cu.identity AS channel_user_id,
        COALESCE(ln.name, cu.display_name, cu.identity) AS name,
        ln.contact AS contact,
        cu.channels AS channels,
        cu.convs AS conversations,
        ln.status AS pipeline,
        MAX(cu.last_at, COALESCE(ln.last_lead_at, 0)) AS last_activity,
        COALESCE(pay.ltv, 0) AS ltv,
        COALESCE(pay.pending_count, 0) AS pending_count,
        COALESCE(pay.pending_sum, 0) AS pending_sum,
        COALESCE(ld.total, 0) AS leads_total,
        COALESCE(ld.sold, 0) AS leads_sold
      FROM (
        SELECT channel_user_id AS identity,
               GROUP_CONCAT(DISTINCT channel) AS channels,
               COUNT(*) AS convs,
               MAX(last_message_at) AS last_at,
               (SELECT c2.display_name FROM conversations c2
                 WHERE c2.channel_user_id = c.channel_user_id AND c2.display_name IS NOT NULL
                 ORDER BY c2.last_message_at DESC LIMIT 1) AS display_name
        FROM conversations c
        WHERE channel_user_id IS NOT NULL AND TRIM(channel_user_id) != ''
        GROUP BY channel_user_id
      ) cu
      LEFT JOIN (
        SELECT c.channel_user_id AS cu_id, l.name, l.contact, l.status, l.updated_at AS last_lead_at,
               l.rowid AS lrid
        FROM leads l JOIN conversations c ON l.conversation_id = c.id
      ) ln ON ln.cu_id = cu.identity
        AND ln.lrid = (
          SELECT l2.rowid FROM leads l2 JOIN conversations c2 ON l2.conversation_id = c2.id
          WHERE c2.channel_user_id = cu.identity
          ORDER BY l2.created_at DESC, l2.rowid DESC LIMIT 1
        )
      LEFT JOIN (
        SELECT c.channel_user_id AS pay_cu,
               SUM(CASE WHEN p.status = 'confirmado' THEN p.monto ELSE 0 END) AS ltv,
               SUM(CASE WHEN p.status = 'pendiente' THEN 1 ELSE 0 END) AS pending_count,
               SUM(CASE WHEN p.status = 'pendiente' THEN p.monto ELSE 0 END) AS pending_sum
        FROM payments p JOIN conversations c ON p.conversation_id = c.id
        GROUP BY c.channel_user_id
      ) pay ON pay.pay_cu = cu.identity
      LEFT JOIN (
        SELECT c.channel_user_id AS ld_cu, COUNT(*) AS total,
               SUM(CASE WHEN l.status = 'sold' THEN 1 ELSE 0 END) AS sold
        FROM leads l JOIN conversations c ON l.conversation_id = c.id
        GROUP BY c.channel_user_id
      ) ld ON ld.ld_cu = cu.identity
      ${whereSql}
      ORDER BY last_activity DESC
      LIMIT ?`,
      params,
    );
  }

  /** Ficha 360° de un cliente: todo lo que sabemos, por sección. */
  async detail(channelUserId: string): Promise<ClientDetail | null> {
    const convs = await this.db.all<{
      id: string;
      channel: string;
      last_message_at: number;
      display_name: string | null;
    }>(
      "SELECT id, channel, last_message_at, display_name FROM conversations WHERE channel_user_id = ? ORDER BY last_message_at DESC",
      [channelUserId],
    );
    if (convs.length === 0) return null;

    const latestLead = await this.db.first<{ name: string | null; contact: string | null }>(
      `SELECT l.name, l.contact FROM leads l JOIN conversations c ON l.conversation_id = c.id
       WHERE c.channel_user_id = ? AND l.name IS NOT NULL
       ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1`,
      [channelUserId],
    );
    const displayName = convs.find((c) => c.display_name)?.display_name ?? null;

    const [leads, payments, facts, labels, tickets, messages] = await Promise.all([
      this.db.all<ClientDetail["leads"][number]>(
        `SELECT l.id, l.status, l.intent, l.notes, l.metadata, l.created_at
         FROM leads l JOIN conversations c ON l.conversation_id = c.id
         WHERE c.channel_user_id = ? ORDER BY l.created_at DESC`,
        [channelUserId],
      ),
      this.db.all<ClientDetail["payments"][number]>(
        `SELECT p.id, p.monto, p.status, p.referencia, c.channel, p.created_at
         FROM payments p JOIN conversations c ON p.conversation_id = c.id
         WHERE c.channel_user_id = ? ORDER BY p.created_at DESC`,
        [channelUserId],
      ),
      this.db.all<ClientDetail["facts"][number]>(
        `SELECT f.fact, f.learned_at FROM customer_facts f
         JOIN conversations c ON f.conversation_id = c.id
         WHERE c.channel_user_id = ? ORDER BY f.learned_at DESC LIMIT 30`,
        [channelUserId],
      ),
      this.db.all<ClientDetail["labels"][number]>(
        `SELECT cl.interest, cl.objection, cl.summary FROM conv_labels cl
         JOIN conversations c ON cl.conversation_id = c.id
         WHERE c.channel_user_id = ? ORDER BY cl.labeled_at DESC LIMIT 5`,
        [channelUserId],
      ),
      this.db.all<ClientDetail["tickets"][number]>(
        `SELECT t.id, t.category, t.summary, t.status, t.created_at FROM tickets t
         JOIN conversations c ON t.conversation_id = c.id
         WHERE c.channel_user_id = ? ORDER BY t.created_at DESC LIMIT 10`,
        [channelUserId],
      ),
      this.db.all<ClientDetail["messages"][number]>(
        `SELECT m.role, m.content, m.created_at FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.channel_user_id = ? ORDER BY m.created_at DESC LIMIT 30`,
        [channelUserId],
      ),
    ]);

    return {
      channel_user_id: channelUserId,
      name: latestLead?.name ?? displayName ?? channelUserId,
      contact: latestLead?.contact ?? null,
      conversations: convs,
      leads,
      payments,
      facts,
      labels,
      tickets,
      messages: messages.reverse(),
    };
  }
}
