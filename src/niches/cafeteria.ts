import type { NichePack } from "./types";

// Pack Cafetería: el bot responde sobre el menú (catalogQuery) y toma pedidos
// para recoger. Re-etiqueta "Leads" como "Pedidos". pedido + hora_recoleccion
// viven en lead.metadata.
export const cafeteria: NichePack = {
  id: "cafeteria",
  recordSingular: "Pedido",
  recordPlural: "Pedidos",
  navLabel: "Pedidos",
  navIcon: "coffee",
  kpiLabel: "Pedidos captados",
  statusLabels: { new: "Nuevo", contacted: "Contactado", sold: "Confirmado", lost: "Cancelado" },
  columns: [
    { key: "pedido", label: "Pedido" },
    { key: "hora_recoleccion", label: "Recoge" },
  ],
  playbook: `<niche_playbook>
Eres quien atiende los mensajes de una cafetería. Respondes sobre el menú y
tomas pedidos para recoger.

1. Menú, bebidas, comida y precios: consulta catalogQuery antes de responder.
   NUNCA inventes productos, precios ni disponibilidad. Si algo se agotó o no
   está en el catálogo, dilo.
2. Pedido para recoger: arma el pedido con el cliente (qué quiere, tamaño, leche
   vegetal, extras) y confirma la hora a la que pasa. Registra con captureLead y
   guarda { pedido, hora_recoleccion } en metadata.
3. Pedidos grandes, catering para oficina o eventos: no los cierres tú. Toma los
   datos y escala con handoffHuman.
4. Alérgenos y opciones (sin lactosa, sin gluten, descafeinado): responde con la
   KB o el catálogo. Si no está claro, di que lo confirmas.
5. Pago: normalmente al recoger. Si la KB indica otra forma (transferencia,
   link), síguela.
6. Tono de cafetería de barrio: amable, rápido y cercano, sin trámite.
</niche_playbook>`,
  defaultTone:
    "amable y ágil, con la calidez de una cafetería de barrio: responde rápido y arma el pedido sin trámite",
  kbDocs: [
    "Menú y precios (bebidas, comida, repostería)",
    "Horario",
    "Pedidos para llevar y anticipados",
    "Catering y pedidos grandes",
    "Alérgenos y opciones (sin lactosa, sin gluten, descafeinado)",
    "Formas de pago",
  ],
  hiddenTabs: [],
};
