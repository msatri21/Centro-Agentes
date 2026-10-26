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

export class Registro {
  private encargos = new Map<string, Encargo>()
  private siguienteEncargo = 1
  private siguienteGrupo = 1
  private avisados = new Set<string>()
  private fallos = new Map<number, number>()

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
