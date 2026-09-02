import { describe, it, expect } from "vitest";
import { parseBankPaymentEmail, parseMonto } from "../../src/payments/email-parser";

describe("parseMonto", () => {
  it("formatos bolivianos comunes", () => {
    expect(parseMonto("Bs 400")).toBe(400);
    expect(parseMonto("Bs. 400")).toBe(400);
    expect(parseMonto("Bs 1.250,50")).toBe(1250.5);
    expect(parseMonto("Bs1,250.50")).toBe(1250.5);
    expect(parseMonto("400,00 BOB")).toBe(400);
    expect(parseMonto("Bs 400.50")).toBe(400.5);
    expect(parseMonto("Bs 1.250.000")).toBe(1250000); // miles, no decimales
  });

  it("basura → null", () => {
    expect(parseMonto("no hay números")).toBeNull();
  });
});

describe("parseBankPaymentEmail", () => {
  it("BCP: transferencia recibida", () => {
    const r = parseBankPaymentEmail({
      from: "notificaciones@bcp.com.bo",
      subject: "BCP te avisa",
      text: "Recibiste una transferencia por Bs 400,00 de MARIA LOPEZ. Banco de Crédito BCP.",
    });
    expect(r).toEqual({ monto: 400, banco: "BCP" });
  });

  it("Mercantil: abono con monto con miles", () => {
    const r = parseBankPaymentEmail({
      from: "no-reply@mercadantescruz.com",
      subject: "Notificación de abono",
      text: "Se registró un abono a su cuenta por Bs. 1.250,50. Mercantil Santa Cruz.",
    });
    expect(r?.monto).toBe(1250.5);
    expect(r?.banco).toContain("Mercantil");
  });

  it("monto solo en el asunto también alcanza", () => {
    const r = parseBankPaymentEmail({
      from: "avisos@banco.com",
      subject: "Recibiste Bs 90.00",
      text: "Ingresa a la app para ver el detalle.",
    });
    expect(r?.monto).toBe(90);
  });

  it("QR interoperable", () => {
    const r = parseBankPaymentEmail({
      text: "Pago con QR recibido: 250,00 BOB desde Banco Unión.",
    });
    expect(r?.monto).toBe(250);
  });

  it("un correo que no es de pago → null (no se concilia ni avisa)", () => {
    expect(
      parseBankPaymentEmail({
        from: "promo@banco.com",
        subject: "Promoción de verano",
        text: "Aprovecha tasas desde 8.9% este verano. El número 8.9 no es un pago.",
      }),
    ).toBeNull();
  });
});
