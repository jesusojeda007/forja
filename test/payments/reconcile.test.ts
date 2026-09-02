import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { PaymentsRepo } from "../../src/db/payments";
import { LeadsRepo } from "../../src/db/leads";
import { ConversationsRepo } from "../../src/db/conversations";
import { handlePaymentEmail } from "../../src/payments/reconcile";

let env: any;
let payments: PaymentsRepo;
let leads: LeadsRepo;
let convId: string;
let leadId: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  const db = new Db(d1 as any);
  payments = new PaymentsRepo(db);
  leads = new LeadsRepo(db);
  const conv = await new ConversationsRepo(db).getOrCreate("telegram", "u1");
  convId = conv.id;
  leadId = await leads.create({
    conversationId: convId,
    channelUserId: null,
    intent: "Corte + Barba",
  });
  env = {
    DB: d1,
    BOT_TIER: "pro",
    TELEGRAM_BOT_TOKEN: "tok",
    OWNER_TELEGRAM_CHAT_ID: "999",
    DASHBOARD_BASE_URL: "https://bot.test",
  };
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const bankEmail = (monto: string, subject = "Aviso de abono") => ({
  from: "notificaciones@bcp.com.bo",
  to: "pagos@bot.test",
  subject,
  text: `Recibiste una transferencia por Bs ${monto} de MARIA LOPEZ. BCP.`,
});

describe("handlePaymentEmail", () => {
  it("match único: confirma el pago y marca el lead como vendido", async () => {
    await payments.create({ conversationId: convId, leadId, monto: 400, referencia: "Corte+Barba" });
    const r = await handlePaymentEmail(env, bankEmail("400,00"));
    expect(r.resultado).toBe("confirmado");
    expect((await leads.list(10))[0].status).toBe("sold");
    // aviso al dueño por Telegram
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("sendMessage");
  });

  it("montos ambiguos: no confirma nada y avisa al dueño", async () => {
    await payments.create({ conversationId: convId, leadId, monto: 400 });
    await payments.create({ conversationId: convId, leadId: null, monto: 400 });
    const r = await handlePaymentEmail(env, bankEmail("400,00"));
    expect(r.resultado).toBe("ambiguo");
    expect((await payments.listPending(48 * 3600 * 1000)).every((p) => p.status === "pendiente")).toBe(true);
  });

  it("sin pedido pendiente que coincida: sin_match + aviso", async () => {
    const r = await handlePaymentEmail(env, bankEmail("700"));
    expect(r.resultado).toBe("sin_match");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("correo que no es de pago → ignorado, sin aviso", async () => {
    const r = await handlePaymentEmail(env, {
      from: "promo@banco.com",
      to: "pagos@bot.test",
      subject: "Promoción",
      text: "Tasas bajas este verano.",
    });
    expect(r.resultado).toBe("ignorado");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("el mismo correo no concilia dos veces (dedupe)", async () => {
    await payments.create({ conversationId: convId, leadId, monto: 400 });
    await handlePaymentEmail(env, bankEmail("400,00"));
    const r2 = await handlePaymentEmail(env, bankEmail("400,00"));
    expect(r2.resultado).toBe("duplicado");
    // y el lead sigue vendido, no pasa nada raro
    expect((await leads.list(10))[0].status).toBe("sold");
  });

  it("pagos fuera de la ventana no matchean", async () => {
    const id = await payments.create({ conversationId: convId, leadId, monto: 400 });
    // envejece el pago más allá de la ventana editando created_at
    const d1 = env.DB;
    await d1.exec(`UPDATE payments SET created_at = ${Date.now() - 96 * 3600 * 1000} WHERE id = '${id}'`);
    const r = await handlePaymentEmail(env, bankEmail("400,00"));
    expect(r.resultado).toBe("sin_match");
  });
});
