// Parser de correos de notificación de pago de bancos bolivianos. Cada banco
// tiene su formato; en lugar de un parser perfecto por banco, buscamos la
// firma común ("te transferieron / abono / recibiste" + monto en Bs/BOB) y
// detectamos el banco por nombre. Si el correo no huele a notificación de
// dinero entrante, devolvemos null y la conciliación lo ignora.

export interface BankPayment {
  /** Monto en bolivianos (el parser normaliza 1.250,50 y 1,250.50). */
  monto: number;
  /** Nombre del banco/wallet detectado (BCP, Mercantil, BNB, Simple...). */
  banco: string;
}

/** Bancos/wallets con QR interoperable que más notifican por correo. */
const BANKS = [
  "BCP",
  "Mercantil Santa Cruz",
  "Mercantil",
  "BNB",
  "Banco Unión",
  "BancoSol",
  "Banco Económico",
  "Bisa",
  "Gestión",
  "Simple",
  "Mach",
  "Tigo Money",
] as const;

export { parseMonto } from "../util/parse-monto";
import { parseMonto } from "../util/parse-monto";

/**
 * Intenta leer una notificación de pago entrante. `text` debe ser el cuerpo
 * (o el raw) del correo; `subject` ayuda cuando el monto viene solo en el
 * asunto (algunos bancos lo mandan ahí).
 */
export function parseBankPaymentEmail(input: {
  from?: string;
  subject?: string;
  text: string;
}): BankPayment | null {
  const haystack = `${input.subject ?? ""}\n${input.text}`;
  // Firma de "dinero entrante": abono/transferencia/recibiste/depósito/QR.
  const smellsLikePayment =
    /\b(abon|transferenc|recibiste|recibido|deposit[oó]|ingreso de dinero|cobraste|pag[oó] con QR)\w*/i.test(
      haystack,
    );
  if (!smellsLikePayment) return null;

  // El monto: preferimos el que va pegado a Bs/BOB; si no, el primer número
  // razonable del asunto. Descartamos números que claramente no son montos
  // (fechas, teléfonos largos, CIs).
  const withCurrency =
    haystack.match(/(?:Bs\.?|BOB)\s*([0-9][0-9.,\s]*[0-9])/i) ??
    haystack.match(/([0-9][0-9.,\s]*[0-9])\s*BOB/i);
  const monto = parseMonto(withCurrency ? withCurrency[0] : (input.subject ?? ""));
  if (monto == null) return null;

  const banco =
    BANKS.find((b) => {
      const re = new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      return re.test(`${input.from ?? ""} ${haystack}`);
    }) ?? "desconocido";

  return { monto, banco };
}
