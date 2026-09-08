// Un solo sistema de etapas para TODO el panel (Embudo, Conversaciones,
// Clientes). Se calcula solo a partir de señales de la conversación — el dueño
// no arrastra tarjetas. Prioridad: humano > compró > por comprar > escribió.

export type StageId = "escribio" | "porcomprar" | "compro" | "humano";

export interface Stage {
  id: StageId;
  label: string;
  color: string;
  tint: string;
  emoji: string;
}

export const STAGES: Stage[] = [
  { id: "escribio", label: "Escribió", color: "#64748b", tint: "#eef2f6", emoji: "💬" },
  { id: "porcomprar", label: "Por comprar", color: "#d97706", tint: "#fdf1e2", emoji: "🛒" },
  { id: "compro", label: "Compró", color: "#15803d", tint: "#e7f5ec", emoji: "✅" },
  { id: "humano", label: "Necesita un humano", color: "#dc2626", tint: "#fceaea", emoji: "🔔" },
];

export const STAGE_BY_ID: Record<StageId, Stage> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, Stage>;

export function isStageId(v: string | null | undefined): v is StageId {
  return v === "escribio" || v === "porcomprar" || v === "compro" || v === "humano";
}

/** Señales mínimas para clasificar una conversación. */
export interface StageSignals {
  paused_until?: number | null;
  open_tickets?: number | null;
  lead_status?: string | null;
  lead_meta?: string | null; // JSON string de leads.metadata
  order_statuses?: string | null; // group_concat de orders.status ("pagado,pendiente")
}

export function stageOf(s: StageSignals, now: number = Date.now()): StageId {
  if ((s.open_tickets ?? 0) > 0 || (s.paused_until != null && s.paused_until > now)) {
    return "humano";
  }
  const os = (s.order_statuses ?? "").split(",").filter(Boolean);
  if (
    os.some((x) => x === "pagado" || x === "enviado" || x === "entregado") ||
    s.lead_status === "sold"
  ) {
    return "compro";
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = s.lead_meta ? JSON.parse(s.lead_meta) : {};
  } catch {
    meta = {};
  }
  if (
    os.some((x) => x === "pendiente" || x === "reservado") ||
    !!meta.producto ||
    !!meta.monto ||
    s.lead_status === "contacted"
  ) {
    return "porcomprar";
  }
  return "escribio";
}

/**
 * Columnas SELECT (sobre el alias `c` de conversations) que traen todas las
 * señales que `stageOf` necesita. Se pegan dentro de un SELECT existente.
 */
export const STAGE_SIGNAL_COLUMNS = `
  (SELECT COUNT(*) FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved') AS open_tickets,
  (SELECT l.status FROM leads l WHERE l.conversation_id = c.id ORDER BY l.created_at DESC LIMIT 1) AS lead_status,
  (SELECT l.metadata FROM leads l WHERE l.conversation_id = c.id ORDER BY l.created_at DESC LIMIT 1) AS lead_meta,
  (SELECT group_concat(o.status) FROM orders o WHERE o.conversation_id = c.id) AS order_statuses
`;
