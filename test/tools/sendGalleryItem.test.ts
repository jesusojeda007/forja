import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendChannelMediaMock = vi.fn();
vi.mock("../../src/replies/sender", () => ({
  pickAdapter: () => ({ sendReply: vi.fn(), parseIncoming: vi.fn() }),
  sendChannelMedia: (...a: unknown[]) => sendChannelMediaMock(...a),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { GalleryRepo } from "../../src/db/gallery";
import { sendGalleryItemTool } from "../../src/tools/sendGalleryItem";

let env: any;
let repo: GalleryRepo;

beforeEach(async () => {
  sendChannelMediaMock.mockReset();
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  repo = new GalleryRepo(new Db(d1 as any));
  env = { DB: d1, DASHBOARD_BASE_URL: "https://bot.example" };
});

afterEach(() => vi.restoreAllMocks());

function tool() {
  return sendGalleryItemTool(
    env,
    () => "conv_1",
    () => "telegram",
    () => "u1",
  );
}

describe("sendGalleryItemTool", () => {
  it("manda el item que mejor coincide y devuelve su label + kind", async () => {
    const id = await repo.create({
      kind: "image", label: "Menú", trigger: "carta, menú, comida", r2Key: "galeria/" + "x", mime: "image/jpeg", sizeBytes: 1,
    });
    const r = (await tool().execute!({ query: "me pasas la carta del menú" }, {} as any)) as any;
    expect(r.sent).toBe(true);
    expect(r.label).toBe("Menú");
    expect(r.kind).toBe("image");
    const [, mediaReq] = sendChannelMediaMock.mock.calls[0] as any[];
    expect(mediaReq.url).toBe(`https://bot.example/galeria/${id}`);
    expect(mediaReq.kind).toBe("image");
    expect(mediaReq.channel).toBe("telegram");
  });

  it("sin coincidencia devuelve sent:false y NO manda nada", async () => {
    await repo.create({ kind: "image", label: "Menú", trigger: "carta", r2Key: "galeria/x", mime: "image/jpeg", sizeBytes: 1 });
    const r = (await tool().execute!({ query: "cuánto cuesta el envío a otra ciudad" }, {} as any)) as any;
    expect(r.sent).toBe(false);
    expect(sendChannelMediaMock).not.toHaveBeenCalled();
  });

  it("sin canal activo devuelve sent:false", async () => {
    await repo.create({ kind: "image", label: "Menú", trigger: "carta menú", r2Key: "galeria/x", mime: "image/jpeg", sizeBytes: 1 });
    const t = sendGalleryItemTool(env, () => "conv_1", () => null, () => null);
    const r = (await t.execute!({ query: "el menú" }, {} as any)) as any;
    expect(r.sent).toBe(false);
  });
});
