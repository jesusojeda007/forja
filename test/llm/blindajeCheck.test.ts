import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

import { checkGrounding } from "../../src/llm/blindajeCheck";

const base = {
  model: { id: "haiku" } as any,
  reply: "El corte cuesta $150 y abrimos hasta las 8pm.",
  sources: "Servicios: corte $150, barba $100. Horario: Lun-Sáb 10am-8pm.",
  language: "es",
};

describe("checkGrounding", () => {
  beforeEach(() => generateTextMock.mockReset());

  it("respuesta apoyada en las fuentes → grounded true", async () => {
    generateTextMock.mockResolvedValue({ text: '{"grounded": true, "unsupported": []}' });
    const r = await checkGrounding(base);
    expect(r.grounded).toBe(true);
    expect(r.unsupported).toEqual([]);
  });

  it("respuesta con un dato inventado → grounded false + lista", async () => {
    generateTextMock.mockResolvedValue({
      text: '{"grounded": false, "unsupported": ["precio del tinte $500"]}',
    });
    const r = await checkGrounding({
      ...base,
      reply: "El corte es $150 y el tinte $500.",
    });
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toContain("precio del tinte $500");
  });

  it("tolera texto alrededor del JSON (```json ... ```)", async () => {
    generateTextMock.mockResolvedValue({
      text: 'Claro:\n```json\n{"grounded": false, "unsupported": ["x"]}\n```',
    });
    const r = await checkGrounding(base);
    expect(r.grounded).toBe(false);
  });

  it("fail-open: si el modelo tira, grounded true (nunca bloquea por su propio fallo)", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("503"));
    const r = await checkGrounding(base);
    expect(r.grounded).toBe(true);
    expect(r.unsupported).toEqual([]);
  });

  it("fail-open: si la salida no es JSON parseable, grounded true", async () => {
    generateTextMock.mockResolvedValue({ text: "no tengo idea" });
    const r = await checkGrounding(base);
    expect(r.grounded).toBe(true);
  });

  it("pasa las fuentes y la respuesta al prompt del verificador", async () => {
    generateTextMock.mockResolvedValue({ text: '{"grounded": true, "unsupported": []}' });
    await checkGrounding(base);
    const callArg = generateTextMock.mock.calls[0][0];
    const promptText = JSON.stringify(callArg);
    expect(promptText).toContain("corte $150");
    expect(promptText).toContain("abrimos hasta las 8pm");
  });
});
