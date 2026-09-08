import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("agents", () => ({ Agent: class {} }));

import worker from "../../src/index";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { GalleryRepo } from "../../src/db/gallery";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const TOKEN = "gal_secret";

let env: any;
let db: Db;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  env = {
    DB: d1,
    CATALOG: await mf.getR2Bucket("CATALOG"),
    DASHBOARD_BASE_URL: "https://bot.example",
    GALERIA_TOKEN: TOKEN,
    BOT_NAME: "B",
    BUSINESS_NAME: "N",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
  };
});

const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://test${path}`, init), env, {} as any);

describe("endpoints de galería (guardados por X-Galeria-Token)", () => {
  it("rechaza sin token", async () => {
    const res = await call("/galeria/manifest");
    expect(res.status).toBe(401);
  });

  it("POST /galeria/items descarga la URL y la guarda; manifest la lista", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PNG, { status: 200 })));
    const res = await call("/galeria/items", {
      method: "POST",
      headers: { "X-Galeria-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://tienda/menu.png", label: "Menú", trigger: "carta, menú" }),
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toBeTruthy();

    const man = await call("/galeria/manifest", { headers: { "X-Galeria-Token": TOKEN } });
    const body = (await man.json()) as { items: any[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].label).toBe("Menú");
  });

  it("GET /galeria/:id sirve la media SIN token (pública)", async () => {
    const id = await new GalleryRepo(db).create({
      kind: "image", label: "x", trigger: "", r2Key: "galeria/pub1", mime: "image/png", sizeBytes: 4,
    });
    await env.CATALOG.put("galeria/pub1", PNG, { httpMetadata: { contentType: "image/png" } });
    const res = await call(`/galeria/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("DELETE /galeria/items/:id quita la fila", async () => {
    const id = await new GalleryRepo(db).create({
      kind: "image", label: "x", trigger: "", r2Key: "galeria/d1", mime: "image/png", sizeBytes: 4,
    });
    const res = await call(`/galeria/items/${id}`, {
      method: "DELETE",
      headers: { "X-Galeria-Token": TOKEN },
    });
    expect(res.status).toBe(200);
    expect(await new GalleryRepo(db).get(id)).toBeNull();
  });
});
