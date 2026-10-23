export const ESTADOS = ['pendiente', 'en_proceso', 'realizado', 'solucionado', 'cerrado'] as const
export type Estado = (typeof ESTADOS)[number]
export type Subtarea = { id: string; titulo: string; estado: Estado; depende_de: string[]; enlaces: string[]; creada: string; cerrada: string | null; manual?: boolean }
export type Tarea = { id: string; titulo: string; estado: Estado; depende_de: string[]; enlaces: string[]; creada: string; solucionada: string | null; cerrada: string | null; subtareas: Subtarea[] }
export type Archivo = { proyecto: string; formato: 'mst-tareas v1'; actualizado: string; siguiente_tarea: number; estados: string[]; reglas: string[]; tareas: Tarea[] }
export const MAX_SOLUCIONADAS = 5
export const REGLAS = [
  'Las tareas nuevas empiezan en pendiente y reciben un identificador que nunca se reutiliza.',
  'Las subtareas de una tarea se ejecutan en el orden indicado por sus dependencias.',
  'Una subtarea solo puede empezar cuando sus dependencias estén solucionadas.',
  'El agente marca realizado cuando termina; el jefe marca solucionado tras auditar.',
  'Las subtareas manuales no se asignan a agentes.',
  'Una tarea con subtareas deriva su estado del estado de todas ellas.',
  'Las tareas solucionadas no se editan; se crea otra tarea para trabajo adicional.',
  'Al superar cinco tareas solucionadas, la más antigua pasa al historial.',
  'Las fechas usan el formato YYYY-MM-DD.',
]

export function archivoNuevo(proyecto: string, hoy: string): Archivo {
  return { proyecto, formato: 'mst-tareas v1', actualizado: hoy, siguiente_tarea: 1, estados: [...ESTADOS], reglas: [...REGLAS], tareas: [] }
}

export function partesDeId(id: string): { tarea: number; sub?: number } | null {
  const m = /^T([1-9]\d*)(?:\.([1-9]\d*))?$/.exec(id)
  return m ? { tarea: Number(m[1]), ...(m[2] ? { sub: Number(m[2]) } : {}) } : null
}

const esEstado = (v: unknown): v is Estado => typeof v === 'string' && (ESTADOS as readonly string[]).includes(v)
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const listaTexto = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const texto = (v: unknown, defecto = '') => typeof v === 'string' ? v : defecto

export function normalizar(crudo: unknown, hoy: string): { archivo: Archivo; problemas: string[] } {
  const problemas: string[] = []
  try {
    if (!obj(crudo)) return { archivo: archivoNuevo('sin nombre', hoy), problemas: ['El archivo no es un objeto'] }
    if (!Array.isArray(crudo.tareas)) return { archivo: archivoNuevo(texto(crudo.proyecto, 'sin nombre'), hoy), problemas: ['tareas no es una lista'] }
    const ids = new Set<string>()
    const normSub = (s: unknown, i: number, padre: string): Subtarea | null => {
      if (!obj(s)) { problemas.push(`Subtarea ${padre}.${i} no es un objeto`); return null }
      const id = texto(s.id, `${padre}.${i}`)
      if (ids.has(id)) problemas.push(`Id duplicado: ${id}`)
      ids.add(id)
      if (!esEstado(s.estado)) problemas.push(`Estado desconocido en ${id}`)
      return { id, titulo: texto(s.titulo), estado: esEstado(s.estado) ? s.estado : 'pendiente', depende_de: listaTexto(s.depende_de), enlaces: listaTexto(s.enlaces), creada: texto(s.creada, hoy), cerrada: typeof s.cerrada === 'string' ? s.cerrada : null, ...(s.manual === true ? { manual: true } : {}) }
    }
    const tareas = crudo.tareas.flatMap((t, i): Tarea[] => {
      if (!obj(t)) { problemas.push(`Tarea ${i + 1} no es un objeto`); return [] }
      const id = texto(t.id, `T${i + 1}`)
      if (ids.has(id)) problemas.push(`Id duplicado: ${id}`)
      ids.add(id)
      if (!esEstado(t.estado)) problemas.push(`Estado desconocido en ${id}`)
      const subtareas = (Array.isArray(t.subtareas) ? t.subtareas : []).map((s, n) => normSub(s, n + 1, id)).filter((s): s is Subtarea => !!s)
      return [{ id, titulo: texto(t.titulo), estado: esEstado(t.estado) ? t.estado : 'pendiente', depende_de: listaTexto(t.depende_de), enlaces: listaTexto(t.enlaces), creada: texto(t.creada, hoy), solucionada: typeof t.solucionada === 'string' ? t.solucionada : null, cerrada: typeof t.cerrada === 'string' ? t.cerrada : null, subtareas }]
    })
    const max = tareas.reduce((n, t) => Math.max(n, partesDeId(t.id)?.tarea ?? 0), 0)
    const siguiente = Number.isInteger(crudo.siguiente_tarea) && Number(crudo.siguiente_tarea) > max ? Number(crudo.siguiente_tarea) : max + 1
    return { archivo: { proyecto: texto(crudo.proyecto, 'sin nombre'), formato: 'mst-tareas v1', actualizado: texto(crudo.actualizado, hoy), siguiente_tarea: siguiente, estados: [...ESTADOS], reglas: [...REGLAS], tareas }, problemas }
  } catch {
    return { archivo: archivoNuevo('sin nombre', hoy), problemas: ['No se pudo interpretar el archivo'] }
  }
}

export function estadoDeTarea(t: Tarea): Estado {
  const ss = t.subtareas
  if (!ss.length) return t.estado
  if (ss.every(s => s.estado === 'solucionado')) return 'solucionado'
  if (ss.every(s => s.estado === 'pendiente')) return 'pendiente'
  if (ss.some(s => s.estado === 'realizado') && ss.every(s => s.estado === 'realizado' || s.estado === 'solucionado')) return 'realizado'
  return 'en_proceso'
}

export type Op =
  | { tipo: 'crear_tarea'; titulo: string; subtareas: { titulo: string; depende_de?: number[]; manual?: boolean }[]; enlaces?: string[] }
  | { tipo: 'agregar'; tarea: string; subtareas: { titulo: string; depende_de?: string[]; manual?: boolean }[] }
  | { tipo: 'ajustar'; id: string; titulo?: string; depende_de?: string[] }
  | { tipo: 'estado'; id: string; estado: 'pendiente' | 'en_proceso' | 'realizado' | 'solucionado'; solo_si?: Estado }
export type Resultado = { ok: true; archivo: Archivo; cambios: string[]; cerradas: Tarea[] } | { ok: false; codigo: 'no_existe' | 'conflicto' | 'bloqueada' | 'invalida' | 'no_editable' | 'manual' | 'ciclo'; mensaje: string }
const error = (codigo: Extract<Resultado, { ok: false }>['codigo'], mensaje: string): Resultado => ({ ok: false, codigo, mensaje })
const sinCiclo = (subs: Subtarea[]) => {
  const visitando = new Set<string>(), visto = new Set<string>()
  const visitar = (id: string): boolean => {
    if (visitando.has(id)) return false
    if (visto.has(id)) return true
    visitando.add(id)
    const s = subs.find(x => x.id === id)
    if (s && !s.depende_de.every(visitar)) return false
    visitando.delete(id); visto.add(id); return true
  }
  return subs.every(s => visitar(s.id))
}
const validarDeps = (subs: Subtarea[]) => subs.every(s => s.depende_de.every(d => d !== s.id && subs.some(x => x.id === d)))
const cerrarExcedentes = (tareas: Tarea[], hoy: string) => {
  const quedan = [...tareas], cerradas: Tarea[] = []
  while (quedan.filter(t => estadoDeTarea(t) === 'solucionado').length > MAX_SOLUCIONADAS) {
    const orden = quedan.filter(t => estadoDeTarea(t) === 'solucionado').sort((a, b) => (a.solucionada ?? '').localeCompare(b.solucionada ?? '') || (partesDeId(a.id)?.tarea ?? 0) - (partesDeId(b.id)?.tarea ?? 0))
    const vieja = orden[0]
    quedan.splice(quedan.indexOf(vieja), 1)
    cerradas.push({ ...vieja, estado: 'cerrado', cerrada: hoy, subtareas: vieja.subtareas.map(s => ({ ...s, estado: 'cerrado', cerrada: hoy })) })
  }
  return { tareas: quedan, cerradas }
}
const exito = (archivo: Archivo, tareas: Tarea[], hoy: string, cambios: string[]): Resultado => {
  const cierre = cerrarExcedentes(tareas, hoy)
  return { ok: true, archivo: { ...archivo, actualizado: hoy, tareas: cierre.tareas }, cambios, cerradas: cierre.cerradas }
}

export function aplicar(archivo: Archivo, op: Op, hoy: string): Resultado {
  const copia = archivo.tareas.map(t => ({ ...t, depende_de: [...t.depende_de], enlaces: [...t.enlaces], subtareas: t.subtareas.map(s => ({ ...s, depende_de: [...s.depende_de], enlaces: [...s.enlaces] })) }))
  if (op.tipo === 'crear_tarea') {
    const existente = copia.find(t => t.estado !== 'cerrado' && t.titulo.trim().toLocaleLowerCase() === op.titulo.trim().toLocaleLowerCase())
    if (existente) return { ok: true, archivo, cambios: [`reutiliza ${existente.id}`], cerradas: [] }
    const n = archivo.siguiente_tarea, id = `T${n}`
    const subs: Subtarea[] = op.subtareas.map((s, i) => ({ id: `${id}.${i + 1}`, titulo: s.titulo, estado: 'pendiente', depende_de: (s.depende_de ?? []).map(d => `${id}.${d}`), enlaces: [], creada: hoy, cerrada: null, ...(s.manual ? { manual: true } : {}) }))
    if (subs.some((s, i) => (op.subtareas[i].depende_de ?? []).some(d => !Number.isInteger(d) || d < 1 || d > subs.length)) || !validarDeps(subs)) return error('invalida', 'Dependencia de subtarea no válida')
    if (!sinCiclo(subs)) return error('ciclo', 'Las dependencias forman un ciclo')
    const tarea: Tarea = { id, titulo: op.titulo, estado: 'pendiente', depende_de: [], enlaces: [...(op.enlaces ?? [])], creada: hoy, solucionada: null, cerrada: null, subtareas: subs }
    return exito({ ...archivo, siguiente_tarea: n + 1 }, [...copia, tarea], hoy, [`crea ${id}`])
  }
  const partes = op.tipo === 'agregar' ? partesDeId(op.tarea) : op.tipo === 'ajustar' || op.tipo === 'estado' ? partesDeId(op.id) : null
  if (!partes) return error('invalida', 'Id no válido')
  const tarea = copia.find(t => t.id === `T${partes.tarea}`)
  if (!tarea) return error('no_existe', 'La tarea no existe')
  if (op.tipo === 'agregar') {
    if (estadoDeTarea(tarea) === 'solucionado') return error('no_editable', 'La tarea solucionada no se puede editar')
    const num = Math.max(0, ...tarea.subtareas.map(s => partesDeId(s.id)?.sub ?? 0))
    const nuevas = op.subtareas.map((s, i): Subtarea => ({ id: `${tarea.id}.${num + i + 1}`, titulo: s.titulo, estado: 'pendiente', depende_de: [...(s.depende_de ?? [])], enlaces: [], creada: hoy, cerrada: null, ...(s.manual ? { manual: true } : {}) }))
    if (nuevas.some(s => s.depende_de.some(d => !tarea.subtareas.some(x => x.id === d) && !nuevas.some(x => x.id === d))) || !validarDeps([...tarea.subtareas, ...nuevas])) return error('invalida', 'Dependencia de subtarea no válida')
    if (!sinCiclo([...tarea.subtareas, ...nuevas])) return error('ciclo', 'Las dependencias forman un ciclo')
    tarea.subtareas.push(...nuevas); tarea.estado = estadoDeTarea(tarea)
    return exito(archivo, copia, hoy, [`agrega ${nuevas.length} subtarea(s) a ${tarea.id}`])
  }
  if (op.tipo === 'ajustar') {
    if (partes.sub === undefined) {
      if (op.depende_de !== undefined) return error('invalida', 'Una tarea no admite dependencias en este ajuste')
      if (estadoDeTarea(tarea) === 'solucionado') return error('no_editable', 'La tarea solucionada no se puede editar')
      if (op.titulo !== undefined) tarea.titulo = op.titulo
    } else {
      const sub = tarea.subtareas.find(s => s.id === op.id)
      if (!sub) return error('no_existe', 'La subtarea no existe')
      if (sub.estado !== 'pendiente') return error('no_editable', 'Solo se ajustan subtareas pendientes')
      if (op.titulo !== undefined) sub.titulo = op.titulo
      if (op.depende_de !== undefined) sub.depende_de = [...op.depende_de]
      if (!validarDeps(tarea.subtareas)) return error('invalida', 'Dependencia de subtarea no válida')
      if (!sinCiclo(tarea.subtareas)) return error('ciclo', 'Las dependencias forman un ciclo')
      tarea.estado = estadoDeTarea(tarea)
    }
    return exito(archivo, copia, hoy, [`ajusta ${op.id}`])
  }
  if (partes.sub === undefined) {
    if (tarea.subtareas.length) return error('invalida', 'Cambia el estado de las subtareas')
    const actual = tarea.estado
    if (op.solo_si && actual !== op.solo_si) return error('conflicto', `El estado actual es ${actual}`)
    tarea.estado = op.estado
    // La fecha se conserva si ya estaba solucionada: de ella depende cuál es "la más vieja" al cerrar.
    tarea.solucionada = op.estado === 'solucionado' ? (tarea.solucionada ?? hoy) : null
  } else {
    const sub = tarea.subtareas.find(s => s.id === op.id)
    if (!sub) return error('no_existe', 'La subtarea no existe')
    if (op.solo_si && sub.estado !== op.solo_si) return error('conflicto', `El estado actual es ${sub.estado}`)
    if (sub.manual && (op.estado === 'en_proceso' || op.estado === 'realizado')) return error('manual', 'La subtarea manual solo puede marcarse pendiente o solucionado')
    if (op.estado === 'en_proceso') {
      const faltan = sub.depende_de.filter(d => tarea.subtareas.find(s => s.id === d)?.estado !== 'solucionado')
      if (faltan.length) return error('bloqueada', `Faltan dependencias: ${faltan.join(', ')}`)
    }
    sub.estado = op.estado
    tarea.estado = estadoDeTarea(tarea)
    tarea.solucionada = tarea.estado === 'solucionado' ? (tarea.solucionada ?? hoy) : null
  }
  return exito(archivo, copia, hoy, [`${op.estado} ${op.id}`])
}

export function bloqueHistorial(t: Tarea): string {
  const lineas = [`## ${t.id} · ${t.titulo}`, `Creada: ${t.creada} · Solucionada: ${t.solucionada ?? '—'} · Cerrada: ${t.cerrada ?? '—'}`]
  if (t.enlaces.length) lineas.push(`Enlaces: ${t.enlaces.join(', ')}`)
  lineas.push(...t.subtareas.map(s => `- ${s.id} · ${s.titulo} (${s.estado})`))
  return lineas.join('\n')
}
export function agregarAlHistorial(md: string, t: Tarea): string {
  if (new RegExp(`^## ${t.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · `, 'm').test(md)) return md
  const base = md.trimEnd()
  return `${base ? `${base}\n\n` : '# Historial de tareas cerradas\n\n'}${bloqueHistorial(t)}`
}
export function resumen(archivo: Archivo): { proyecto: string; actualizado: string; siguiente_tarea: number; solucionadas: number; tareas: { id: string; titulo: string; estado: Estado; subtareas: { total: number; solucionadas: number } }[]; activa?: { id: string; titulo: string; estado: Estado; subtareas: { id: string; titulo: string; estado: Estado; depende_de: string[]; manual?: true }[] } } {
  const tareas = archivo.tareas.map(t => ({ id: t.id, titulo: t.titulo, estado: estadoDeTarea(t), subtareas: { total: t.subtareas.length, solucionadas: t.subtareas.filter(s => s.estado === 'solucionado').length } }))
  const activa = archivo.tareas.find(t => estadoDeTarea(t) !== 'solucionado')
  return { proyecto: archivo.proyecto, actualizado: archivo.actualizado, siguiente_tarea: archivo.siguiente_tarea, solucionadas: archivo.tareas.filter(t => estadoDeTarea(t) === 'solucionado').length, tareas, ...(activa ? { activa: { id: activa.id, titulo: activa.titulo, estado: estadoDeTarea(activa), subtareas: activa.subtareas.map(s => ({ id: s.id, titulo: s.titulo, estado: s.estado, depende_de: [...s.depende_de], ...(s.manual ? { manual: true as const } : {}) })) } } : {}) }
}
