import type { NichePack, NicheRuleGroup } from "./types";

// Reglas configurables de una tienda. Cada dueño las setea en el panel; acá
// solo se define la FORMA (qué se pregunta y cómo se traduce al prompt), no los
// valores. Un valor vacío = la regla no entra al prompt (y el bot no promete
// nada sobre ese punto — comportamiento seguro por default).
const tiendaRules: NicheRuleGroup[] = [
  {
    group: "Envío y entrega",
    rules: [
      {
        key: "envio_domicilio",
        label: "¿Hacen envío a domicilio?",
        type: "toggle",
        toPrompt: (v) =>
          v === "si"
            ? "Hacemos envío a domicilio."
            : "No hacemos envío a domicilio; el cliente retira su pedido.",
      },
      {
        key: "retiro_local",
        label: "¿El cliente puede retirar en el local?",
        type: "toggle",
        toPrompt: (v) =>
          v === "si"
            ? "El cliente también puede retirar su pedido en el local."
            : "No hay retiro en local: solo entrega por envío.",
      },
      {
        key: "zona_envio_incluido",
        label: "Zona donde el envío va incluido en el precio",
        help: "Dónde no se cobra envío aparte. Vacío = el envío nunca va incluido.",
        type: "text",
        placeholder: "Ej. Santa Cruz, hasta el 8.º anillo",
        toPrompt: (v) => `Dentro de ${v} el envío va incluido en el precio, sin cargo extra.`,
      },
      {
        key: "envio_fuera_zona",
        label: "Envío fuera de esa zona",
        help: "Qué pasa con el costo del envío fuera de la zona incluida.",
        type: "text",
        placeholder: "Ej. Lo paga el cliente al recibir; depende de la transportadora",
        toPrompt: (v) =>
          `Fuera de esa zona: ${v}. Nunca cotices un monto de envío que no esté escrito en estas reglas.`,
      },
      {
        key: "tiempo_entrega",
        label: "Tiempo de entrega estimado",
        help: "Vacío = el bot no promete plazos de entrega.",
        type: "text",
        placeholder: "Ej. Santa Cruz 24 h, otras ciudades 48 h",
        toPrompt: (v) =>
          `Tiempo de entrega: ${v}. Si preguntan por una zona que no está acá, no inventes un plazo.`,
      },
      {
        key: "dias_despacho",
        label: "Días de despacho",
        type: "select",
        options: [
          { value: "todos", label: "Todos los días" },
          { value: "lun_vie", label: "Lunes a viernes" },
          { value: "lun_sab", label: "Lunes a sábado" },
        ],
        toPrompt: (v) => {
          const map: Record<string, string> = {
            todos: "todos los días",
            lun_vie: "de lunes a viernes",
            lun_sab: "de lunes a sábado",
          };
          return `Los despachos salen ${map[v] ?? v}.`;
        },
      },
      {
        key: "monto_minimo",
        label: "Monto mínimo de pedido",
        help: "Vacío o 0 = sin mínimo.",
        type: "number",
        placeholder: "0",
        toPrompt: (v) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0 ? `El pedido mínimo es ${v}.` : null;
        },
      },
    ],
  },
  {
    group: "Pago",
    rules: [
      {
        key: "formas_pago",
        label: "Formas de pago aceptadas",
        type: "text",
        placeholder: "Ej. Efectivo y QR (transferencia bancaria)",
        toPrompt: (v) => `Formas de pago aceptadas: ${v}. No ofrezcas ninguna otra.`,
      },
      {
        key: "pago_contra_entrega",
        label: "¿Aceptan pago contra entrega?",
        type: "select",
        options: [
          { value: "si", label: "Sí, en todas las zonas" },
          { value: "no", label: "No" },
          { value: "zonas", label: "Solo en algunas zonas" },
        ],
        toPrompt: (v) => {
          if (v === "si") return "Se acepta pago contra entrega (el cliente paga al recibir).";
          if (v === "no") return "No se acepta pago contra entrega: el pedido se paga antes del envío.";
          return "El pago contra entrega solo vale en algunas zonas (ver la regla de pago del interior).";
        },
      },
      {
        key: "pago_interior",
        label: "Pago en envíos a otras ciudades / interior",
        help: "Cómo se cobra cuando el envío sale de la zona local.",
        type: "text",
        placeholder: "Ej. El producto se paga 100% por adelantado por QR antes del despacho",
        toPrompt: (v) => `Envíos al interior: ${v}.`,
      },
      {
        key: "moneda",
        label: "Moneda",
        type: "select",
        options: [
          { value: "BOB", label: "Bolivianos (Bs)" },
          { value: "USD", label: "Dólares (US$)" },
          { value: "BOB_USD", label: "Bolivianos y dólares" },
        ],
        toPrompt: (v) => {
          const map: Record<string, string> = {
            BOB: "Todos los precios y pagos son en bolivianos (Bs).",
            USD: "Todos los precios y pagos son en dólares (US$).",
            BOB_USD: "Se cobra en bolivianos (Bs) o dólares (US$).",
          };
          return map[v] ?? null;
        },
      },
    ],
  },
  {
    group: "Cambios y garantía",
    rules: [
      {
        key: "devolucion_dinero",
        label: "¿Devuelven el dinero?",
        type: "toggle",
        toPrompt: (v) =>
          v === "si"
            ? "Aceptamos devolución del dinero según la política de cambios."
            : "No se devuelve dinero. Si corresponde, se hace cambio de producto.",
      },
      {
        key: "cambio_producto",
        label: "Política de cambio de producto",
        type: "text",
        placeholder: "Ej. Cambio dentro de 3 días, sin usar y con caja; el envío lo paga el cliente",
        toPrompt: (v) => `Cambios de producto: ${v}.`,
      },
      {
        key: "garantia",
        label: "Garantía",
        type: "text",
        placeholder: "Ej. 3 días por falla de fábrica; no cubre daños por mal uso",
        toPrompt: (v) => `Garantía: ${v}.`,
      },
    ],
  },
  {
    group: "Stock y cierre de venta",
    rules: [
      {
        key: "mostrar_stock",
        label: "¿El bot habla de stock?",
        type: "select",
        options: [
          { value: "exacto", label: "Sí, el número exacto" },
          { value: "disponibilidad", label: "Solo disponible / agotado" },
          { value: "nunca", label: "No menciona stock" },
        ],
        toPrompt: (v) => {
          if (v === "exacto")
            return "Podés decirle al cliente cuántas unidades hay en stock (viene en el catálogo).";
          if (v === "disponibilidad")
            return "No des números de stock: solo decí si el producto está disponible o agotado.";
          return "No hables de stock ni disponibilidad; si insisten, escala con handoffHuman.";
        },
      },
      {
        key: "sin_stock",
        label: "Si un producto está agotado",
        type: "select",
        options: [
          { value: "avisar", label: "Ofrecer avisar cuando vuelva" },
          { value: "escalar", label: "Pasar a una persona" },
        ],
        toPrompt: (v) =>
          v === "escalar"
            ? "Si el producto está agotado, pasá la consulta a una persona con handoffHuman."
            : "Si el producto está agotado, ofrecé anotar al cliente para avisarle cuando vuelva (captureLead, con el producto en metadata).",
      },
      {
        key: "cierre_venta",
        label: "Cuando el cliente decide comprar",
        type: "select",
        options: [
          { value: "bot", label: "El bot registra el pedido" },
          { value: "humano", label: "Una persona confirma antes" },
        ],
        toPrompt: (v) =>
          v === "humano"
            ? "Cuando el cliente decide comprar, tomá sus datos y avisale que una persona confirma el pedido antes de cerrarlo."
            : "Cuando el cliente decide comprar, registrá vos el pedido (captureLead + detalle en metadata) y seguí con el cobro; no hace falta que lo confirme una persona.",
      },
      {
        key: "descuentos",
        label: "Descuentos",
        type: "text",
        placeholder: "Ej. Solo precio por mayor, publicado en la página. No inventar otros",
        toPrompt: (v) => `Descuentos: ${v}. Nunca inventes un porcentaje ni un precio que no esté publicado.`,
      },
      {
        key: "regateo",
        label: "Si el cliente regatea / pide rebaja",
        type: "select",
        options: [
          { value: "firme", label: "Precio firme, no se negocia" },
          { value: "mayoreo", label: "Firme, salvo compra grande (deriva a un asesor)" },
          { value: "asesor", label: "El bot no responde: pasa con un asesor" },
        ],
        toPrompt: (v) => {
          if (v === "asesor")
            return "Si el cliente pide rebaja o regatea, no negocies: pasá la conversación a un asesor con handoffHuman.";
          if (v === "mayoreo")
            return "El precio de lista es firme y no se regatea. Solo para compras grandes / por mayor, ofrecé pasar la consulta a un asesor; nunca ofrezcas vos un descuento.";
          return "El precio de lista es firme: no se regatea ni se hacen rebajas. Decilo con amabilidad y sin ofrecer alternativas de precio.";
        },
      },
      {
        key: "reserva_horas",
        label: "¿Cuántas horas puede el bot apartar un producto?",
        help: "0 o vacío = el bot no aparta productos.",
        type: "number",
        placeholder: "0",
        toPrompt: (v) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0
            ? `Podés apartar un producto para un cliente hasta ${v} horas.`
            : "No apartes ni reserves productos.";
        },
      },
    ],
  },
  {
    group: "Atención",
    rules: [
      {
        key: "horario_atencion",
        label: "Horario en que responde una persona",
        help: "Para cuando el bot dice “un asesor te responde…”.",
        type: "text",
        placeholder: "Ej. Lunes a viernes de 8:00 a 12:00 y de 14:00 a 18:00",
        toPrompt: (v) =>
          `Un asesor humano responde ${v}. Fuera de ese horario, tomá el dato del cliente y avisale que le responden apenas abran.`,
      },
    ],
  },
];

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
3. Muestra el producto: la PRIMERA vez que recomendás o mencionás un producto
   concreto, mandá su foto con sendProductPhoto (no esperes a que la pidan).
   Regla estricta: llamá sendProductPhoto UNA sola vez por producto en toda la
   conversación. Si un producto YA apareció antes (vos lo mostraste o el
   cliente lo nombró y vos respondiste), NO vuelvas a llamar sendProductPhoto
   ni catalogQuery por ese mismo producto — ya tenés los datos. En el texto:
   nombre, precio, stock y el link del catálogo. Sin foto en el catálogo →
   mandá al menos el link; nunca fotos de otro lado.
4. Captura el interés: mientras el cliente todavía NO compra pero muestra
   interés, usá captureLead (nombre, teléfono, producto, monto si lo dice).
   Una vez que el cliente CONFIRMA la compra, dejá de usar captureLead para
   eso: el pedido va en registrarPedido (paso 6).
5. Datos de entrega (cuando el cliente va a comprar, o pregunta costo/tiempo
   de envío a su zona):
   a. Pedí la dirección: ciudad, barrio/zona, calle y número, y una referencia
      (portón, color, esquina). En Santa Cruz, entre qué anillos o radiales
      queda AYUDA a calcular el envío, pero NO es obligatorio: si el cliente
      no lo sabe o no lo dice, seguí igual con lo que tengas.
   b. El cliente puede compartir su ubicación de Telegram (te llega como
      "[UBICACIÓN COMPARTIDA] ... link de mapa"). Es un APOYO: agradecelo y
      guardá el link, pero igual necesitás la dirección escrita.
   c. Clasificá la zona según las reglas del negocio: dentro de la zona con
      envío incluido → "incluido"; fuera de esa zona en la misma ciudad →
      "cliente_paga" (paga al recibir, el monto lo pone la transportadora,
      NUNCA lo cotices); otra ciudad → "interior". Si dudás, poné la que más se
      acerque y seguí; no frenes el pedido por esto.
   d. NUNCA dejes sin respuesta un mensaje de ubicación o de dirección.
6. Registra el pedido: apenas el cliente confirme que compra Y tengas (a) los
   productos y (b) una dirección aunque sea sin el dato de los anillos, llamá
   registrarPedido UNA vez, con todos los productos juntos (nombre, cantidad,
   precio_unitario del catálogo), cliente, contacto y datos de entrega
   (ciudad, direccion, zona_envio, link_mapa si hay). NO sigas pidiendo datos
   opcionales: registrá primero y pedí lo que falte después. No anuncies "voy
   a registrar": llamá la tool y después confirmá en UN mensaje con el número
   de pedido que devuelve ("Tu pedido es el TS-0007"). Si el cliente todavía
   NO compra y solo quiere apartar algo ("guardame uno, paso mañana"), usá
   apartarProducto (no registrarPedido).
7. Cobra con el QR: después de registrar el pedido, mandá el QR con
   sendPaymentQr (con el monto total). Si responde sent:false, no hay QR
   configurado — seguí con lo que diga la KB (transferencia, pago contra
   entrega) o escalá. El dinero cae directo a la cuenta del dueño: vos solo
   entregás el QR. NUNCA confirmes un pago porque el cliente lo diga — el
   dueño lo verifica en su banco y marca el pedido como pagado en el panel.
8. Si el cliente dice "ya pagué": agradecé, decile que el dueño confirma en
   breve y, si mandó un comprobante en foto, reconocé lo que se lee sin
   afirmar que el pago entró.
9. Pedido ya hecho ("¿dónde está lo mío?", "¿ya salió?"): consultá con
   estadoPedido (por código, teléfono, o el último de esta conversación) y
   respondé con lo que devuelve. Si no aparece, decilo y ofrecé pasar con un
   asesor — no inventes un estado.
10. Producto agotado (stock 0): ofrecé anotar al cliente con anotarEnEspera
    para avisarle cuando vuelva; no prometas fecha de reposición.
11. Envíos y cambios: respondé con la política (reglas del negocio + KB:
    zonas, tiempos, cambios, garantía). Si no está, escalá en vez de prometer.
12. No presiones: un "¿te ayudo con algo más?" al cierre está bien; insistir
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
  // Tickets queda VISIBLE: en una tienda real un "quiero hablar con alguien" o
  // un reclamo tiene que caer en algún lado que el dueño mire.
  hiddenTabs: [],
  // Una tienda no agenda citas — fuera del set de tools (además, el schema de
  // esa tool traía un regex que algunos proveedores rechazan).
  disabledTools: ["scheduleAppointment"],
  rules: tiendaRules,
};
