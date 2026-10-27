export type Agente = 'ollama' | 'opencode' | 'hermes' | 'aider' | 'codex' | 'claude'
export type Capacidad = 'imagen' | 'herramientas' | 'razonamiento'
export const CAPACIDADES: readonly Capacidad[] = ['imagen', 'herramientas', 'razonamiento']
export type Origen = 'ollama' | 'models.dev' | 'plugin'
export type Capacidades = Partial<Record<Capacidad, boolean>>
export type EntradaModelo = { agente: Agente; modelo: string; capacidades: Capacidades; contexto?: number; origen?: Origen; verificado?: string }
export type Fuente = { nombre: string; ok: boolean; fecha: string; nota?: string }
export type Catalogo = { version: 1; generado: string; huella: string; modelos: EntradaModelo[]; fuentes: Fuente[] }
export type ModelosPorAgente = Record<Agente, string[]>
export const CADUCA_MS = 24 * 60 * 60 * 1000

export function huellaDeModelos(m: ModelosPorAgente): string {
  const pares = (Object.keys(m) as Agente[]).flatMap(agente => m[agente].map(modelo => `${agente}:${modelo}`)).sort()
  let hash = 0x811c9dc5
  for (const byte of pares.join('|')) hash = Math.imul(hash ^ byte.charCodeAt(0), 0x01000193) >>> 0
  return hash.toString(16)
}

export function caducado(c: Catalogo | undefined, ahora: number, huella: string): boolean {
  if (!c || c.huella !== huella) return true
  const generado = Date.parse(c.generado)
  return !Number.isFinite(generado) || ahora - generado > CADUCA_MS
}

export function modeloOllamaDe(agente: Agente, modelo: string): string | undefined {
  if (agente === 'ollama') return modelo
  const prefijos: Partial<Record<Agente, string>> = { aider: 'ollama_chat/', hermes: 'ollama-local/', opencode: 'ollama/', codex: 'ollama/' }
  const prefijo = prefijos[agente]
  return prefijo && modelo.startsWith(prefijo) ? modelo.slice(prefijo.length) : undefined
}

export function leerOllamaShow(texto: string): { capacidades: Capacidades; contexto?: number } {
  const lineas = texto.split(/\r?\n/)
  let seccion = ''
  let capacidadesInicio = false
  const capacidades = new Set<string>()
  let contexto: number | undefined
  for (const linea of lineas) {
    const titulo = /^  (Model|Capabilities)\s*$/.exec(linea)
    if (titulo) { seccion = titulo[1]; if (seccion === 'Capabilities') capacidadesInicio = true; continue }
    const contextoCampo = /^    context\s+length\s+(\d+)\s*$/.exec(linea)
    const capacidad = /^    (completion|thinking|tools|vision)\s*$/.exec(linea)
    if (seccion === 'Model' && contextoCampo) {
      const n = Number(contextoCampo[1])
      if (Number.isFinite(n)) contexto = n
    } else if (seccion === 'Capabilities' && capacidad) capacidades.add(capacidad[1])
  }
  if (!capacidadesInicio) return { capacidades: {}, ...(contexto === undefined ? {} : { contexto }) }
  return { capacidades: { imagen: capacidades.has('vision'), herramientas: capacidades.has('tools'), razonamiento: capacidades.has('thinking') }, ...(contexto === undefined ? {} : { contexto }) }
}

const esObjeto = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
export function desdeModelsDev(entrada: unknown): { capacidades: Capacidades; contexto?: number } {
  if (!esObjeto(entrada)) return { capacidades: {} }
  const capacidades: Capacidades = {}
  if (esObjeto(entrada.modalities) && Array.isArray(entrada.modalities.input)) capacidades.imagen = entrada.modalities.input.includes('image')
  if (typeof entrada.tool_call === 'boolean') capacidades.herramientas = entrada.tool_call
  if (typeof entrada.reasoning === 'boolean') capacidades.razonamiento = entrada.reasoning
  const contexto = esObjeto(entrada.limit) && typeof entrada.limit.context === 'number' ? entrada.limit.context : undefined
  return { capacidades, ...(contexto === undefined ? {} : { contexto }) }
}

export function tablaDelPlugin(agente: Agente, modelo: string): { capacidades: Capacidades; contexto?: number } | undefined {
  if (agente === 'claude' && ['haiku', 'sonnet', 'opus'].includes(modelo)) return { capacidades: { imagen: true, herramientas: true } }
  if (agente === 'codex' && modelo === 'chatgpt') return { capacidades: { imagen: true, herramientas: true } }
  return undefined
}

export function construir(modelos: ModelosPorAgente, datos: { ollama?: Record<string, { capacidades: Capacidades; contexto?: number }>; modelsDev?: Record<string, unknown> }, ahora: number, fuentes: Fuente[]): Catalogo {
  const entradas: EntradaModelo[] = []
  const vistos = new Set<string>()
  const verificado = new Date(ahora).toISOString().slice(0, 10)
  for (const agente of Object.keys(modelos) as Agente[]) for (const modelo of modelos[agente]) {
    const id = `${agente}:${modelo}`
    if (vistos.has(id)) continue
    vistos.add(id)
    let dato: { capacidades: Capacidades; contexto?: number } | undefined
    let origen: Origen | undefined
    const nombreOllama = modeloOllamaDe(agente, modelo)
    if (nombreOllama !== undefined && datos.ollama?.[nombreOllama]) { dato = datos.ollama[nombreOllama]; origen = 'ollama' }
    else if (agente === 'opencode' && modelo.startsWith('opencode/')) {
      const idDev = modelo.slice('opencode/'.length)
      if (datos.modelsDev?.[idDev] !== undefined) {
        const dev = desdeModelsDev(datos.modelsDev[idDev])
        if (Object.keys(dev.capacidades).length) { dato = dev; origen = 'models.dev' }
      }
    }
    if (!dato) { dato = tablaDelPlugin(agente, modelo); if (dato) origen = 'plugin' }
    entradas.push({ agente, modelo, capacidades: dato?.capacidades ?? {}, ...(dato?.contexto === undefined ? {} : { contexto: dato.contexto }), ...(origen ? { origen } : {}), verificado })
  }
  return { version: 1, generado: new Date(ahora).toISOString(), huella: huellaDeModelos(modelos), modelos: entradas, fuentes }
}

export function entradaDe(c: Catalogo | undefined, agente: Agente, modelo: string): EntradaModelo | undefined {
  return c?.modelos.find(e => e.agente === agente && e.modelo === modelo) ?? (() => { const dato = tablaDelPlugin(agente, modelo); return dato ? { agente, modelo, capacidades: dato.capacidades, origen: 'plugin' } : undefined })()
}

// La palabra sola no basta: un verbo de ver/leer tiene que ir en la misma frase, y los compuestos o rutas (og-image, hero.webp, public/img/foo.jpg) no cuentan.
const PALABRA_IMAGEN = /(?<![\w./\\-])(?:imagen(?:es)?|images?|png|jpe?g|gif|webp|bmp|tiff)(?![\w/\\-]|\.\w)/
const VERBO_VER = /\b(?:analiz\w*|describ\w*|transcrib\w*|mir(?:a|ar|e|ando)|lee|leer|leen|lees|leyendo|interpret\w*|extrae\w*\s+(?:el\s+)?texto\s+de|que\s+hay\s+en|what\s+is\s+in|read|reads|reading|look\s+at|analy[sz]\w*|extract\s+text)\b/

export function detectarNecesidades(texto: string, categoria?: string): Capacidad[] {
  const normal = `${texto} ${categoria ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/^(?:imagen(?:es)?|images?|vision|ocr)$/.test((categoria ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim())) return ['imagen']
  const sinNoImagen = normal.replace(/\b(?:imagen(?:es)?\s+de\s+docker|docker\s+images?|imagen\s+de\s+contenedor|container\s+image|imagen\s+base|imagen\s+iso|imagen\s+del\s+sistema|imagen\s+de\s+disco)\b/g, ' ')
  if (/\b(?:capturas?\s+de\s+pantalla|screenshots?|pantallazos?|fotos?|photos?|fotografias?|ocr|escane(?:o|ado|ar))\b/.test(sinNoImagen)) return ['imagen']
  return sinNoImagen.split(/[.!?;]+(?=\s|$)|\n+/).some(frase => VERBO_VER.test(frase) && PALABRA_IMAGEN.test(frase)) ? ['imagen'] : []
}

export function filtrarPorCapacidad<T extends { trabajador: string; modelo: string }>(candidatos: T[], c: Catalogo | undefined, necesita: Capacidad[]): { aptos: T[]; excluidos: { candidato: T; motivo: 'no_la_tiene' | 'desconocido' }[] } {
  if (!necesita.length) return { aptos: [...candidatos], excluidos: [] }
  const aptos: T[] = [], excluidos: { candidato: T; motivo: 'no_la_tiene' | 'desconocido' }[] = []
  for (const candidato of candidatos) {
    const entrada = entradaDe(c, candidato.trabajador as Agente, candidato.modelo)
    const ausente = necesita.find(cap => entrada?.capacidades[cap] !== true)
    if (!ausente) aptos.push(candidato)
    else excluidos.push({ candidato, motivo: entrada?.capacidades[ausente] === false ? 'no_la_tiene' : 'desconocido' })
  }
  return { aptos, excluidos }
}

export function puntosCatalogo(e: EntradaModelo | undefined): number {
  if (!e) return 0
  return (e.capacidades.herramientas === true ? 2 : 0) + (e.capacidades.razonamiento === true ? 1 : 0) + (e.contexto === undefined ? 0 : Math.min(1.5, Math.max(0, Math.log10(e.contexto / 8000))))
}

export function consultar(c: Catalogo | undefined, filtro: { agente?: Agente; necesita?: Capacidad[] } = {}): EntradaModelo[] {
  return (c?.modelos ?? []).filter(e => (!filtro.agente || e.agente === filtro.agente) && (filtro.necesita ?? []).every(cap => e.capacidades[cap] === true))
}

export type FilaModelo = { agente: Agente; modelo: string; imagen: 'si' | 'no' | 'desconocido'; herramientas: 'si' | 'no' | 'desconocido'; razonamiento: 'si' | 'no' | 'desconocido'; contexto?: number; origen?: Origen; verificado?: string; nota_media?: number; veces?: number }

// Las notas viven por categoría; la tabla del panel las quiere por modelo, así que se suman aquí y no en la vista.
export function filasModelos(c: Catalogo | undefined, tabla: Record<string, Record<string, { n: number; suma: number }>>): FilaModelo[] {
  const estado = (v: boolean | undefined): 'si' | 'no' | 'desconocido' => v === true ? 'si' : v === false ? 'no' : 'desconocido'
  return (c?.modelos ?? []).map(e => {
    const clave = `${e.agente}:${e.modelo}`
    let n = 0
    let suma = 0
    for (const categoria of Object.values(tabla)) {
      const fila = categoria[clave]
      if (!fila) continue
      n += fila.n
      suma += fila.suma
    }
    return {
      agente: e.agente,
      modelo: e.modelo,
      imagen: estado(e.capacidades.imagen),
      herramientas: estado(e.capacidades.herramientas),
      razonamiento: estado(e.capacidades.razonamiento),
      contexto: e.contexto,
      origen: e.origen,
      verificado: e.verificado,
      ...(n ? { nota_media: Math.round(suma / n * 10) / 10, veces: n } : {}),
    }
  })
}

const marca = (valor: boolean | undefined, nombre: Capacidad) => `${valor === true ? '✓' : valor === false ? '✗' : '?'}${nombre}`
const abreviar = (n: number) => n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M`.replace('.0M', 'M') : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
export function textoCatalogo(c: Catalogo | undefined, filtro: { agente?: Agente } = {}): string {
  if (!c) return 'Aún no hay catálogo'
  const lineas = [`Catálogo generado: ${c.generado}`]
  for (const e of c.modelos) if (!filtro.agente || e.agente === filtro.agente) lineas.push(`${e.agente}: ${e.modelo} ${CAPACIDADES.map(cap => marca(e.capacidades[cap], cap)).join(' ')}${e.contexto === undefined ? '' : ` ${abreviar(e.contexto)}`}${e.origen ? ` (${e.origen})` : ''}`)
  for (const f of c.fuentes) if (!f.ok) lineas.push(`Fuente ${f.nombre} falló${f.nota ? `: ${f.nota}` : ''}`)
  return lineas.join('\n')
}
