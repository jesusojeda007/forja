import type { Env } from "../../env";
import { Db } from "../../db/client";
import { OrdersRepo, orderItems, type Order, type OrderStatus } from "../../db/orders";
import { layout } from "./layout";
import { fmtDate, fmtDateTime } from "../format";

function esc(v: string | null | undefined): string {
  return (v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATUSES: OrderStatus[] = [
  "pendiente",
  "reservado",
  "pagado",
  "enviado",
  "entregado",
  "cancelado",
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  pendiente: "Pendiente de pago",
  reservado: "Apartado",
  pagado: "Pagado",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

// Color por estado: ámbar (falta pagar) · celeste (apartado) · verde (pagado) ·
// violeta (en camino) · verde fuerte (entregado) · gris (cancelado).
const STATUS_COLOR: Record<OrderStatus, string> = {
  pendiente: "var(--amber)",
  reservado: "var(--sky)",
  pagado: "var(--ok)",
  enviado: "var(--violet)",
  entregado: "#0a7f56",
  cancelado: "var(--dim)",
};
const STATUS_BG: Record<OrderStatus, string> = {
  pendiente: "var(--amber-soft)",
  reservado: "var(--sky-soft)",
  pagado: "var(--ok-soft)",
  enviado: "var(--violet-soft)",
  entregado: "var(--accent-soft)",
  cancelado: "var(--panel2)",
};

const ZONE_LABEL: Record<string, string> = {
  incluido: "Envío incluido",
  cliente_paga: "Envío lo paga el cliente",
  interior: "Interior (pago adelantado)",
};

export async function renderPedidos(env: Env): Promise<string> {
  const orders = new OrdersRepo(new Db(env.DB));
  const list = await orders.list(200);

  const openCount = list.filter(
    (o) => o.status === "pendiente" || o.status === "reservado",
  ).length;
  const soldTotal = list
    .filter((o) => o.status === "pagado" || o.status === "enviado" || o.status === "entregado")
    .reduce((s, o) => s + o.total, 0);

  const rows = list
    .map((o) => {
      const items = orderItems(o);
      const itemsShort = items.map((i) => `${i.qty}× ${esc(i.name)}`).join(", ");
      const itemsFull = items
        .map(
          (i) =>
            `<span class="text-muted" style="font-size:12px">${i.qty}× ${esc(i.name)}${
              i.sku ? ` <span class="text-dim">(${esc(i.sku)})</span>` : ""
            } — Bs ${i.price}</span>`,
        )
        .join("<br>");
      const mapLink = o.map_url
        ? `<a href="${esc(o.map_url)}" target="_blank" rel="noopener" class="text-accent" style="font-size:12px;text-decoration:none">Ver ubicación en el mapa</a>`
        : "";
      const convLink = o.conversation_id
        ? `<a href="/admin/conversations?c=${encodeURIComponent(o.conversation_id)}" class="text-accent" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;text-decoration:none"><i data-lucide="messages-square" width="13" height="13"></i> Ver conversación</a>`
        : `<span class="text-dim" style="font-size:11.5px">Sin conversación ligada</span>`;
      const reservedNote =
        o.status === "reservado" && o.reserved_until
          ? `<span class="text-dim" style="font-size:11.5px">Apartado hasta ${fmtDateTime(o.reserved_until)}</span>`
          : "";

      return `<div class="lead" style="border-top:1px solid var(--line);border-left:3px solid ${STATUS_COLOR[o.status]}">
        <div class="leadrow" onclick="var d=this.parentNode.querySelector('.lead-detail');var open=d.style.display==='block';d.style.display=open?'none':'block';this.querySelector('.chev').style.transform=open?'rotate(0deg)':'rotate(90deg)'"
             style="display:grid;grid-template-columns:96px 92px minmax(120px,1fr) minmax(160px,1.6fr) 92px 156px;gap:12px;padding:13px 18px;font-size:12.5px;align-items:center;cursor:pointer">
          <span style="display:flex;align-items:center;gap:7px;font-weight:600;color:var(--accent-2)"><i data-lucide="chevron-right" width="13" height="13" class="chev" style="flex:none;transition:transform .12s ease"></i>${esc(o.code)}</span>
          <span class="text-dim">${fmtDate(o.created_at)}</span>
          <span class="text-muted truncate">${esc(o.customer_name) || "(sin nombre)"}</span>
          <span class="text-muted truncate">${itemsShort || "—"}</span>
          <span style="font-variant-numeric:tabular-nums;font-weight:700;color:var(--accent)">Bs ${o.total}</span>
          <form method="POST" action="/admin/pedidos/${o.id}/status" onclick="event.stopPropagation()">
            <select name="status" onchange="this.form.submit()"
                    style="width:100%;background:${STATUS_BG[o.status]};border:1px solid ${STATUS_COLOR[o.status]};color:${STATUS_COLOR[o.status]};font-weight:600;padding:6px 8px;font-size:11px;outline:none;cursor:pointer;border-radius:var(--r-pill)">
              ${STATUSES.map(
                (s) => `<option ${o.status === s ? "selected" : ""} value="${s}" style="color:var(--cream);background:var(--panel)">${esc(STATUS_LABEL[s])}</option>`,
              ).join("")}
            </select>
          </form>
        </div>
        <div class="lead-detail" style="display:none;padding:4px 18px 20px 18px;background:var(--bg)">
          <div style="max-width:760px;display:flex;flex-direction:column;gap:14px;padding-top:14px">
            <div>
              <div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Productos</div>
              <div style="line-height:1.7">${itemsFull || "—"}</div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px 24px">
              <span class="text-muted" style="font-size:12px"><span class="text-dim">Cliente:</span> ${esc(o.customer_name) || "—"}</span>
              <span class="text-muted" style="font-size:12px"><span class="text-dim">Contacto:</span> ${esc(o.contact) || "—"}</span>
              <span class="text-muted" style="font-size:12px"><span class="text-dim">Ciudad:</span> ${esc(o.city) || "—"}</span>
              <span class="text-muted" style="font-size:12px"><span class="text-dim">Zona:</span> ${
                o.delivery_zone ? esc(ZONE_LABEL[o.delivery_zone] ?? o.delivery_zone) : "—"
              }</span>
            </div>
            ${
              o.address
                ? `<div><div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Dirección</div><div class="text-cream" style="font-size:13px;line-height:1.5;white-space:pre-wrap">${esc(o.address)}</div>${mapLink ? `<div style="margin-top:6px">${mapLink}</div>` : ""}</div>`
                : ""
            }
            ${
              o.notes
                ? `<div><div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Nota</div><div class="text-muted" style="font-size:12.5px;line-height:1.5;white-space:pre-wrap">${esc(o.notes)}</div></div>`
                : ""
            }
            <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding-top:2px">
              ${convLink}
              <span class="text-dim" style="font-size:11.5px;display:inline-flex;align-items:center;gap:6px"><i data-lucide="clock" width="12" height="12"></i>${fmtDateTime(o.created_at)}</span>
              ${reservedNote}
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  const empty = `<div style="padding:40px 18px;text-align:center" class="text-dim text-[12.5px]">Todavía no hay pedidos. El bot los registra cuando un cliente cierra la compra.</div>`;

  const body = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 class="font-display font-semibold text-[15px] text-cream">Pedidos</h2>
      <div style="display:flex;gap:10px">
        <span style="padding:7px 12px;font-size:12px;font-weight:600;color:var(--amber);background:var(--amber-soft);border-radius:var(--r-pill)">${openCount} por atender</span>
        <span style="padding:7px 12px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ok);background:var(--ok-soft);border-radius:var(--r-pill)">Bs ${soldTotal} vendido</span>
      </div>
    </div>
    <p class="text-dim" style="font-size:12px;margin:-6px 0 16px">El bot nunca marca un pago como confirmado. Vos verificás en tu banco y movés el pedido a "Pagado".</p>
    <div class="bg-panel border border-line rounded-xl" style="overflow-x:auto">
      <div style="min-width:740px">
        <div style="display:grid;grid-template-columns:96px 92px minmax(120px,1fr) minmax(160px,1.6fr) 92px 156px;gap:12px;padding:10px 18px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">
          <span>Código</span><span>Fecha</span><span>Cliente</span><span>Productos</span><span>Total</span><span>Estado</span>
        </div>
        ${list.length ? rows : empty}
      </div>
    </div>`;
  return layout({ title: "Pedidos", activeTab: "pedidos", body, env });
}
