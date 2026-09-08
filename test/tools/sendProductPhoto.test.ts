import { describe, it, expect, vi } from "vitest";

vi.mock("../../member/config.local", () => ({
  catalog: [
    {
      name: "Licuadora Portátil",
      price: 69,
      description: "batidos donde quieras",
      stock: 1,
      image: "https://cdn.test/licuadora-portatil.jpg",
      url: "https://tienda.test/p/licuadora-portatil",
    },
    { name: "Set de Cuchillos", price: 49, description: "seis cuchillos" }, // sin foto
  ],
}));

const sent: any[] = [];
vi.mock("../../src/replies/sender", () => ({
  pickAdapter: () => ({
    sendImage: async (payload: any) => {
      sent.push(payload);
    },
  }),
}));

import { sendProductPhotoTool } from "../../src/tools/sendProductPhoto";

const run = (producto: string, opts: { noChannel?: boolean } = {}) =>
  sendProductPhotoTool(
    {} as any,
    () => (opts.noChannel ? null : "telegram"),
    () => (opts.noChannel ? null : "123"),
  ).execute!({ producto } as any, {} as any) as Promise<any>;

describe("sendProductPhotoTool", () => {
  it("envía la foto del producto con caption (nombre, precio, link)", async () => {
    sent.length = 0;
    const r = await run("licuadora portatil");
    expect(r.sent).toBe(true);
    expect(r.enviados).toEqual(["Licuadora Portátil"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://cdn.test/licuadora-portatil.jpg");
    expect(sent[0].caption).toContain("Licuadora Portátil");
    expect(sent[0].caption).toContain("Bs 69");
    expect(sent[0].caption).toContain("https://tienda.test/p/licuadora-portatil");
  });

  it("si el producto no tiene foto, devuelve el link en vez de mandar imagen", async () => {
    sent.length = 0;
    const r = await run("set de cuchillos");
    expect(r.sent).toBe(false);
    expect(sent).toHaveLength(0);
    expect(r.productos[0].link).toBeNull();
    expect(r.productos[0].nombre).toBe("Set de Cuchillos");
  });

  it("producto inexistente → sent:false sin enviar nada", async () => {
    sent.length = 0;
    const r = await run("bicicleta");
    expect(r.sent).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("sin canal activo → sent:false", async () => {
    const r = await run("licuadora", { noChannel: true });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("sin canal activo");
  });
});
