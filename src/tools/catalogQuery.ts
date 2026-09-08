import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { loadCatalog, type CatalogItem } from "../catalog/source";

/** minúsculas + sin acentos, para comparar sin depender de tildes. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Palabras que no aportan a la búsqueda de un producto.
const STOPWORDS = new Set([
  "que", "cual", "cuales", "tienen", "tiene", "hay", "precio", "cuesta", "cuestan",
  "sale", "salen", "vale", "valen", "cuanto", "cuanta", "para", "con", "los", "las",
  "una", "uno", "del", "por", "hola", "buenas", "quiero", "necesito", "busco", "info",
  "informacion", "disponible", "disponibles", "stock", "sobre", "algun", "alguna",
  "foto", "fotos", "imagen", "imagenes", "manda", "mandame", "pasame", "envia", "enviame",
  "ver", "muestra", "muestrame",
]);

/** "licuadoras" → "licuadora", "cuchillos" → "cuchillo". Plural español simple. */
function singularize(w: string): string {
  if (w.length > 4 && /(es)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Tokens útiles de la consulta (sin stopwords, sin plural, ≥3 chars). */
function queryTokens(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of fold(query).split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(singularize(raw));
  }
  return [...seen];
}

/** Puntaje de un producto contra los tokens (0 = no matchea). */
function score(item: CatalogItem, tokens: string[], rawQuery: string): number {
  const name = fold(item.name);
  const hay = fold(
    [item.name, item.description, item.sku, item.category, item.features, item.includes, item.colors]
      .filter(Boolean)
      .join(" "),
  );
  if (rawQuery && name.includes(rawQuery)) return 100; // match exacto de frase en el nombre
  let s = 0;
  for (const t of tokens) {
    if (name.includes(t)) s += 10;
    else if (hay.includes(t)) s += 3;
  }
  return s;
}

/** Rankea el catálogo contra una consulta libre. Devuelve los mejores primero. */
export function rankCatalog(catalog: CatalogItem[], query: string, limit = 5): CatalogItem[] {
  const raw = fold(query).trim();
  const tokens = queryTokens(query);
  return catalog
    .map((p) => ({ p, s: score(p, tokens, raw) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}

export function catalogQueryTool(env: Env) {
  return tool({
    description:
      "Busca productos en el catálogo del negocio por nombre o palabra clave (tolera plural y acentos). " +
      "Devuelve hasta 5 coincidencias con precio, link del producto y, si la fuente lo trae, foto, stock " +
      "(unidades; 0 = agotado), características, qué incluye y colores. " +
      "Usá esos campos para responder specs (potencia, medidas, material, color) — no inventes lo que no venga ahí. " +
      "Si no devuelve nada, probá con una palabra más corta o un sinónimo antes de escalar.",
    inputSchema: z.object({
      query: z.string().min(1),
    }),
    execute: async ({ query }) => {
      const catalog = await loadCatalog(env);
      return { matches: rankCatalog(catalog, query), total: catalog.length };
    },
  });
}
