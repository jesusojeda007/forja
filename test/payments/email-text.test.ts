import { describe, it, expect } from "vitest";
import { extractEmailText, decodeMimeWords } from "../../src/payments/email-text";

describe("extractEmailText", () => {
  it("texto plano sin codificación pasa tal cual", () => {
    const raw = "From: bcp@bcp.com.bo\r\nSubject: Aviso\r\n\r\nRecibiste Bs 400,00.";
    expect(extractEmailText(raw)).toContain("Recibiste Bs 400,00.");
  });

  it("quoted-printable: =XX y soft breaks se decodifican (UTF-8 incluido)", () => {
    const raw =
      "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" +
      "Monto: Bs 1=C2=A0000,50=\r\n gracias.";
    const out = extractEmailText(raw);
    expect(out).toContain("Bs 1 000,50"); // =C2=A0 decodifica a NBSP
    expect(out).toContain("gracias");
  });

  it("base64 utf-8 se decodifica", () => {
    // "Recibiste Bs 250" en base64
    const b64 = btoa("Recibiste Bs 250");
    const raw = `Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}`;
    expect(extractEmailText(raw)).toBe("Recibiste Bs 250");
  });

  it("multipart: elige text/plain y decodifica su CTE", () => {
    const b64 = btoa("Abono por Bs 1.250,50");
    const raw = [
      "From: notificaciones@bnb.com.bo",
      'Content-Type: multipart/alternative; boundary="XYZ"',
      "",
      "--XYZ",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64,
      "--XYZ",
      "Content-Type: text/html",
      "",
      "<p>Abono por <b>Bs 1.250,50</b></p>",
      "--XYZ--",
    ].join("\r\n");
    expect(extractEmailText(raw)).toContain("Bs 1.250,50");
  });

  it("si solo hay html, tira de él y saca el texto", () => {
    const raw = [
      "Content-Type: text/html",
      "",
      "<p>Dep&oacute;sito de <b>Bs 90</b> recibido</p>",
    ].join("\r\n");
    const out = extractEmailText(raw);
    expect(out).toContain("Depósito");
    expect(out).toContain("Bs 90");
  });

  it("decodeMimeWords con base64 y qp", () => {
    expect(decodeMimeWords("=?UTF-8?B?QXZpc28=?=")).toBe("Aviso");
    expect(decodeMimeWords("=?UTF-8?Q?Aviso_de_abono?=")).toBe("Aviso de abono");
  });
});
