import { describe, it, expect } from "vitest";
import { getNiche } from "../src/niches";
import { systemPromptFromEnv } from "../src/system-prompt";
import { layout } from "../src/admin/views/layout";
import type { Env } from "../src/env";

const envWith = (niche: string) =>
  ({ BOT_NICHE: niche, BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es-MX" }) as unknown as Env;

// Tanda B — salud: clinica, dentista. Ambos agendan citas y NUNCA diagnostican.

const PACKS = [
  { id: "clinica", navLabel: "Pacientes", recordSingular: "Paciente" },
  { id: "dentista", navLabel: "Pacientes", recordSingular: "Paciente" },
] as const;

describe.each(PACKS)("pack $id", (p) => {
  it("resuelve por BOT_NICHE y re-etiqueta a Pacientes con pipeline de cita", () => {
    const n = getNiche(envWith(p.id));
    expect(n.id).toBe(p.id);
    expect(n.navLabel).toBe(p.navLabel);
    expect(n.recordSingular).toBe(p.recordSingular);
    expect(n.statusLabels.sold).toBe("Agendó");
    expect(n.statusLabels.lost).toBe("No agendó");
  });

  it("columnas del giro: motivo + fecha_cita", () => {
    const n = getNiche(envWith(p.id));
    expect(n.columns.map((c) => c.key)).toEqual(["motivo", "fecha_cita"]);
    for (const c of n.columns) expect(c.label.length).toBeGreaterThan(0);
  });

  it("playbook: agenda con scheduleAppointment y prohíbe diagnosticar", () => {
    const n = getNiche(envWith(p.id));
    expect(n.playbook).toContain("<niche_playbook>");
    expect(n.playbook).toContain("scheduleAppointment");
    expect(n.playbook.toLowerCase()).toContain("diagn");
    expect(n.playbook).toContain("handoffHuman");
    expect(n.defaultTone.length).toBeGreaterThan(0);
    expect(n.kbDocs.length).toBeGreaterThan(0);
  });

  it("inyecta su playbook al system prompt", () => {
    const env = envWith(p.id);
    const prompt = systemPromptFromEnv(env, ["searchKb", "scheduleAppointment"], "ctx", getNiche(env).playbook);
    expect(prompt).toContain("<niche_playbook>");
  });

  it("el nav del panel dice Pacientes", () => {
    const html = layout({ title: "T", activeTab: "leads", body: "x", env: envWith(p.id) });
    expect(html).toContain("Pacientes");
    expect(html).toContain('href="/admin/leads"');
  });
});

describe("clinica — urgencias", () => {
  it("el playbook deriva urgencias en vez de manejarlas por chat", () => {
    const n = getNiche(envWith("clinica"));
    expect(n.playbook.toLowerCase()).toContain("urgencia");
  });
});
