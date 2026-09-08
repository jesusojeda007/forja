import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { GalleryRepo } from "../../src/db/gallery";

let db: Db;
let repo: GalleryRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  db = new Db((await mf.getD1Database("DB")) as any);
  repo = new GalleryRepo(db);
});

describe("GalleryRepo", () => {
  it("create + get + list", async () => {
    const id = await repo.create({
      kind: "image",
      label: "Menú",
      trigger: "cuando pregunten por la carta o el menú",
      r2Key: "galeria/abc",
      mime: "image/jpeg",
      sizeBytes: 1234,
      sourceUrl: "https://x/menu.jpg",
    });
    const got = await repo.get(id);
    expect(got?.label).toBe("Menú");
    expect(got?.kind).toBe("image");
    expect(got?.r2_key).toBe("galeria/abc");

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
  });

  it("delete quita la fila", async () => {
    const id = await repo.create({
      kind: "video",
      label: "Recorrido",
      trigger: "",
      r2Key: "galeria/v1",
      mime: "video/mp4",
      sizeBytes: 999,
    });
    expect(await repo.delete(id)).toBe(true);
    expect(await repo.get(id)).toBeNull();
    expect(await repo.delete(id)).toBe(false);
  });

  it("bestMatch: elige el item cuyo label/trigger comparte más palabras con la query", async () => {
    await repo.create({ kind: "image", label: "Menú", trigger: "carta, menú, platillos, comida", r2Key: "galeria/menu", mime: "image/jpeg", sizeBytes: 1 });
    await repo.create({ kind: "image", label: "Local", trigger: "fachada, dónde estamos, ubicación", r2Key: "galeria/local", mime: "image/jpeg", sizeBytes: 1 });

    const m1 = await repo.bestMatch("me mandas la carta del menú?");
    expect(m1?.label).toBe("Menú");

    const m2 = await repo.bestMatch("cómo es el local por fuera");
    expect(m2?.label).toBe("Local");
  });

  it("bestMatch: null si nada coincide", async () => {
    await repo.create({ kind: "image", label: "Menú", trigger: "carta, comida", r2Key: "galeria/menu", mime: "image/jpeg", sizeBytes: 1 });
    expect(await repo.bestMatch("cuánto cuesta el envío a otra ciudad")).toBeNull();
  });
});
