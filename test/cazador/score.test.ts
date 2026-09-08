import { describe, it, expect } from "vitest";
import { scoreConversation, bandOf } from "../../src/cazador/score";

const base = { userTexts: [] as string[], hasLead: false, hasAppointment: false };

describe("bandOf", () => {
  it("mapea el puntaje a la banda", () => {
    expect(bandOf(0)).toBe("frio");
    expect(bandOf(24)).toBe("frio");
    expect(bandOf(25)).toBe("tibio");
    expect(bandOf(49)).toBe("tibio");
    expect(bandOf(50)).toBe("caliente");
    expect(bandOf(74)).toBe("caliente");
    expect(bandOf(75)).toBe("muy_caliente");
    expect(bandOf(100)).toBe("muy_caliente");
  });
});

describe("scoreConversation", () => {
  it("conversación vacía → 0, frío", () => {
    const r = scoreConversation(base);
    expect(r.score).toBe(0);
    expect(r.band).toBe("frio");
    expect(r.reason).toBe("");
  });

  it("cada señal suma y aparece en el reason", () => {
    expect(scoreConversation({ ...base, hasLead: true }).score).toBe(25);
    expect(scoreConversation({ ...base, hasAppointment: true }).score).toBe(30);
    expect(scoreConversation({ ...base, userTexts: ["¿cuánto cuesta el corte?"] }).score).toBe(15);
    expect(scoreConversation({ ...base, userTexts: ["lo quiero, ¿cómo pago?"] }).score).toBe(25);
    expect(scoreConversation({ ...base, userTexts: ["¿tienen disponible para hoy?"] }).score).toBe(15); // disponibilidad 10 + urgencia 5
  });

  it("4+ mensajes del cliente suman engagement", () => {
    const r = scoreConversation({ ...base, userTexts: ["a", "b", "c", "d"] });
    expect(r.score).toBeGreaterThanOrEqual(10);
    expect(r.reason.toLowerCase()).toContain("mensajes");
  });

  it("un lead que preguntó precio, dio intención y agendó → muy caliente", () => {
    const r = scoreConversation({
      userTexts: ["¿qué precio tiene?", "perfecto, lo quiero", "agéndame el martes"],
      hasLead: true,
      hasAppointment: true,
    });
    expect(r.band).toBe("muy_caliente");
    expect(r.score).toBe(95); // 25 lead + 30 cita + 15 precio + 25 intención
    expect(r.reason).toMatch(/precio/i);
    expect(r.reason).toMatch(/cit/i);
  });

  it("una pregunta informativa suelta se queda frío/tibio", () => {
    const r = scoreConversation({ ...base, userTexts: ["¿a qué hora abren?"] });
    expect(r.band).toBe("frio");
  });
});
