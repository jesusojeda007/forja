import { describe, it, expect } from "vitest";
import { getNiche } from "../src/niches";
import { systemPromptFromEnv } from "../src/system-prompt";
import { layout } from "../src/admin/views/layout";
import type { Env } from "../src/env";

const envWith = (niche: string) =>
  ({ BOT_NICHE: niche, BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es-MX" }) as unknown as Env;

// Tanda C — comida: restaurante, cafeteria, panaderia. Consultan el menú con
// catalogQuery. No agendan citas médicas: manejan reservas / pedidos.

const PACKS = [
  {
    id: "restaurante",
    navLabel: "Reservas",
    recordSingular: "Reserva",
    sold: "Confirmada",
    lost: "Cancelada",
    columns: ["personas", "fecha_reserva"],
  },
  {
    id: "cafeteria",
    navLabel: "Pedidos",
    recordSingular: "Pedido",
    sold: "Confirmado",
    lost: "Cancelado",
    columns: ["pedido", "hora_recoleccion"],
  },
  {
    id: "panaderia",
    navLabel: "Pedidos",
    recordSingular: "Pedido",
    sold: "Confirmado",
    lost: "Cancelado",
    columns: ["pedido", "fecha_entrega"],
  },
] as const;

describe.each(PACKS)("pack $id", (p) => {
  it("resuelve por BOT_NICHE con su re-etiquetado", () => {
    const n = getNiche(envWith(p.id));
    expect(n.id).toBe(p.id);
    expect(n.navLabel).toBe(p.navLabel);
    expect(n.recordSingular).toBe(p.recordSingular);
    expect(n.statusLabels.sold).toBe(p.sold);
    expect(n.statusLabels.lost).toBe(p.lost);
  });

  it("columnas del giro (viven en lead.metadata)", () => {
    const n = getNiche(envWith(p.id));
    expect(n.columns.map((c) => c.key)).toEqual([...p.columns]);
    for (const c of n.columns) expect(c.label.length).toBeGreaterThan(0);
  });

  it("playbook usa catalogQuery para el menú y prohíbe inventar", () => {
    const n = getNiche(envWith(p.id));
    expect(n.playbook).toContain("<niche_playbook>");
    expect(n.playbook).toContain("catalogQuery");
    expect(n.playbook).toContain("handoffHuman");
    expect(n.playbook.toLowerCase()).toContain("invent");
    expect(n.defaultTone.length).toBeGreaterThan(0);
    expect(n.kbDocs.length).toBeGreaterThan(0);
  });

  it("inyecta su playbook al system prompt", () => {
    const env = envWith(p.id);
    const prompt = systemPromptFromEnv(env, ["searchKb", "catalogQuery"], "ctx", getNiche(env).playbook);
    expect(prompt).toContain("<niche_playbook>");
  });

  it("el nav del panel muestra su etiqueta", () => {
    const html = layout({ title: "T", activeTab: "leads", body: "x", env: envWith(p.id) });
    expect(html).toContain(p.navLabel);
    expect(html).toContain('href="/admin/leads"');
  });
});

describe("restaurante — reservas", () => {
  it("el playbook agenda reservas con scheduleAppointment", () => {
    expect(getNiche(envWith("restaurante")).playbook).toContain("scheduleAppointment");
  });
});
