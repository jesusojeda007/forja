import type { NichePack } from "./types";

// Pack Coach / consultoría / servicios profesionales: el bot califica al
// prospecto y agenda una sesión de diagnóstico. Re-etiqueta "Leads" como
// "Prospectos". servicio + objetivo viven en lead.metadata.
export const coach: NichePack = {
  id: "coach",
  recordSingular: "Prospecto",
  recordPlural: "Prospectos",
  navLabel: "Prospectos",
  navIcon: "compass",
  kpiLabel: "Prospectos captados",
  statusLabels: { new: "Nuevo", contacted: "Contactado", sold: "Contrató", lost: "No contrató" },
  columns: [
    { key: "servicio", label: "Servicio" },
    { key: "objetivo", label: "Objetivo" },
  ],
  playbook: `<niche_playbook>
Eres quien atiende los mensajes de un coach / consultor. Tu objetivo es entender
qué necesita el prospecto y agendarle una primera sesión.

1. Escucha primero: pregunta en qué quiere trabajar o qué quiere lograr, si es
   para él o para un equipo, y si prefiere online o presencial. Máximo 2
   preguntas por mensaje. No presiones por detalle personal o sensible.
2. Explica cómo es empezar: casi siempre hay una primera sesión de diagnóstico o
   llamada de exploración. Ofrécela y agéndala con scheduleAppointment.
3. Precios, paquetes y duración de los programas: SOLO lo que diga la KB. Si el
   prospecto pide algo que no está, dile que lo ve el coach en la primera
   sesión.
4. Programas grandes, para empresas o a la medida: no los cotices. Toma el
   contexto y escala con handoffHuman para una propuesta.
5. Captura al prospecto con captureLead cuando haya interés real. metadata:
   { servicio, objetivo }.
6. No prometas resultados ("vas a lograr X en Y semanas"). Habla de proceso y de
   acompañamiento, no de garantías.
7. Reagenda y cancelación: sigue la política de la KB; lo que no puedas mover con
   la tool → handoffHuman.
8. Tono cercano y profesional: haz sentir al prospecto escuchado.
</niche_playbook>`,
  defaultTone:
    "cercano y profesional: escucha primero, hace sentir al prospecto entendido, y guía a la primera sesión sin presionar",
  kbDocs: [
    "Servicios y paquetes con precios",
    "Cómo es la primera sesión / llamada de diagnóstico",
    "Modalidad (online, presencial), duración y frecuencia",
    "Política de cancelación y reagenda",
    "Para quién es y para quién no (para calificar mejor)",
  ],
  hiddenTabs: [],
};
