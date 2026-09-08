import type { Env } from "../../env";
import { Db } from "../../db/client";
import { ClientsRepo, type ClientRow } from "../../db/clients";
import { getNiche } from "../../niches";
import { layout } from "./layout";
import type { AdminRole } from "../auth";
import { fmtDateTime } from "../format";

// CRM derivado: los mismos datos del inbox vistos por CLIENTE (identidad =
// channel_user_id, el teléfono en WhatsApp). Conversaciones sigue siendo el
// inbox hilo-por-hilo; esta pestaña responde "¿quién es y cómo vamos?".

function esc(v: string | null | undefined): string {
  return (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const fmtBs = (n: number) => `Bs ${n.toLocaleString("es-BO", { maximumFractionDigits: 2 })}`;

const FILTERS = [
  { id: "", label: "Todos" },
  { id: "pendientes", label: "Pago pendiente" },
  { id: "compraron", label: "Ya compraron" },
  { id: "sincomprar", label: "Sin compra" },
] as const;

function pipelineBadge(status: string | null, env?: Env): string {
  if (!status) return `<span class="text-dim" style="font-size:11px">sin pipeline</span>`;
  const niche = env ? getNiche(env) : null;
  const label = niche?.statusLabels[status as keyof typeof niche.statusLabels] ?? status;
  const color =
    status === "sold" ? "var(--ok, #15803d)" : status === "lost" ? "var(--dim)" : "var(--accent)";
  return `<span style="font-size:11px;color:${color};border:1px solid var(--line);border-radius:6px;padding:3px 8px">${esc(label)}</span>`;
}

function channelChips(channels: string | null): string {
  const list = (channels ?? "").split(",").filter(Boolean);
  return list
    .map((c) => `<span class="text-dim" style="font-size:10.5px;border:1px solid var(--line);padding:2px 6px">${esc(c)}</span>`)
    .join(" ");
}

export async function renderClientes(
  env: Env,
  opts: { q?: string; f?: string },
  role: AdminRole = "owner",
): Promise<string> {
  const repo = new ClientsRepo(new Db(env.DB));
  const list = await repo.list({ q: opts.q, filter: opts.f || undefined });

  const searchQ = esc(opts.q ?? "");
  const chips = FILTERS.map((f) => {
    const active = (opts.f ?? "") === f.id;
    const qs = new URLSearchParams();
    if (opts.q) qs.set("q", opts.q);
    if (f.id) qs.set("f", f.id);
    const href = `/admin/clientes${qs.toString() ? `?${qs}` : ""}`;
    return `<a href="${href}" class="${active ? "text-accent" : "text-muted"}"
      style="font-size:12px;text-decoration:none;border:1px solid var(--line);padding:6px 12px;${active ? "background:var(--panel);" : ""}">${f.label}</a>`;
  }).join("");

  const rows = list
    .map((c: ClientRow) => {
      const pending =
        c.pending_count > 0
          ? `<span style="font-size:11px;color:var(--warn, #b45309)">⏳ ${c.pending_count} pago${c.pending_count > 1 ? "s" : ""} sin confirmar (${fmtBs(c.pending_sum)})</span>`
          : `<span class="text-dim" style="font-size:11px">sin pagos pendientes</span>`;
      return `<a href="/admin/clientes/${encodeURIComponent(c.channel_user_id)}" class="bg-panel rounded-xl"
        style="display:flex;flex-direction:column;gap:8px;border:1px solid var(--line);padding:16px 18px;text-decoration:none;transition:border-color .12s ease"
        onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--line)'">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <span class="text-cream font-semibold" style="font-size:13.5px">${esc(c.name)}</span>
          ${pipelineBadge(c.pipeline, env)}
        </div>
        <div class="text-muted" style="font-size:12px">${esc(c.contact) || esc(c.channel_user_id)}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <span class="text-cream" style="font-size:12.5px"><span class="text-dim">LTV:</span> ${fmtBs(c.ltv)}</span>
          ${channelChips(c.channels)}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          ${pending}
          <span class="text-dim" style="font-size:10.5px">${fmtDateTime(c.last_activity)}</span>
        </div>
      </a>`;
    })
    .join("");

  const empty = `<div style="padding:40px 18px;text-align:center" class="text-dim text-[12.5px]">
    ${opts.q ? `Sin clientes que coincidan con “${searchQ}”.` : "Cuando tu bot capture leads o envie QRs, tus clientes aparecen aquí con su historial completo."}
  </div>`;

  const body = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;flex-wrap:wrap">
      <h2 class="font-display font-semibold text-[15px] text-cream">Clientes <span class="text-dim text-[12px]">(${list.length})</span></h2>
      <form method="GET" action="/admin/clientes" style="display:flex;gap:8px">
        ${opts.f ? `<input type="hidden" name="f" value="${esc(opts.f)}">` : ""}
        <input name="q" value="${searchQ}" placeholder="Buscar por nombre, teléfono…"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 12px;font-size:12.5px;outline:none;width:240px">
        <button class="ghostbtn" style="background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:8px 14px;font-size:12.5px;cursor:pointer">Buscar</button>
      </form>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">${chips}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      ${list.length ? rows : empty}
    </div>`;
  return layout({ title: "Clientes", activeTab: "clientes", body, env, role });
}

export async function renderCliente(
  env: Env,
  channelUserId: string,
  role: AdminRole = "owner",
): Promise<string> {
  const repo = new ClientsRepo(new Db(env.DB));
  const c = await repo.detail(channelUserId);
  if (!c) return layout({ title: "Cliente", activeTab: "clientes", body: `<div class="text-dim">Cliente no encontrado.</div>`, env, role });

  const ltv = c.payments.filter((p) => p.status === "confirmado").reduce((s, p) => s + p.monto, 0);
  const pend = c.payments.filter((p) => p.status === "pendiente");
  const niche = getNiche(env);
  const statusLabel = (s: string) => niche.statusLabels[s as keyof typeof niche.statusLabels] ?? s;

  const section = (title: string, inner: string) => `
    <div class="bg-panel rounded-xl" style="border:1px solid var(--line);padding:18px">
      <div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:10px">${title}</div>
      ${inner}
    </div>`;

  const leadsHtml = c.leads.length
    ? c.leads
        .map(
          (l) => `<div style="display:flex;gap:12px;align-items:baseline;padding:8px 0;border-top:1px solid var(--line)">
          ${pipelineBadge(l.status, env)}
          <div style="min-width:0;flex:1">
            <div class="text-cream" style="font-size:12.5px">${esc(l.intent)}</div>
            <span class="text-dim" style="font-size:10.5px">${fmtDateTime(l.created_at)}</span>
          </div>
        </div>`,
        )
        .join("")
    : `<div class="text-dim" style="font-size:12px">Sin leads registrados.</div>`;

  const paymentsHtml = c.payments.length
    ? c.payments
        .map(
          (p) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:12.5px">
          <span class="${p.status === "confirmado" ? "text-cream" : "text-muted"}">${fmtBs(p.monto)}${p.referencia ? ` — ${esc(p.referencia)}` : ""}</span>
          <span class="${p.status === "confirmado" ? "text-accent" : "text-muted"}" style="font-size:11px">${p.status === "confirmado" ? "✓ confirmado" : "pendiente"} · ${esc(p.channel)}</span>
        </div>`,
        )
        .join("")
    : `<div class="text-dim" style="font-size:12px">Sin pagos registrados.</div>`;

  const factsHtml = c.facts.length
    ? c.facts.map((f) => `<div class="text-muted" style="font-size:12.5px;padding:5px 0;border-top:1px solid var(--line)">• ${esc(f.fact)}</div>`).join("")
    : `<div class="text-dim" style="font-size:12px">Nada aprendido todavía.</div>`;

  const timelineHtml = c.messages.length
    ? c.messages
        .map(
          (m) => `<div style="padding:6px 0;border-top:1px solid var(--line);font-size:12.5px">
          <span class="${m.role === "user" ? "text-cream" : "text-accent"}" style="font-size:10px;letter-spacing:.08em;text-transform:uppercase">${m.role === "user" ? "cliente" : m.role === "assistant" ? "bot" : esc(m.role)}</span>
          <div class="text-muted" style="white-space:pre-wrap;word-break:break-word">${esc(m.content.slice(0, 400))}${m.content.length > 400 ? "…" : ""}</div>
          <span class="text-dim" style="font-size:10px">${fmtDateTime(m.created_at)}</span>
        </div>`,
        )
        .join("")
    : `<div class="text-dim" style="font-size:12px">Sin mensajes.</div>`;

  const convsHtml = c.conversations
    .map(
      (cv) => `<a href="/admin/conversations?c=${encodeURIComponent(cv.id)}" class="text-accent" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;text-decoration:none;margin-right:14px">
      <i data-lucide="messages-square" width="13" height="13"></i> ${esc(cv.channel)} · ${fmtDateTime(cv.last_message_at)}
    </a>`,
    )
    .join("");

  const body = `
    <a href="/admin/clientes" class="text-muted" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;text-decoration:none;margin-bottom:14px">
      <i data-lucide="arrow-left" width="13" height="13"></i> Todos los clientes
    </a>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px">
      <div>
        <h2 class="font-display font-semibold text-[17px] text-cream">${esc(c.name)}</h2>
        <div class="text-muted" style="font-size:12.5px;margin-top:4px">${esc(c.contact) || ""} <span class="text-dim">· ${esc(c.channel_user_id)}</span></div>
        <div style="margin-top:8px">${c.conversations.map((cv) => channelChips(cv.channel)).join(" ")}</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="bg-panel rounded-xl" style="border:1px solid var(--line);padding:12px 16px;text-align:center">
          <div class="text-cream font-semibold" style="font-size:16px">${fmtBs(ltv)}</div>
          <div class="text-dim" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">LTV confirmado</div>
        </div>
        <div class="bg-panel rounded-xl" style="border:1px solid var(--line);padding:12px 16px;text-align:center">
          <div class="text-cream font-semibold" style="font-size:16px">${pend.length ? fmtBs(pend.reduce((s, p) => s + p.monto, 0)) : "—"}</div>
          <div class="text-dim" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">Pendiente (${pend.length})</div>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">
      ${section("Pipeline", leadsHtml)}
      ${section("Pagos", paymentsHtml)}
      ${section("Lo que el bot aprendió", factsHtml)}
      ${section("Conversaciones", convsHtml || `<div class="text-dim" style="font-size:12px">—</div>`)}
      ${section("Últimos mensajes", timelineHtml)}
    </div>`;
  return layout({ title: c.name, activeTab: "clientes", body, env, role });
}
