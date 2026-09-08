import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { parseMonto } from "../util/parse-monto";
import { catalog as localCatalogItems } from "../../member/config.local";

export interface CatalogItem {
  name: string;
  price: number;
  description?: string;
  sku?: string;
  url?: string;
  /** Foto principal del producto (URL absoluta), si la fuente la trae. */
  image?: string;
  /** Unidades disponibles, si la fuente las trae. El bot decide si las menciona. */
  stock?: number;
  /** Ficha técnica / características, si la fuente las trae. */
  features?: string;
  /** Qué incluye el producto (accesorios, piezas). */
  includes?: string;
  /** Colores disponibles, separados por coma. */
  colors?: string;
  /** Categoría / rubro del producto en la tienda. */
  category?: string;
}

/** Refresco lazy: TTL de 1h. El bot responde con snapshot si la fuente cae. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_ITEMS = 1000;

/**
 * Resuelve el catálogo del negocio con prioridad descendente:
 * 1. URL configurada (Shopify products.json, WooCommerce store API, CSV de
 *    Google Sheets) — snapshot cacheado en D1, refrescado si está viejo.
 * 2. El array de member/config.local.ts (seed del starter).
 * Nunca lanza: si la URL falla usa el snapshot viejo; si no hay ni DB ni URL,
 * el catálogo local. Un catálogo roto no debe tumbar la conversación.
 */
export async function loadCatalog(env: Env): Promise<CatalogItem[]> {
  let sourceUrl = "";
  try {
    const settings = await new SettingsRepo(new Db(env.DB)).all();
    sourceUrl = (settings[SETTING_KEYS.catalogSourceUrl] ?? "").trim();
  } catch {
    return localCatalog();
  }
  if (!/^https:\/\//i.test(sourceUrl)) return localCatalog();

  const db = new Db(env.DB);
  let cached: { source_url: string; items_json: string; fetched_at: number } | null = null;
  try {
    cached = await db.first("SELECT source_url, items_json, fetched_at FROM catalog_cache WHERE id = 1");
  } catch {
    cached = null;
  }
  if (cached && cached.source_url === sourceUrl && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return fromCache(cached.items_json);
  }

  try {
    const res = await fetch(sourceUrl, {
      headers: { "user-agent": "forja-catalog/1.0", accept: "application/json,text/csv,text/plain;q=0.8" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = normalizeSource(await res.text(), sourceUrl).slice(0, MAX_ITEMS);
    if (items.length === 0) throw new Error("la fuente no rindió productos");
    await db.run(
      `INSERT INTO catalog_cache (id, source_url, items_json, fetched_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET source_url = excluded.source_url, items_json = excluded.items_json, fetched_at = excluded.fetched_at`,
      [sourceUrl, JSON.stringify(items), Date.now()],
    );
    return items;
  } catch (e) {
    console.error("[catalog] no pude refrescar la fuente, uso snapshot/local:", e);
    if (cached) return fromCache(cached.items_json);
    return localCatalog();
  }
}

function fromCache(itemsJson: string): CatalogItem[] {
  try {
    const items = JSON.parse(itemsJson);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function localCatalog(): CatalogItem[] {
  return Array.isArray(localCatalogItems) ? localCatalogItems : [];
}

/** Detecta el formato de la fuente y normaliza a CatalogItem[]. */
export function normalizeSource(text: string, sourceUrl: string): CatalogItem[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        if (Array.isArray(json.products)) return normalizeShopify(json.products, sourceUrl);
        // Endpoints custom que envuelven la lista: { success, data: [...] },
        // { items: [...] }, { results: [...] }.
        const wrapped = json.data ?? json.items ?? json.results;
        if (Array.isArray(wrapped)) return normalizeGeneric(wrapped, sourceUrl);
      }
      if (Array.isArray(json)) {
        if (json.some((it) => it && typeof it === "object" && it.prices)) {
          return normalizeWoo(json);
        }
        return normalizeGeneric(json, sourceUrl);
      }
    } catch {
      // JSON roto: cae a CSV por si acaso
    }
  }
  return parseCsvCatalog(trimmed);
}

/** Shopify: GET /products.json → { products: [{ title, handle, variants: [{price, sku}] }] } */
function normalizeShopify(products: any[], sourceUrl: string): CatalogItem[] {
  let origin = "";
  try {
    origin = new URL(sourceUrl).origin;
  } catch {
    origin = "";
  }
  return products
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const v = Array.isArray(p.variants) ? p.variants[0] : null;
      return {
        name: String(p.title ?? "").trim(),
        price: parseMonto(String(v?.price ?? "")) ?? 0,
        description: stripHtml(p.body_html),
        sku: v?.sku ? String(v.sku) : undefined,
        url: origin && p.handle ? `${origin}/products/${p.handle}` : undefined,
        image: p.image?.src
          ? String(p.image.src)
          : Array.isArray(p.images) && p.images[0]?.src
            ? String(p.images[0].src)
            : undefined,
      };
    })
    .filter((it) => it.name && it.price > 0);
}

/** WooCommerce Store API: [{ name, prices: { price, currency_minor_unit }, permalink }] */
function normalizeWoo(items: any[]): CatalogItem[] {
  return items
    .filter((it) => it && typeof it === "object")
    .map((it) => {
      const minor = Number(it.prices?.currency_minor_unit ?? 2);
      const raw = Number(it.prices?.price ?? 0) / Math.pow(10, Number.isFinite(minor) ? minor : 2);
      return {
        name: String(it.name ?? "").trim(),
        price: Number.isFinite(raw) ? raw : 0,
        description: stripHtml(it.description),
        sku: it.sku ? String(it.sku) : undefined,
        url: it.permalink ? String(it.permalink) : undefined,
      };
    })
    .filter((it) => it.name && it.price > 0);
}

/**
 * Array JSON genérico: name/title/nombre/producto, price/precio/amount,
 * description/descripcion, sku/codigo, url/link/enlace (relativas → absolutas
 * con el origin de la fuente), stock/existencia.
 */
function normalizeGeneric(items: any[], sourceUrl = ""): CatalogItem[] {
  let origin = "";
  try {
    origin = sourceUrl ? new URL(sourceUrl).origin : "";
  } catch {
    origin = "";
  }
  return items
    .filter((it) => it && typeof it === "object")
    .map((it) => {
      const abs = (raw: unknown): string | undefined => {
        if (!raw) return undefined;
        const s = String(raw).trim();
        if (!s) return undefined;
        return s.startsWith("/") && origin ? origin + s : s;
      };
      const url = abs(it.url ?? it.link ?? it.enlace);
      const rawImg =
        it.imagen ?? it.image ?? it.img ?? it.foto ?? it.photo ?? it.picture ??
        (Array.isArray(it.imagenes) ? it.imagenes[0] : undefined) ??
        (Array.isArray(it.images) ? it.images[0] : undefined);
      const image = abs(typeof rawImg === "object" && rawImg ? rawImg.src ?? rawImg.url : rawImg);
      const rawStock = it.stock ?? it.existencia ?? it.disponibles;
      const stock = rawStock != null && Number.isFinite(Number(rawStock)) ? Number(rawStock) : undefined;
      const rawSku = it.sku ?? it.codigo ?? it["código"] ?? it.code;
      const str = (v: unknown): string | undefined => {
        if (v == null) return undefined;
        const s = Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v);
        return s.trim() || undefined;
      };
      return {
        name: String(it.name ?? it.title ?? it.nombre ?? it.producto ?? "").trim(),
        // precio_descuento gana si viene y es válido (> 0).
        price:
          (parseMonto(String(it.precio_descuento ?? "")) || 0) ||
          (parseMonto(String(it.price ?? it.precio ?? it.amount ?? "")) ?? 0),
        description:
          it.description ?? it.descripcion ? String(it.description ?? it.descripcion) : undefined,
        sku: rawSku ? String(rawSku) : undefined,
        url,
        image,
        stock,
        features: str(it.caracteristicas ?? it["características"] ?? it.features ?? it.specs),
        includes: str(it.incluye ?? it.includes),
        colors: str(it.colores ?? it.colors),
        category: str(it.categoria ?? it["categoría"] ?? it.category),
      };
    })
    .filter((it) => it.name && it.price > 0);
}

/**
 * CSV (Google Sheets publicado, exportes de Excel). Primera fila = encabezados.
 * Mapea columnas por nombre común en español/inglés. Requiere nombre + precio.
 */
export function parseCsvCatalog(csv: string): CatalogItem[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const iName = col("nombre", "name", "title", "producto");
  const iPrice = col("precio", "price");
  const iDesc = col("descripci", "description");
  const iSku = col("sku", "código", "codigo");
  const iUrl = col("url", "link", "enlace");
  if (iName < 0 || iPrice < 0) return [];
  const out: CatalogItem[] = [];
  for (const row of rows.slice(1)) {
    const name = (row[iName] ?? "").trim();
    const price = parseMonto(row[iPrice] ?? "") ?? 0;
    if (!name || price <= 0) continue;
    out.push({
      name,
      price,
      description: iDesc >= 0 && row[iDesc]?.trim() ? row[iDesc].trim() : undefined,
      sku: iSku >= 0 && row[iSku]?.trim() ? row[iSku].trim() : undefined,
      url: iUrl >= 0 && row[iUrl]?.trim() ? row[iUrl].trim() : undefined,
    });
  }
  return out;
}

/** CSV mínimo RFC-4180: comillas dobles, comas dentro de comillas, saltos. */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function stripHtml(html: unknown): string | undefined {
  if (typeof html !== "string" || !html.trim()) return undefined;
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim() || undefined;
}
