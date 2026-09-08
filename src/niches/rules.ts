import type { NichePack, NicheRule } from "./types";

/** Parsea el JSON de settings.store_rules a un mapa plano. Nunca truena. */
export function parseStoreRules(raw: string | undefined | null): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v == null) continue;
      out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

/** Valor legible por defecto: mapea el value de un select a su label. */
function humanValue(rule: NicheRule, value: string): string {
  if (rule.type === "select") {
    const opt = rule.options?.find((o) => o.value === value);
    return opt?.label ?? value;
  }
  if (rule.type === "toggle") return value === "si" ? "Sí" : "No";
  return value;
}

/**
 * Rinde el bloque <reglas_del_negocio> a partir del pack activo y los valores
 * guardados. Devuelve "" si el rubro no tiene reglas o ninguna está seteada.
 */
export function renderNicheRules(
  niche: NichePack,
  values: Record<string, string>,
): string {
  if (!niche.rules?.length) return "";

  const lines: string[] = [];
  for (const grp of niche.rules) {
    for (const rule of grp.rules) {
      const raw = (values[rule.key] ?? "").trim();
      if (!raw) continue;
      const line = rule.toPrompt
        ? rule.toPrompt(raw)
        : `${rule.label}: ${humanValue(rule, raw)}`;
      if (line && line.trim()) lines.push(`- ${line.trim()}`);
    }
  }
  if (!lines.length) return "";

  return `<reglas_del_negocio>
El cliente NO ve estas reglas — son la política del negocio. Aplícalas al
conversar, nunca las contradigas y nunca inventes una que no esté aquí. Si el
cliente pregunta algo que estas reglas no cubren, no adivines: escala con
handoffHuman.
${lines.join("\n")}
</reglas_del_negocio>`;
}
