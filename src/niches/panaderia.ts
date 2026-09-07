import type { NichePack } from "./types";

// Pack Panadería / pastelería: el bot responde sobre productos (catalogQuery) y
// toma pedidos, sobre todo los especiales con fecha de entrega. Re-etiqueta
// "Leads" como "Pedidos". pedido + fecha_entrega viven en lead.metadata.
export const panaderia: NichePack = {
  id: "panaderia",
  recordSingular: "Pedido",
  recordPlural: "Pedidos",
  navLabel: "Pedidos",
  navIcon: "croissant",
  kpiLabel: "Pedidos captados",
  statusLabels: { new: "Nuevo", contacted: "Contactado", sold: "Confirmado", lost: "Cancelado" },
  columns: [
    { key: "pedido", label: "Pedido" },
    { key: "fecha_entrega", label: "Entrega" },
  ],
  playbook: `<niche_playbook>
Eres quien atiende los mensajes de una panadería y pastelería. Respondes sobre
productos y tomas pedidos.

1. Productos, panes, pasteles y precios: consulta catalogQuery antes de
   responder. NUNCA inventes productos, precios, sabores ni disponibilidad.
2. Pedidos especiales (pasteles, roscas, pan para evento, cajas grandes):
   necesitan anticipación. Pregunta para qué fecha lo necesita y confirma con la
   KB si hay tiempo suficiente. Registra con captureLead y guarda { pedido,
   fecha_entrega } en metadata.
3. Pasteles personalizados (diseño, figuras, número de porciones, mensaje):
   NO cotices ni prometas el diseño. Toma la idea y la fecha, y escala con
   handoffHuman para cotización y confirmación.
4. Anticipo: los pedidos especiales suelen pedir anticipo. Si la KB lo indica,
   díselo al cliente y explícale cómo pagarlo.
5. Alérgenos e ingredientes (nuez, gluten, lácteos, opciones veganas): responde
   con la KB o el catálogo; si no está claro, di que lo confirmas.
6. Entrega o recolección: comunica lo que diga la KB (horario de recolección,
   si hacen entrega y su costo).
7. Tono cálido y casero.
</niche_playbook>`,
  defaultTone:
    "cálido y casero: cercano, con gusto por lo que se hornea; claro con fechas y anticipación de los pedidos especiales",
  kbDocs: [
    "Catálogo de productos y precios",
    "Horario",
    "Pedidos especiales: anticipación mínima por tipo (pastel, rosca, evento)",
    "Personalización de pasteles y cómo se cotiza",
    "Anticipo y formas de pago",
    "Alérgenos, ingredientes y opciones veganas / sin gluten",
    "Entrega a domicilio y recolección",
  ],
  hiddenTabs: [],
};
