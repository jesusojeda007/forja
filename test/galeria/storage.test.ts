import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { GalleryRepo } from "../../src/db/gallery";
import { sniffMediaType, ingestFromUrl, serveGalleryItem } from "../../src/galeria/storage";

// bytes de cabecera reales por tipo
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]); // "ID3"
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // ....ftypisom

let env: any;
let db: Db;
let repo: GalleryRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  repo = new GalleryRepo(db);
  env = { DB: d1, CATALOG: await mf.getR2Bucket("CATALOG"), DASHBOARD_BASE_URL: "https://bot.example" };
});

afterEach(() => vi.restoreAllMocks());

describe("sniffMediaType", () => {
  it("reconoce imagen, audio y video por magic bytes", () => {
    expect(sniffMediaType(PNG)?.kind).toBe("image");
    expect(sniffMediaType(JPEG)?.kind).toBe("image");
    expect(sniffMediaType(MP3)?.kind).toBe("audio");
    expect(sniffMediaType(MP4)?.kind).toBe("video");
  });

  it("rechaza lo que no es media", () => {
    expect(sniffMediaType(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBeNull(); // "<html"
  });
});

describe("ingestFromUrl", () => {
  it("baja la URL, guarda en R2 y crea la fila", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })),
    );
    const { id } = await ingestFromUrl(env, {
      url: "https://tienda.example/menu.png",
      label: "Menú",
      trigger: "carta, menú, platillos",
    });
    const row = await repo.get(id);
    expect(row?.kind).toBe("image");
    expect(row?.mime).toBe("image/png");
    expect(row?.r2_key).toBe(`galeria/${id}`);
    expect(row?.source_url).toBe("https://tienda.example/menu.png");
    const obj = await env.CATALOG.get(`galeria/${id}`);
    expect(obj).toBeTruthy();
  });

  it("rechaza si la descarga no es media válida", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(
      ingestFromUrl(env, { url: "https://x/pagina.html", label: "x", trigger: "" }),
    ).rejects.toThrow(/no.*media|no es/i);
  });

  it("rechaza si la URL falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(
      ingestFromUrl(env, { url: "https://x/404.jpg", label: "x", trigger: "" }),
    ).rejects.toThrow(/404|no pude/i);
  });
});

describe("serveGalleryItem", () => {
  it("sirve los bytes guardados con su content-type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JPEG, { status: 200 })));
    const { id } = await ingestFromUrl(env, { url: "https://x/f.jpg", label: "Foto", trigger: "" });
    const res = await serveGalleryItem(env, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("404 si el item no existe", async () => {
    const res = await serveGalleryItem(env, "no-existe");
    expect(res.status).toBe(404);
  });
});
