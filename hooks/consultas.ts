// Lógica pura de las consultas de los agentes: qué está esperando respuesta y qué se le devuelve.
// Solo trabaja con texto: quien escribe y lee consultas.jsonl, respuestas.jsonl y permisos.json vive en otra parte.

export type Consulta = { id: string; trabajo: string; tipo: 'pregunta' | 'permiso'; texto: string; detalle?: string; categoria?: string; opciones?: string[]; en: number }
export type Respuesta = { id: string; decision: 'aprobar' | 'denegar' | 'siempre' | 'texto'; texto?: string; en: number }

// Las categorías con las que un agente puede pedir permiso.
export const CATEGORIAS = ['comando', 'instalar', 'red', 'escribir-fuera', 'destructivo', 'otro']

// Cuánto se espera al usuario antes de dar una consulta por vencida (15 minutos).
export const ESPERA_RESPUESTA_MS = 900_000

// Un JSONL: una línea por registro. Se ignoran las líneas vacías y las que no son un objeto JSON.
export function leerLineas<T>(jsonl: string): T[] {
  const salida: T[] = []
  for (const linea of String(jsonl ?? '').split(/\r?\n/)) {
    const t = linea.trim()
    if (!t) continue
    try {
      const v = JSON.parse(t)
      if (v && typeof v === 'object' && !Array.isArray(v)) salida.push(v as T)
    } catch {}
  }
  return salida
}

// Las consultas que el usuario todavía no ha contestado, de la más antigua a la más nueva.
// Un permiso con la categoría ya concedida para esta petición no se vuelve a preguntar;
// una pregunta nunca se quita por los permisos.
export function abiertas(consultas: string, respuestas: string, permisos?: string): Consulta[] {
  const respondidas = new Set(leerLineas<Respuesta>(respuestas).map(r => r.id).filter(Boolean))
  const vistas = new Set<string>()
  const pendientes: Consulta[] = []
  for (const c of leerLineas<Consulta>(consultas)) {
    if (!c || typeof c.id !== 'string' || !c.id) continue
    if (vistas.has(c.id)) continue // con id repetido solo cuenta la primera
    vistas.add(c.id)
    if (respondidas.has(c.id)) continue
    if (c.tipo === 'permiso' && permisos !== undefined && permitidaSiempre(permisos, c.categoria)) continue
    pendientes.push(c)
  }
  return pendientes.sort((a, b) => (a.en ?? 0) - (b.en ?? 0))
}

// La primera respuesta que hay para una consulta.
export function respuestaDe(respuestas: string, id: string): Respuesta | undefined {
  return leerLineas<Respuesta>(respuestas).find(r => r.id === id)
}

// Si el usuario aprobó esa categoría para siempre. Lo destructivo nunca se concede: siempre se pregunta.
export function permitidaSiempre(permisos: string, categoria?: string): boolean {
  if (!categoria || categoria === 'destructivo') return false
  let lista: unknown
  try {
    lista = JSON.parse(String(permisos ?? '').trim() || '[]')
  } catch {
    return false
  }
  return Array.isArray(lista) && lista.includes(categoria)
}

// Lo que se le devuelve al agente: lo que decidió el usuario, o que todavía no hay respuesta.
export function resultadoParaAgente(c: Consulta, r: Respuesta | undefined, vencida: boolean): string {
  if (!r) {
    if (!vencida) return 'Esperando respuesta del usuario.'
    return c.tipo === 'permiso'
      ? 'SIN RESPUESTA a tiempo: se da por DENEGADO. No lo hagas: sigue por lo más seguro o termina explicando qué quedó sin hacer.'
      : 'SIN RESPUESTA a tiempo. Sigue por lo más seguro, anota tu suposición en tu resultado final y continúa.'
  }
  const texto = String(r.texto ?? '').trim()
  if (c.tipo === 'permiso') {
    if (r.decision === 'aprobar' || r.decision === 'siempre') return 'APROBADO por el usuario. Puedes continuar.'
    // Denegado, o una decisión que no se entiende: por lo más seguro, no se hace.
    return 'DENEGADO por el usuario. No lo hagas: busca otra forma o termina explicando qué quedó sin hacer.' + (texto ? `\nMotivo del usuario: ${texto}` : '')
  }
  if (texto) return `RESPUESTA DEL USUARIO: ${texto}`
  if (r.decision === 'denegar') return 'RESPUESTA DEL USUARIO: no.'
  return 'RESPUESTA DEL USUARIO: sí.'
}

// Lo que se le añade al final del encargo de cada agente para que sepa cómo preguntar y pedir permiso.
export const PROTOCOLO_AGENTE = [
  'Si te falta una decisión que no puedes deducir del encargo, usa la herramienta preguntar y pregunta al usuario en vez de adivinar.',
  'Usa pedir_permiso ANTES de ejecutar comandos destructivos (borrar archivos, formatear, forzar git), de instalar software global, de usar la red de forma inesperada o de escribir fuera de la carpeta de trabajo, indicando la categoría: comando, instalar, red, escribir-fuera, destructivo u otro.',
  'Estas herramientas esperan la respuesta del usuario, así que no las uses para cosas triviales.',
  'Si no recibes respuesta, sigue por lo más seguro y anota tu suposición en el resultado final.',
].join(' ')
