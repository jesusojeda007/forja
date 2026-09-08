import type { Env } from "../../env";
import { Db } from "../../db/client";
import { channelIcon } from "../../channels/labels";
import { STAGES, STAGE_BY_ID, stageOf, type StageId } from "../stages";
import { layout } from "./layout";

// Embudo / pipeline: las conversaciones repartidas en las etapas de src/admin/stages.ts
// (el MISMO sistema que usan Conversaciones y Clientes). Cada tarjeta abre el hilo.

function esc(v: string | null | undefined): string {
  return (v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ago(ms: number | null | undefined): string {
  if (!ms) return "";
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function initials(label: string): string {
  const p = label.trim().split(/\s+/).filter(Boolean);
  return (p.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?").slice(0, 2);
}

const STAGE_HINT: Record<StageId, string> = {
  escribio: "Consultaron, sin señal de compra todavía",
  porcomprar: "Preguntaron por un producto concreto o dejaron un pedido sin pagar",
  compro: "Pedido pagado, enviado o entregado",
  humano: "El bot escaló o vos tomaste el control",
};

interface Row {
  id: string;
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  last_message_at: number;
  paused_until: number | null;
  last_user_msg: string | null;
  open_tickets: number;
  ticket_cat: string | null;
  lead_status: string | null;
  lead_meta: string | null;
  lead_name: string | null;
  order_statuses: string | null;
  bought_total: number | null;
  pending_total: number | null;
  order_codes: string | null;
}

function cardHtml(r: Row): { stage: StageId; html: string } {
  const stage = stageOf(r);
  const st = STAGE_BY_ID[stage];
  const name = esc(r.display_name || r.lead_name || r.channel_user_id || "—");
  const preview = esc((r.last_user_msg ?? "").replace(/\s+/g, " ").slice(0, 64));

  let meta: Record<string, unknown> = {};
  try {
    meta = r.lead_meta ? JSON.parse(r.lead_meta) : {};
  } catch {
    meta = {};
  }

  const facts: string[] = [];
  if (stage === "porcomprar") {
    if (meta.producto) facts.push(`<span class="text-cream">${esc(String(meta.producto)).slice(0, 40)}</span>`);
    if (r.pending_total) facts.push(`<span class="text-dim">pedido Bs ${r.pending_total} sin pagar</span>`);
    else if (meta.monto) facts.push(`<span class="text-dim">~Bs ${esc(String(meta.monto))}</span>`);
  } else if (stage === "compro") {
    if (r.bought_total) facts.push(`<span class="text-cream">Bs ${r.bought_total}</span>`);
    const codes = (r.order_codes ?? "").split(",").filter(Boolean);
    if (codes.length) facts.push(`<span class="text-dim">${esc(codes[0])}${codes.length > 1 ? ` +${codes.length - 1}` : ""}</span>`);
  } else if (stage === "humano") {
    facts.push(`<span style="color:${st.color};font-weight:600">🔔 espera respuesta</span>`);
    if (r.ticket_cat) facts.push(`<span class="text-dim">${esc(r.ticket_cat)}</span>`);
  }

  const html = `<a href="/admin/conversations?c=${encodeURIComponent(r.id)}"
    class="bg-panel" style="display:flex;flex-direction:column;gap:7px;border:1px solid var(--line);border-left:3px solid ${st.color};border-radius:10px;padding:11px 12px;text-decoration:none"
    onmouseover="this.style.borderColor='var(--accent)';this.style.borderLeftColor='${st.color}'" onmouseout="this.style.borderColor='var(--line)';this.style.borderLeftColor='${st.color}'">
    <div style="display:flex;align-items:center;gap:8px;min-width:0">
      <span style="width:26px;height:26px;flex:none;background:var(--raise);border:1px solid var(--linelit);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--accent);border-radius:6px">${initials(r.display_name || r.lead_name || r.channel_user_id || "?")}</span>
      <span class="text-cream" style="font-size:12.5px;font-weight:600;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;flex:1">${name}</span>
      ${channelIcon(r.channel, 19)}
    </div>
    ${facts.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11px">${facts.join("")}</div>` : ""}
    ${preview ? `<div class="text-muted" style="font-size:11px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden">"${preview}"</div>` : ""}
    <div class="text-dim" style="font-size:9.5px">${ago(r.last_message_at)}</div>
  </a>`;

  return { stage, html };
}

async function loadRows(env: Env): Promise<Row[]> {
  return new Db(env.DB).all<Row>(
    `SELECT c.id, c.channel, c.channel_user_id, c.display_name, c.last_message_at, c.paused_until,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role='user' ORDER BY m.created_at DESC LIMIT 1) AS last_user_msg,
      (SELECT COUNT(*) FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved') AS open_tickets,
      (SELECT t.category FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved' ORDER BY t.created_at DESC LIMIT 1) AS ticket_cat,
      (SELECT l.status FROM leads l WHERE l.conversation_id = c.id ORDER BY l.created_at DESC LIMIT 1) AS lead_status,
      (SELECT l.metadata FROM leads l WHERE l.conversation_id = c.id ORDER BY l.created_at DESC LIMIT 1) AS lead_meta,
      (SELECT l.name FROM leads l WHERE l.conversation_id = c.id AND l.name IS NOT NULL ORDER BY l.created_at DESC LIMIT 1) AS lead_name,
      (SELECT group_concat(o.status) FROM orders o WHERE o.conversation_id = c.id) AS order_statuses,
      (SELECT group_concat(o.code) FROM orders o WHERE o.conversation_id = c.id) AS order_codes,
      (SELECT SUM(o.total) FROM orders o WHERE o.conversation_id = c.id AND o.status IN ('pagado','enviado','entregado')) AS bought_total,
      (SELECT SUM(o.total) FROM orders o WHERE o.conversation_id = c.id AND o.status IN ('pendiente','reservado')) AS pending_total
     FROM conversations c
     ORDER BY c.last_message_at DESC
     LIMIT 400`,
  );
}

export async function renderEmbudoBoard(env: Env): Promise<string> {
  const rows = await loadRows(env);
  const byStage: Record<StageId, string[]> = { escribio: [], porcomprar: [], compro: [], humano: [] };
  for (const r of rows) {
    const c = cardHtml(r);
    byStage[c.stage].push(c.html);
  }

  return STAGES.map((s) => {
    const cards = byStage[s.id];
    const list = cards.length
      ? cards.join("")
      : `<div class="text-dim" style="font-size:11px;padding:14px 4px;text-align:center">—</div>`;
    return `<div style="flex:1;min-width:230px;display:flex;flex-direction:column;gap:9px">
      <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:${s.tint};border-top:2px solid ${s.color};border-radius:4px">
        <span class="font-display" style="font-size:12.5px;font-weight:700;color:${s.color}">${s.emoji} ${s.label}</span>
        <span style="font-size:11px;font-weight:600;color:${s.color};opacity:.7;margin-left:auto">${cards.length}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">${list}</div>
    </div>`;
  }).join("");
}

export async function renderEmbudo(env: Env): Promise<string> {
  const board = await renderEmbudoBoard(env);
  const legend = STAGES.map(
    (s) => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)">
      <span style="width:7px;height:7px;border-radius:50%;background:${s.color}"></span>${s.label}: ${esc(STAGE_HINT[s.id])}</span>`,
  ).join("");

  const body = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <h2 class="font-display font-semibold text-[15px] text-cream">Embudo</h2>
      <span class="text-dim" style="font-size:11px">se actualiza solo cada 20 s</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:16px">${legend}</div>
    <div hx-get="/admin/embudo/board" hx-trigger="every 20s" hx-swap="innerHTML"
         style="display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;align-items:flex-start">
      ${board}
    </div>`;
  return layout({ title: "Embudo", activeTab: "embudo", body, env });
}
