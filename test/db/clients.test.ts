import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { LeadsRepo } from "../../src/db/leads";
import { PaymentsRepo } from "../../src/db/payments";
import { ClientsRepo } from "../../src/db/clients";
import { renderClientes, renderCliente } from "../../src/admin/views/clientes";

let env: any;
let db: Db;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  env = { DB: d1, BOT_TIER: "pro", BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es-MX", BOT_NICHE: "tienda" };
});

async function seedMaria() {
  const convs = new ConversationsRepo(db);
  const leads = new LeadsRepo(db);
  const payments = new PaymentsRepo(db);
  const c1 = await convs.getOrCreate("whatsapp", "591700111222", "María");
  const leadId = await leads.create({
    conversationId: c1.id,
    channelUserId: null,
    name: "María López",
    contact: "591700111222",
    intent: "Quiere Corte + Barba",
  });
  await leads.setStatus(leadId, "sold");
  const pid = await payments.create({ conversationId: c1.id, leadId, monto: 400, referencia: "Corte+Barba" });
  await payments.markConfirmed(pid, "BCP test@bcp.com.bo — Aviso");
  await payments.create({ conversationId: c1.id, leadId: null, monto: 250, referencia: "Otro pedido" });
  await db.run("INSERT INTO customer_facts (conversation_id, fact, learned_at) VALUES (?, ?, ?)", [
    c1.id,
    "prefiere delivery",
    Date.now(),
  ]);
  return c1;
}

async function seedJuan() {
  const convs = new ConversationsRepo(db);
  const c = await convs.getOrCreate("telegram", "424242", "Juan");
  return c;
}

describe("ClientsRepo.list", () => {
  it("agrega por cliente: nombre del lead, LTV solo confirmado, pendientes aparte", async () => {
    await seedMaria();
    await seedJuan();
    const rows = await new ClientsRepo(db).list();
    expect(rows).toHaveLength(2);
    const maria = rows.find((r) => r.channel_user_id === "591700111222")!;
    expect(maria.name).toBe("María López");
    expect(maria.contact).toBe("591700111222");
    expect(maria.ltv).toBe(400); // solo el confirmado
    expect(maria.pending_count).toBe(1);
    expect(maria.pending_sum).toBe(250);
    expect(maria.pipeline).toBe("sold");
    expect(maria.leads_sold).toBe(1);
    expect(maria.channels).toContain("whatsapp");
    const juan = rows.find((r) => r.channel_user_id === "424242")!;
    expect(juan.name).toBe("Juan"); // display_name del canal, sin lead
    expect(juan.ltv).toBe(0);
  });

  it("busca por nombre y por teléfono", async () => {
    await seedMaria();
    const repo = new ClientsRepo(db);
    expect((await repo.list({ q: "maría" })).map((r) => r.channel_user_id)).toEqual(["591700111222"]);
    expect((await repo.list({ q: "591700111222" })).map((r) => r.name)).toEqual(["María López"]);
  });

  it("filtros: compraron / pendientes / sincomprar", async () => {
    await seedMaria();
    await seedJuan();
    const repo = new ClientsRepo(db);
    const compraron = await repo.list({ filter: "compraron" });
    expect(compraron.map((r) => r.channel_user_id)).toEqual(["591700111222"]);
    const pendientes = await repo.list({ filter: "pendientes" });
    expect(pendientes.map((r) => r.channel_user_id)).toEqual(["591700111222"]);
    const sincomprar = await repo.list({ filter: "sincomprar" });
    expect(sincomprar.map((r) => r.channel_user_id)).toEqual(["424242"]);
  });
});

describe("ClientsRepo.detail", () => {
  it("ficha 360: leads, pagos, hechos y mensajes de todas sus conversaciones", async () => {
    const c1 = await seedMaria();
    const d = await new ClientsRepo(db).detail("591700111222");
    expect(d!.name).toBe("María López");
    expect(d!.leads).toHaveLength(1);
    expect(d!.payments).toHaveLength(2);
    expect(d!.facts.map((f) => f.fact)).toContain("prefiere delivery");
    expect(d!.conversations[0].id).toBe(c1.id);
    // la vista ficha renderiza lo importante
    const html = await renderCliente(env, "591700111222");
    expect(html).toContain("María López");
    expect(html).toContain("Bs 400");
    expect(html).toContain("prefiere delivery");
    expect(html).toContain("Compró"); // statusLabel del niche tienda
  });

  it("identidad desconocida → null y la vista lo dice", async () => {
    expect(await new ClientsRepo(db).detail("nadie")).toBeNull();
    const html = await renderCliente(env, "nadie");
    expect(html).toContain("no encontrado");
  });
});

describe("vista lista de clientes", () => {
  it("renderiza tarjetas con LTV y estado del pipeline", async () => {
    await seedMaria();
    const html = await renderClientes(env, {});
    expect(html).toContain("Clientes");
    expect(html).toContain("María López");
    expect(html).toContain("Bs 400");
    expect(html).toContain("Compró");
  });
});
