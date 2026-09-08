import type { Env } from "../../env";
import { layout } from "./layout";
import type { AdminRole } from "../auth";
import { computeRoi, type Roi } from "../../agencia/roi";
import { getNiche } from "../../niches";
import { channelLabel } from "../../channels/labels";

function money(n: number, currency: string): string {
  const s = n.toLocaleString("es", { maximumFractionDigits: n >= 100 ? 0 : 2 });
  return currency === "USD" || currency === "$" ? `$${s}` : `${s} ${currency}`;
}

function statCard(big: string, label: string, sub = ""): string {
  return `<div class="bg-panel border border-line" style="padding:16px 18px;border-radius:12px">
    <div class="font-display font-semibold text-cream" style="font-size:22px;line-height:1.1">${big}</div>
    <div class="text-muted text-[12px]" style="margin-top:3px">${label}</div>
    ${sub ? `<div class="text-dim text-[11px]" style="margin-top:2px">${sub}</div>` : ""}
  </div>`;
}

export async function renderRoi(env: Env, role: AdminRole = "owner"): Promise<string> {
  const roi: Roi = await computeRoi(env, { days: 30 });
  const niche = getNiche(env);
  const cur = roi.currency;

  const headline = `<section class="card bg-panel border border-line" style="padding:22px 20px;margin-bottom:16px">
    <div class="text-muted text-[12px]">Lo que tu bot te ahorró en los últimos 30 días</div>
    <div class="font-display font-bold text-cream" style="font-size:40px;line-height:1.05;margin:6px 0 4px">${money(roi.moneySaved, cur)}</div>
    <div class="text-dim text-[12px]">
      ${roi.hoursSaved} h de atención · ${money(roi.hourlyRate, cur)}/h
      ${roi.noShowMoney > 0 ? ` · ${money(roi.noShowMoney, cur)} en citas recuperadas` : ""}
    </div>
    ${
      roi.roiMultiple != null
        ? `<div style="margin-top:12px;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--accent);border-radius:999px;padding:5px 12px">
             <span class="font-display font-bold text-[13px]" style="color:var(--accent)">${roi.roiMultiple}×</span>
             <span class="text-muted text-[11.5px]">te cuesta ${money(roi.monthlyFee!, cur)}/mes · te devuelve ~${money(
               roi.moneySaved,
               cur,
             )}/mes</span>
           </div>`
        : ""
    }
  </section>`;

  const grid = `<section class="grid grid-cols-2 lg:grid-cols-4 gap-[12px]" style="margin-bottom:16px">
    ${statCard(String(roi.chats), "conversaciones atendidas")}
    ${statCard(String(roi.leads), niche.recordPlural.toLowerCase() + " nuevos")}
    ${statCard(`${roi.hoursSaved} h`, "tiempo ahorrado", money(roi.laborSaved, cur))}
    ${statCard(String(roi.noShowsRecovered), "no-shows recuperados", roi.noShowMoney > 0 ? money(roi.noShowMoney, cur) : "")}
  </section>`;

  const extra: string[] = [];
  if (roi.topChannel) extra.push(`Canal principal: <b class="text-cream">${channelLabel(roi.topChannel)}</b>`);
  if (roi.topTopics.length) extra.push(`Temas más frecuentes: <b class="text-cream">${roi.topTopics.join(", ")}</b>`);

  const context = `<section class="bg-panel border border-line" style="padding:16px 18px;border-radius:12px">
    ${extra.length ? `<div class="text-muted text-[12.5px]" style="margin-bottom:10px">${extra.join(" · ")}</div>` : ""}
    <p class="text-dim text-[11.5px] leading-relaxed" style="margin:0">
      Estimación. Las horas ahorradas se calculan como respuestas del bot × 2 min.
      ${
        role === "owner"
          ? `Ajusta el valor de la hora, la moneda y tu mensualidad en <a href="/admin/config" style="color:var(--accent)">Configuración</a>.`
          : ""
      }
    </p>
  </section>`;

  return layout({ title: "Retorno", activeTab: "roi", body: headline + grid + context, env, role });
}
