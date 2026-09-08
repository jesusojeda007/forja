import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { loadCatalog, normalizeSource, parseCsvCatalog } from "../../src/catalog/source";
import { catalogQueryTool } from "../../src/tools/catalogQuery";

describe("normalizeSource", () => {
  it("Shopify products.json: título, precio de variante, handle → URL", () => {
    const items = normalizeSource(
      JSON.stringify({
        products: [
          {
            title: "Concha",
            handle: "concha",
            body_html: "<p>Pan dulce clásico</p>",
            variants: [{ price: "25.00", sku: "PD-01" }],
          },
        ],
      }),
      "https://pan.shop/products.json",
    );
    expect(items).toEqual([
      { name: "Concha", price: 25, description: "Pan dulce clásico", sku: "PD-01", url: "https://pan.shop/products/concha" },
    ]);
  });

  it("WooCommerce store API: precios en unidades menores", () => {
    const items = normalizeSource(
      JSON.stringify([
        {
          name: "Mate imperial",
          prices: { price: "45000", currency_minor_unit: 2 },
          description: "<p>Calabaza</p>",
          permalink: "https://t.local/mate",
        },
      ]),
      "https://t.local/wp-json/wc/store/products",
    );
    expect(items[0].price).toBe(450);
    expect(items[0].url).toBe("https://t.local/mate");
  });

  it("JSON genérico con precio hispano", () => {
    const items = normalizeSource(
      JSON.stringify([{ nombre: "Empanada", precio: "1.250,50" }]),
      "https://x.local/catalogo.json",
    );
    expect(items[0].price).toBe(1250.5);
  });

  it("CSV con comillas y comas dentro de campos", () => {
    const items = parseCsvCatalog(
      'nombre,precio,descripción\n"Tornillo, con arandela","1.250,50",resistente\nClavo,10,\n',
    );
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Tornillo, con arandela");
    expect(items[0].price).toBe(1250.5);
    expect(items[1].price).toBe(10);
  });

  it("basura → vacío (la tool responde sin matches, no explota)", () => {
    expect(normalizeSource("<html>404</html>", "https://x.local")).toEqual([]);
  });

  it("endpoint custom { success, data: [...] } estilo Tamy Store: nombre/precio/codigo/stock, URL relativa → absoluta", () => {
    const items = normalizeSource(
      JSON.stringify({
        success: true,
        data: [
          {
            nombre: "Neceser",
            precio: 49,
            precio_descuento: null,
            descripcion: "Neceser elegante",
            codigo: "NEC-001",
            stock: 3,
            url: "/p/neceser-7cfb7a54",
          },
          { nombre: "Agotado", precio: 20, codigo: "AG-1", stock: 0, url: "/p/agotado" },
        ],
      }),
      "https://tammy-store.vercel.app/api/products",
    );
    expect(items).toEqual([
      {
        name: "Neceser",
        price: 49,
        description: "Neceser elegante",
        sku: "NEC-001",
        url: "https://tammy-store.vercel.app/p/neceser-7cfb7a54",
        stock: 3,
      },
      {
        name: "Agotado",
        price: 20,
        description: undefined,
        sku: "AG-1",
        url: "https://tammy-store.vercel.app/p/agotado",
        stock: 0,
      },
    ]);
  });

  it("mapea la foto del producto (imagen absoluta o relativa → absoluta)", () => {
    const items = normalizeSource(
      JSON.stringify({
        data: [
          { nombre: "Con foto CDN", precio: 10, imagen: "https://cdn.test/a.jpg" },
          { nombre: "Foto relativa", precio: 20, imagen: "/img/b.jpg" },
          { nombre: "Sin foto", precio: 30 },
        ],
      }),
      "https://tienda.test/api/products",
    );
    expect(items[0].image).toBe("https://cdn.test/a.jpg");
    expect(items[1].image).toBe("https://tienda.test/img/b.jpg");
    expect(items[2].image).toBeUndefined();
  });

  it("precio_descuento válido gana sobre el precio de lista", () => {
    const items = normalizeSource(
      JSON.stringify({ data: [{ nombre: "Oferta", precio: 100, precio_descuento: 79 }] }),
      "https://x.local/api",
    );
    expect(items[0].price).toBe(79);
  });

  it("{ items: [...] } también se desenvuelve", () => {
    const items = normalizeSource(
      JSON.stringify({ items: [{ name: "X", price: "10" }] }),
      "https://x.local/feed",
    );
    expect(items[0]).toMatchObject({ name: "X", price: 10 });
  });
});

describe("loadCatalog (integración con D1 + fetch)", () => {
  let env: any;
  let settings: SettingsRepo;
  let d1: any;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let responses: string[];

  beforeEach(async () => {
    const mf = await createTestMiniflare();
    d1 = await mf.getD1Database("DB");
    settings = new SettingsRepo(new Db(d1 as any));
    env = { DB: d1, BOT_TIER: "pro" };
    responses = [];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const body = responses.shift() ?? "[]";
      return new Response(body, { status: 200 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const shopify = (name: string, price: string) =>
    JSON.stringify({ products: [{ title: name, handle: "h", variants: [{ price }] }] });

  it("sin URL configurada usa el catálogo local (seed del starter), sin fetch", async () => {
    const { catalog: localSeed } = await import("../../member/config.local");
    expect(await loadCatalog(env)).toEqual(localSeed);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("URL configurada: normaliza y cachea (segunda llamada no re-fetch)", async () => {
    await settings.set(SETTING_KEYS.catalogSourceUrl, "https://pan.shop/products.json");
    responses.push(shopify("Concha", "25.00"));
    const first = await loadCatalog(env);
    expect(first[0].name).toBe("Concha");
    responses.push(shopify("Otro", "99.00")); // si re-fetcheara, devolvería esto
    const second = await loadCatalog(env);
    expect(second[0].name).toBe("Concha");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("TTL vencido: refresca", async () => {
    await settings.set(SETTING_KEYS.catalogSourceUrl, "https://pan.shop/products.json");
    responses.push(shopify("Concha", "25.00"));
    await loadCatalog(env);
    await d1.exec(`UPDATE catalog_cache SET fetched_at = ${Date.now() - 2 * 3600 * 1000}`);
    responses.push(shopify("Cuñape", "8.00"));
    const items = await loadCatalog(env);
    expect(items[0].name).toBe("Cuñape");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("fuente cae: responde con el snapshot viejo", async () => {
    await settings.set(SETTING_KEYS.catalogSourceUrl, "https://pan.shop/products.json");
    responses.push(shopify("Concha", "25.00"));
    await loadCatalog(env);
    await d1.exec(`UPDATE catalog_cache SET fetched_at = ${Date.now() - 2 * 3600 * 1000}`);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const items = await loadCatalog(env);
    expect(items[0].name).toBe("Concha");
  });

  it("la tool catalogQuery encuentra productos que vienen de la URL", async () => {
    await settings.set(SETTING_KEYS.catalogSourceUrl, "https://pan.shop/products.json");
    responses.push(shopify("Concha", "25.00"));
    const tool = catalogQueryTool(env);
    const r = (await tool.execute!({ query: "concha" }, {} as any)) as any;
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].price).toBe(25);
  });
});
