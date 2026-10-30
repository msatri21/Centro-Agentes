export const MAX_PARALELO = 4

export class Semaforo {
  private readonly max: number
  private enCurso = 0
  private cola: ((liberar: () => void) => void)[] = []

  constructor(max = MAX_PARALELO) {
    this.max = max
  }

  get enUso(): number { return this.enCurso }
  get esperando(): number { return this.cola.length }

  tomar(): Promise<() => void> {
    return new Promise(recibir => {
      if (this.enCurso < this.max) { this.enCurso++; recibir(this.hueco()) }
      else this.cola.push(recibir)
    })
  }

  // Un solo liberador por toma: la segunda llamada no suelta otro hueco.
  private hueco(): () => void {
    let libre = false
    return () => {
      if (libre) return
      libre = true
      const siguiente = this.cola.shift()
      if (siguiente) siguiente(this.hueco())
      else this.enCurso--
    }
  }
}

export const REINTENTOS_ARRANQUE = 2

export function esErrorDeArranque(texto: string): boolean {
  const normal = texto.toLowerCase()
  return normal.includes('standalone server exited before reporting readiness') || normal.includes('server exited before reporting')
}

export const LIMITE_ARCHIVOS_MODIFICADOS = 15
export const LIMITE_ARCHIVOS_BORRADOS = 5

export function esMasiva(c: { modificados: number; borrados: number }): { masiva: boolean; motivo?: string } {
  if (c.modificados > LIMITE_ARCHIVOS_MODIFICADOS) return { masiva: true, motivo: `${c.modificados} archivos modificados (máximo ${LIMITE_ARCHIVOS_MODIFICADOS})` }
  if (c.borrados > LIMITE_ARCHIVOS_BORRADOS) return { masiva: true, motivo: `${c.borrados} archivos borrados (máximo ${LIMITE_ARCHIVOS_BORRADOS})` }
  return { masiva: false }
}

export function contarCambios(nameStatus: string): { archivos: string[]; modificados: number; borrados: number } {
  const archivos: string[] = []
  let modificados = 0
  let borrados = 0
  for (const linea of nameStatus.split(/\r?\n/).filter(Boolean)) {
    const [estado, ...rutas] = linea.split('\t')
    if (!estado || !rutas.length) continue
    const ruta = /^[RC]/.test(estado) ? rutas[1] : rutas[0]
    if (!ruta) continue
    archivos.push(ruta)
    if (estado === 'D') borrados++
    else modificados++
  }
  return { archivos, modificados, borrados }
}

export function choques(copias: { id: string; archivos: string[] }[]): { a: string; b: string; archivos: string[] }[] {
  const resultado: { a: string; b: string; archivos: string[] }[] = []
  for (let i = 0; i < copias.length; i++) for (let j = i + 1; j < copias.length; j++) {
    const b = new Set(copias[j].archivos.map(r => r.replace(/\\/g, '/').toLowerCase()))
    const archivos = [...new Set(copias[i].archivos.filter(r => b.has(r.replace(/\\/g, '/').toLowerCase())))]
    if (archivos.length) resultado.push({ a: copias[i].id, b: copias[j].id, archivos })
  }
  return resultado
}

type ResultadoAviso = { trabajador?: string; id?: string; fuera_de_alcance?: string[]; escalar?: string[]; aviso_masiva?: string; copia?: { archivos?: string[] } }
export type EncargoAviso = { id: string; trabajoId?: string; estado: string; resultado?: ResultadoAviso }

export function textoAvisoGrupo(grupo: string, encargos: EncargoAviso[]): string {
  const resultados = encargos.map(e => e.resultado)
  const fallidos = encargos.filter(e => e.estado === 'fallido').length
  const lineas = [`[Centro de agentes MST] Terminó el grupo ${grupo} (${encargos.length} encargo(s)). Verifica cada resultado y registra su puntaje con registrar_auditoria usando el id de trabajo o el id de encargo eN:\n${JSON.stringify(resultados, null, 1)}${fallidos ? `\nFallaron ${fallidos} encargo(s).` : ''}`]
  for (const e of encargos) {
    const r = e.resultado
    const quien = r?.trabajador ?? e.id
    if (r?.fuera_de_alcance?.length) lineas.push(`ESCALADA (fuera de alcance): ${quien} tocó archivos que no eran suyos: ${r.fuera_de_alcance.join(', ')}. Revísalos antes de auditar.`)
  }
  // La carpeta compartida solo aporta nombres de estado; no tiene conteo de cambios aislados.
  for (const choque of choques(encargos.flatMap(e => e.resultado?.copia?.archivos ? [{ id: e.resultado.trabajador ?? e.id, archivos: e.resultado.copia.archivos }] : [])))
    lineas.push(`ESCALADA (choque de ramas): ${choque.a} y ${choque.b} tocaron los mismos archivos: ${choque.archivos.join(', ')}. Júntalas con cuidado, una a una.`)
  for (const e of encargos) {
    const r = e.resultado
    if (r?.escalar?.includes('masiva')) lineas.push(`ESCALADA (modificación masiva): ${r.trabajador ?? e.id}: ${r.aviso_masiva ?? 'cambio masivo'}. Revisa el cambio antes de auditar.`)
  }
  return lineas.join('\n')
}

export const INACTIVIDAD_MIN_POR_DEFECTO = 40

export function inactivo(t: { inicio: number; ultimaActividad?: number }, ahora: number, limiteMs: number): boolean {
  return ahora - (t.ultimaActividad ?? t.inicio) > limiteMs
}

export type EstadoEncargo = 'en_cola' | 'corriendo' | 'terminado' | 'fallido'
export type Encargo = { id: string; grupo: string; subtarea?: number; estado: EstadoEncargo; trabajoId?: string; resultado?: unknown; escalados: string[]; inicio: number; fin?: number }

export const FALLOS_SEGUIDOS_ESCALA = 2

const terminado = (e: Encargo) => e.estado === 'terminado' || e.estado === 'fallido'

export type RegistroGuardado = { encargos: Encargo[]; siguienteEncargo: number; siguienteGrupo: number; avisados: string[]; fallos: [number, number][] }

export class Registro {
  private encargos = new Map<string, Encargo>()
  private siguienteEncargo = 1
  private siguienteGrupo = 1
  private avisados = new Set<string>()
  private fallos = new Map<number, number>()

  // Para guardar el registro en disco y recuperarlo tras recargar el plugin (los avisos ya dados no se repiten).
  exportar(): RegistroGuardado {
    return { encargos: this.todos(), siguienteEncargo: this.siguienteEncargo, siguienteGrupo: this.siguienteGrupo, avisados: [...this.avisados], fallos: [...this.fallos] }
  }

  importar(g: RegistroGuardado | undefined): void {
    if (!g || !Array.isArray(g.encargos)) return
    this.encargos = new Map(g.encargos.map(e => [e.id, e]))
    this.siguienteEncargo = Math.max(this.siguienteEncargo, Number(g.siguienteEncargo) || 1)
    this.siguienteGrupo = Math.max(this.siguienteGrupo, Number(g.siguienteGrupo) || 1)
    this.avisados = new Set(g.avisados ?? [])
    this.fallos = new Map(g.fallos ?? [])
  }

  nuevoGrupo(): string {
    return `g${this.siguienteGrupo++}`
  }

  nuevoEncargo(a: { grupo?: string; subtarea?: number }, ahora: number): Encargo {
    const id = `e${this.siguienteEncargo++}`
    const encargo: Encargo = { id, grupo: a.grupo ?? id, estado: 'en_cola', escalados: [], inicio: ahora, ...(a.subtarea === undefined ? {} : { subtarea: a.subtarea }) }
    this.encargos.set(id, encargo)
    return encargo
  }

  marcar(id: string, estado: EstadoEncargo, extra: { trabajoId?: string; resultado?: unknown } = {}, ahora?: number): Encargo | undefined {
    const encargo = this.encargos.get(id)
    if (!encargo) return undefined
    encargo.estado = estado
    if (extra.trabajoId !== undefined) encargo.trabajoId = extra.trabajoId
    if (extra.resultado !== undefined) encargo.resultado = extra.resultado
    // Sin reloj propio: si no llega `ahora`, el fin es el inicio y el encargo dura 0.
    if (estado === 'terminado' || estado === 'fallido') encargo.fin = ahora ?? encargo.inicio
    return encargo
  }

  obtener(id: string): Encargo | undefined {
    return this.encargos.get(id)
  }

  delGrupo(grupo: string): Encargo[] {
    return this.todos().filter(e => e.grupo === grupo)
  }

  todos(): Encargo[] {
    return [...this.encargos.values()]
  }

  grupoCompleto(grupo: string): boolean {
    const encargos = this.delGrupo(grupo)
    return encargos.length > 0 && encargos.every(terminado)
  }

  avisarGrupo(grupo: string): boolean {
    if (!this.grupoCompleto(grupo) || this.avisados.has(grupo)) return false
    this.avisados.add(grupo)
    return true
  }

  escalar(id: string, motivo: string): boolean {
    const encargo = this.encargos.get(id)
    if (!encargo || encargo.escalados.includes(motivo)) return false
    encargo.escalados.push(motivo)
    return true
  }

  registrarFin(subtarea: number | undefined, exito: boolean): number {
    if (subtarea === undefined) return 0
    if (exito) { this.fallos.set(subtarea, 0); return 0 }
    const total = (this.fallos.get(subtarea) ?? 0) + 1
    this.fallos.set(subtarea, total)
    return total
  }
}

export function resumenEstado(es: Encargo[], ahora: number): { id: string; grupo: string; subtarea?: number; estado: EstadoEncargo; segundos: number; trabajoId?: string; resultado?: unknown }[] {
  return es.map(e => ({
    id: e.id,
    grupo: e.grupo,
    ...(e.subtarea === undefined ? {} : { subtarea: e.subtarea }),
    estado: e.estado,
    segundos: Math.round(((e.fin ?? ahora) - e.inicio) / 1000),
    ...(e.trabajoId === undefined ? {} : { trabajoId: e.trabajoId }),
    ...(terminado(e) && e.resultado !== undefined ? { resultado: e.resultado } : {}),
  }))
}

export const AMARILLO_MS_POR_DEFECTO = 10 * 60_000

export type TrabajoVivo = { id: string; trabajador: string; estado: string; inicio: number; ultimaActividad?: number; subtarea?: number; tarea?: string }
export type FilaViva = { id: string; agente: string; modelo: string; subtarea?: number; tarea?: string; trabajandoMs: number; sinSenalMs: number; amarillo: boolean }

export function filasVivas(trabajos: TrabajoVivo[], ahora: number, umbralMs = AMARILLO_MS_POR_DEFECTO): FilaViva[] {
  return trabajos.filter(t => t.estado === 'corriendo').sort((a, b) => a.inicio - b.inicio).map(t => {
    const [agente, ...resto] = t.trabajador.split(':')
    const nombreModelo = resto.join(':')
    const sinSenalMs = Math.max(0, ahora - (t.ultimaActividad ?? t.inicio))
    return {
      id: t.id, agente, modelo: nombreModelo.split('/').at(-1) ?? '',
      ...(t.subtarea === undefined ? {} : { subtarea: t.subtarea }),
      ...(t.tarea === undefined ? {} : { tarea: t.tarea }),
      trabajandoMs: ahora - t.inicio, sinSenalMs, amarillo: sinSenalMs > umbralMs,
    }
  })
}

export function duracionCorta(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return '0 s'
  const segundos = Math.floor(ms / 1000)
  if (segundos < 60) return `${segundos} s`
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `${minutos} min`
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`
}

type ResumenGrupo = { grupo: string; encargos: Encargo[]; listos: number }
function gruposActivos(encargos: Encargo[]): ResumenGrupo[] {
  const grupos = new Map<string, Encargo[]>()
  for (const e of encargos) grupos.set(e.grupo, [...(grupos.get(e.grupo) ?? []), e])
  return [...grupos].map(([grupo, es]) => ({
    grupo, encargos: es,
    listos: es.filter(e => e.estado === 'terminado' || e.estado === 'fallido').length,
  })).filter(g => g.listos < g.encargos.length && !(g.encargos.length === 1 && g.grupo === g.encargos[0].id))
}

export function textoBarra(trabajos: TrabajoVivo[], encargos: Encargo[], ahora: number, umbralMs = AMARILLO_MS_POR_DEFECTO): string {
  const filas = filasVivas(trabajos, ahora, umbralMs)
  const cola = encargos.filter(e => e.estado === 'en_cola').length
  const grupos = gruposActivos(encargos)
  if (!filas.length && !cola && !grupos.length) return ''
  const amarillos = filas.filter(f => f.amarillo).length
  const partes = [`${amarillos ? '⚠' : '⚙'} ${filas.length ? `${filas.length} trabajando` : 'en espera'}`]
  if (cola) partes.push(`${cola} en cola`)
  for (const g of grupos.slice(0, 2)) partes.push(`${g.grupo}: ${g.listos}/${g.encargos.length} listos`)
  if (grupos.length > 2) partes.push(`+${grupos.length - 2} grupos`)
  if (amarillos) partes.push(`⚠ ${amarillos} sin señal`)
  return partes.join(' · ')
}

// Con el panel cerrado a mano, la barra dice al final cómo volver a abrirlo (sin texto de barra no hay dónde ponerlo).
export function pistaPanel(texto: string, cerrado: boolean): string {
  return cerrado && texto ? `${texto} · /centro-panel abre el panel` : texto
}

export function textoEstado(trabajos: TrabajoVivo[], encargos: Encargo[], ahora: number, umbralMs = AMARILLO_MS_POR_DEFECTO, escaladaMin = 40): string {
  const filas = filasVivas(trabajos, ahora, umbralMs)
  const cola = encargos.filter(e => e.estado === 'en_cola').length
  const grupos = gruposActivos(encargos)
  const amarillos = filas.filter(f => f.amarillo).length
  const lineas = [`Centro de agentes: ${textoBarra(trabajos, encargos, ahora, umbralMs) || 'nada trabajando'}`]
  for (const f of filas) lineas.push(`● ${f.agente} · ${f.modelo}${f.subtarea === undefined ? '' : ` · subtarea ${f.subtarea}`} · lleva ${duracionCorta(f.trabajandoMs)} · última señal hace ${duracionCorta(f.sinSenalMs)}${f.amarillo ? ' ⚠ sin señal desde hace tiempo' : ''}`)
  if (cola) lineas.push(`En cola: ${cola} (esperando hueco: máximo 4 agentes a la vez)`)
  for (const g of grupos) lineas.push(`Grupo ${g.grupo}: ${g.listos}/${g.encargos.length} listos`)
  if (amarillos) lineas.push(`Aviso: ${amarillos} agente(s) llevan más de ${duracionCorta(umbralMs)} sin dar señales; a los ${escaladaMin} min el jefe recibe una escalada.`)
  return lineas.join('\n')
}

// Un agente sigue vivo si su lanzador dejó pid.json, aún no dejó fin.json y arrancó hace menos del margen (el tope por tarea
// es de 10 min: pasado el margen, un pid.json sin fin es de un lanzador que murió y no debe frenar nada para siempre).
export const MARGEN_AGENTE_VIVO_MS = 15 * 60_000
export function agenteVivo(pid: { inicio?: number } | undefined, hayFin: boolean, ahora: number): boolean {
  if (hayFin || typeof pid?.inicio !== 'number') return false
  return ahora - pid.inicio < MARGEN_AGENTE_VIVO_MS
}

// Un título breve para el panel: fuera la etiqueta inicial ([R6], [F1]) y el detalle tras el primer separador; nunca parte una palabra.
export function tituloCorto(t: string, maxPalabras = 6): string {
  const sinEtiqueta = t.replace(/^\s*\[[^\]]+\]\s*/, '')
  const corte = sinEtiqueta.search(/[:;]|\s—\s|\s–\s|\s\(|\.\s/)
  const base = (corte >= 0 ? sinEtiqueta.slice(0, corte) : sinEtiqueta).trim()
  const palabras = base.split(/\s+/).filter(Boolean)
  const tope = Math.max(1, maxPalabras)
  if (palabras.length <= tope) return palabras.join(' ')
  return `${palabras.slice(0, tope).join(' ')}…`
}

// Una línea compacta para un aviso del plugin: sin el prefijo del centro, hasta el primer punto o salto de línea, con tope de 90.
export function lineaAviso(texto: string): string {
  const sinPrefijo = texto.replace(/^\s*\[Centro de agentes MST\]\s*/, '')
  const primera = (sinPrefijo.split(/\r?\n/)[0] ?? '').split(/\.\s/)[0].trim().replace(/[.:]$/, '')
  const linea = `⚙ ${primera}`
  return linea.length > 90 ? `${linea.slice(0, 89)}…` : linea
}
