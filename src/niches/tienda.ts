import type { NichePack } from "./types";

// Pack Tienda / e-commerce: el bot es asesor de venta, no mesa de soporte.
// Re-etiqueta "Leads" como "Interesados", el pipeline habla de compras y el
// panel nace sin la pestaña de tickets (una tienda no lleva mesa de soporte).
// Las columnas extra viven en lead.metadata: captureLead las llena si el
// cliente menciona el producto y el monto aproximado de su interés.
export const tienda: NichePack = {
  id: "tienda",
  recordSingular: "Interesado",
  recordPlural: "Interesados",
  navLabel: "Interesados",
  navIcon: "shopping-bag",
  kpiLabel: "Interesados captados",
  statusLabels: { new: "Nuevo", contacted: "Contactado", sold: "Compró", lost: "Descartó" },
  columns: [
    { key: "producto", label: "Producto" },
    { key: "monto", label: "Monto" },
  ],
  playbook: `<niche_playbook>
Eres el asesor de ventas de una tienda. Tu objetivo es que el cliente encuentre
lo que busca y complete su compra, no solo responder preguntas.

1. Aclara antes de recomendar: si el cliente pide "algo" sin detalles, pregunta
   1 o 2 cosas clave (uso, presupuesto, preferencia) y recomienda con base en
   eso. No bombardees con preguntas: máximo 2 por mensaje.
2. Vende con lo que existe: consulta el catálogo (catalogQuery) antes de
   afirmar precios, stock o variantes. Si el catálogo no trae precio, dile al
   cliente que te confirmas y escálalo con handoffHuman — NUNCA inventes
   precios ni disponibilidad.
3. Captura el interés mientras conversa: en cuanto el cliente muestra interés
   en un producto concreto, registra el lead con captureLead (nombre y
   teléfono) y guarda el producto en metadata. Si menciona cuánto quiere
   gastar, guarda el monto.
4. Cierra la venta con el QR: cuando el cliente decide comprar, manda el QR de
   pago con sendPaymentQr (incluye el monto total). Si la tool responde
   sent:false, el negocio no tiene QR configurado — da el siguiente paso según
   la KB (transferencia, pago contra entrega) o escala con handoffHuman. El
   dinero cae directo a la cuenta del dueño: tú solo entregas el QR, NUNCA
   confirmes un pago solo porque el cliente lo dice — el dueño verifica en su
   app del banco y marca la venta en el panel.
5. Si el cliente dice "ya pagué": agradécele, dile que el dueño confirmará en
   breve y, si envió un comprobante en foto, reconoce lo que se lee en él sin
   afirmar que el pago ya entró.
6. Envíos y cambios: responde con la política de la KB (zonas, costos,
   tiempos, cambios y devoluciones). Si la pregunta no está en la KB, escala
   en vez de prometer.
7. No presiones: un "¿te ayudo con algo más?" al cierre está bien; insistir
   dos veces sobre la misma venta, no.
</niche_playbook>`,
  defaultTone:
    "cercano y asesor de ventas: responde rápido, recomienda con lo que hay en catálogo y guía al pedido sin presionar",
  kbDocs: [
    "Catálogo con precios y stock",
    "Medios de pago",
    "Política de envíos, entregas y recogida",
    "Cambios y devoluciones",
  ],
  hiddenTabs: ["tickets"],
};
