import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { OrdersRepo, orderItems } from "../../src/db/orders";
import { registrarPedidoTool } from "../../src/tools/registrarPedido";
import { apartarProductoTool } from "../../src/tools/apartarProducto";
import { estadoPedidoTool } from "../../src/tools/estadoPedido";

let env: any;
let orders: OrdersRepo;
let convId: string;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  const db = new Db(d1 as any);
  orders = new OrdersRepo(db);
  convId = (await new ConversationsRepo(db).getOrCreate("telegram", "u1")).id;
  env = { DB: d1, BOT_TIER: "pro" };
});

describe("registrarPedido", () => {
  it("crea el pedido con código, total y estado pendiente", async () => {
    const tool = registrarPedidoTool(env, () => convId);
    const r = (await tool.execute!(
      {
        productos: [
          { nombre: "Licuadora", cantidad: 1, precio_unitario: 229 },
          { nombre: "Set de Cuchillos", cantidad: 2, precio_unitario: 49 },
        ],
        cliente: "Ana",
        contacto: "+59171234567",
        ciudad: "Santa Cruz",
        direccion: "Urbari, calle 4",
        zona_envio: "incluido",
      },
      {} as any,
    )) as { code: string; total: number; status: string };
    expect(r.code).toMatch(/^TS-\d{4}$/);
    expect(r.total).toBe(229 + 49 * 2);
    expect(r.status).toBe("pendiente");

    const list = await orders.list();
    expect(list).toHaveLength(1);
    expect(orderItems(list[0])).toHaveLength(2);
    expect(list[0].delivery_zone).toBe("incluido");
  });

  it("siempre crea el pedido como pendiente (sin reserva)", async () => {
    const tool = registrarPedidoTool(env, () => convId);
    const r = (await tool.execute!(
      { productos: [{ nombre: "Zapatero", cantidad: 1, precio_unitario: 149 }] },
      {} as any,
    )) as { status: string };
    expect(r.status).toBe("pendiente");
  });
});

describe("apartarProducto", () => {
  it("crea un pedido reservado con vencimiento", async () => {
    const tool = apartarProductoTool(env, () => convId);
    const r = (await tool.execute!(
      { producto: "Zapatero", cantidad: 1, precio_unitario: 149, horas: 8, cliente: "Ema" },
      {} as any,
    )) as { status: string; code: string };
    expect(r.status).toBe("reservado");
    const o = (await orders.list())[0];
    expect(o.status).toBe("reservado");
    expect(o.reserved_until).toBeGreaterThan(Date.now());
  });
});

describe("estadoPedido", () => {
  it("encuentra el pedido por código y por el último de la conversación", async () => {
    const { code } = await orders.create({
      conversationId: convId,
      items: [{ name: "Licuadora", qty: 1, price: 229 }],
      total: 229,
    });
    await orders.setStatus((await orders.byCode(code))!.id, "enviado");

    const tool = estadoPedidoTool(env, () => convId);
    const byCode = (await tool.execute!({ codigo: code }, {} as any)) as any;
    expect(byCode.found).toBe(true);
    expect(byCode.status).toBe("enviado");
    expect(byCode.status_texto).toContain("camino");

    const byConv = (await tool.execute!({}, {} as any)) as any;
    expect(byConv.code).toBe(code);
  });

  it("no inventa: si no hay pedido devuelve found:false", async () => {
    const tool = estadoPedidoTool(env, () => null);
    const r = (await tool.execute!({ codigo: "TS-9999" }, {} as any)) as any;
    expect(r.found).toBe(false);
  });
});
