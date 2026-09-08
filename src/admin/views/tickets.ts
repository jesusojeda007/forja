import type { Env } from "../../env";
import { Db } from "../../db/client";
import { getNiche } from "../../niches";
import { channelLabel, channelIcon } from "../../channels/labels";
import { layout } from "./layout";
import type { AdminRole } from "../auth";
import { fmtDateTime } from "../format";

function esc(v: string | null | undefined): string {
  return (v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CATEGORY_LABEL: Record<string, string> = {
  billing: "Cobro / pago",
  product: "Producto",
  complaint: "Reclamo",
  other: "Otro",
};

interface TicketRow {
  id: string;
  conversation_id: string | null;
  category: string;
  summary: string;
  status: string;
  created_at: number;
  channel: string | null;
  channel_user_id: string | null;
  display_name: string | null;
  last_customer_msg: string | null;
}

export async function renderTickets(env: Env, role: AdminRole = "owner"): Promise<string> {
  const db = new Db(env.DB);
  // Ticket + de qué cliente vino + su último mensaje, en una sola consulta.
  const open = await db.all<TicketRow>(
    `SELECT t.id, t.conversation_id, t.category, t.summary, t.status, t.created_at,
            c.channel, c.channel_user_id, c.display_name,
            (SELECT m.content FROM messages m
              WHERE m.conversation_id = t.conversation_id AND m.role = 'user'
              ORDER BY m.created_at DESC LIMIT 1) AS last_customer_msg
       FROM tickets t
       LEFT JOIN conversations c ON c.id = t.conversation_id
      WHERE t.status != 'resolved'
      ORDER BY t.created_at DESC`,
  );

  const list = open
    .map((t) => {
      const who = t.display_name
        ? esc(t.display_name)
        : t.channel_user_id
          ? `Cliente ${esc(t.channel_user_id)}`
          : "Cliente sin identificar";
      const via = t.channel
        ? `${channelIcon(t.channel, 16)} <span class="text-dim" style="font-size:11px">${esc(channelLabel(t.channel))}</span>`
        : null;
      const cat = CATEGORY_LABEL[t.category] ?? esc(t.category);
      const convBtn = t.conversation_id
        ? `<a href="/admin/conversations?c=${encodeURIComponent(t.conversation_id)}"
              class="bigbtn font-display font-bold text-[11.5px]"
              style="display:inline-flex;align-items:center;gap:7px;background:var(--panel);border:1px solid var(--line);color:var(--cream);padding:9px 14px;text-decoration:none">
             <i data-lucide="messages-square" width="14" height="14"></i> Abrir conversación
           </a>`
        : `<span class="text-dim text-[11.5px]">Sin conversación ligada</span>`;

      return `<div class="tkcard bg-panel border border-line" style="padding:16px 18px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap">
            <span style="font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--bad,#c0553b);border:1px solid var(--bad,#c0553b);border-radius:999px;padding:1px 7px;flex:none">${esc(cat)}</span>
            <span class="font-display font-semibold text-[13px] text-cream">${who}</span>
            ${via ? `<span style="display:inline-flex;align-items:center;gap:5px">${via}</span>` : ""}
          </div>
          <span class="text-dim text-[11px]" style="flex:none">${fmtDateTime(t.created_at)}</span>
        </div>
        <p class="text-muted text-[12.5px] leading-relaxed" style="margin:0 0 8px">${esc(t.summary)}</p>
        ${
          t.last_customer_msg
            ? `<p class="text-dim text-[12px]" style="margin:0 0 12px;padding-left:10px;border-left:2px solid var(--line)">Último mensaje del cliente: "${esc(t.last_customer_msg.slice(0, 240))}"</p>`
            : ""
        }
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${convBtn}
          <form method="POST" action="/admin/tickets/${t.id}/resolve" style="margin:0">
            <input type="hidden" name="resolved_by" value="panel">
            <button class="bigbtn font-display font-bold text-[11.5px] cursor-pointer"
                    style="display:inline-flex;align-items:center;gap:7px;background:var(--accent);border:1px solid var(--accent);color:#ffffff;padding:9px 16px">
              <i data-lucide="check" width="14" height="14"></i> Marcar como resuelto
            </button>
          </form>
        </div>
      </div>`;
    })
    .join("");

  const record = getNiche(env).recordSingular.toLowerCase();
  const body =
    open.length === 0
      ? `<div class="bg-panel border border-line rounded-xl" style="padding:40px 18px;text-align:center">
           <p class="text-dim text-[12.5px]">No hay nada pendiente. Cuando el bot pase una consulta a una persona, aparece acá y te llega un aviso al Telegram.</p>
         </div>`
      : `<p class="text-dim" style="font-size:12px;margin:-4px 0 16px">${open.length} consulta(s) que el bot pasó a una persona. Abrí la conversación para responderle al cliente vos mismo (el bot queda pausado); después marcá el ticket como resuelto.</p>${list}`;

  return layout({ title: "Tickets", activeTab: "tickets", body, env, role });
}
