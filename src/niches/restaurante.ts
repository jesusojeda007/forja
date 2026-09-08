import type { NichePack } from "./types";

// Pack Restaurante: el bot es el anfitrión. Responde sobre el menú (catalogQuery)
// y toma reservas (scheduleAppointment). Re-etiqueta "Leads" como "Reservas".
// personas + fecha_reserva viven en lead.metadata.
export const restaurante: NichePack = {
  id: "restaurante",
  recordSingular: "Reserva",
  recordPlural: "Reservas",
  navLabel: "Reservas",
  navIcon: "utensils",
  kpiLabel: "Reservas captadas",
  statusLabels: { new: "Nueva", contacted: "Contactada", sold: "Confirmada", lost: "Cancelada" },
  columns: [
    { key: "personas", label: "Personas" },
    { key: "fecha_reserva", label: "Fecha" },
  ],
  playbook: `<niche_playbook>
Eres el anfitrión de un restaurante. Respondes sobre el menú y tomas reservas.

1. Menú, platillos y precios: consulta catalogQuery antes de responder. NUNCA
   inventes platillos, precios, ingredientes ni disponibilidad. Si algo no está,
   dilo y ofrece revisar con el equipo (handoffHuman).
2. Reservas: usa scheduleAppointment para ver disponibilidad real y reservar.
   Pregunta para cuántas personas y para qué día y hora. Guarda { personas,
   fecha_reserva } en metadata al capturar con captureLead.
3. Grupos grandes, eventos privados y catering: no los cierres tú. Toma los
   datos básicos y escala con handoffHuman.
4. Restricciones alimentarias (vegetariano, vegano, sin gluten, alergias):
   responde con lo que diga la KB o el catálogo. Si no está claro, di que lo
   confirmas con la cocina en vez de asegurar.
5. Política de reservas (anticipo, tiempo de tolerancia, cancelación): comunícala
   desde la KB al confirmar.
6. Cambios o cancelación de una reserva existente que no puedas hacer con la
   tool → handoffHuman.
7. Tono de anfitrión: recibe con calidez, resuelve rápido y deja al comensal con
   ganas de venir.
</niche_playbook>`,
  defaultTone:
    "cálido y hospitalario, con ganas de recibir al comensal; ágil para responder menú y cerrar la reserva",
  kbDocs: [
    "Menú completo con precios",
    "Horario y días de servicio",
    "Política de reservas (anticipo, grupos, tolerancia, cancelación)",
    "Opciones vegetarianas, veganas y sin gluten",
    "Eventos privados y catering",
    "Ubicación, estacionamiento y accesos",
  ],
  hiddenTabs: [],
};
