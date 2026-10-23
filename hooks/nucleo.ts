// Piezas puras del centro: leer la salida de cada agente, ordenar modelos por su historial y reconocer errores.
// Las usan el plugin de Claude Code (register.tsx) y el servidor MCP para usar OpenCode como jefe (mcp/centro-mcp.mjs).
import type { Trabajador } from '../types'

export type Celda = { n: number; suma: number; msTotal: number }
export type Puntajes = Record<string, Record<string, Celda>>

export type Salida = { texto: string; tokensIn?: number; tokensOut?: number; ventana?: number; costo?: number }

// Un "trabajador" del ranking es trabajador:modelo (o solo trabajador si usa el modelo por defecto).
export const clave = (t: Trabajador, modelo?: string) => (modelo ? `${t}:${modelo}` : t)

export const sinAnsi =(s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

// claude -p --output-format json: un objeto con result, usage y modelUsage.
// claude -p --output-format stream-json: un evento por línea; el último, type "result", trae resultado y uso.
export function leerClaude(stdout: string): Salida {
  try {
    const lineas = stdout.split(/\r?\n/).filter(l => l.trim())
    const ultima = [...lineas].reverse().find(l => l.includes('"type":"result"')) ?? stdout
    const j = JSON.parse(ultima)
    const u = j.usage ?? {}
    const m = Object.values(j.modelUsage ?? {})[0] as { contextWindow?: number } | undefined
    return {
      texto: String(j.result ?? ''),
      tokensIn: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tokensOut: u.output_tokens ?? 0,
      ventana: m?.contextWindow,
      costo: j.total_cost_usd,
    }
  } catch {
    return { texto: stdout }
  }
}

// ollama run --verbose: estadísticas al final de stderr.
export function leerOllama(stdout: string, stderr: string): Salida {
  const s = sinAnsi(stderr)
  const num = (re: RegExp) => {
    const m = s.match(re)
    return m ? Number(m[1]) : undefined
  }
  return { texto: sinAnsi(stdout), tokensIn: num(/prompt eval count:\s*(\d+)/), tokensOut: num(/(?:^|\n)eval count:\s*(\d+)/) }
}

// opencode run --format json: un evento JSON por línea.
// hermes chat --format stream-json: eventos "text" mientras escribe y un "result" final con exit_code y tokens.
export function leerHermes(stdout: string): Salida & { exitCode?: number } {
  let texto = ''
  let fin: any
  for (const linea of stdout.split(/\r?\n/)) {
    if (!linea.trim()) continue
    try {
      const ev = JSON.parse(linea)
      if (ev.type === 'text') texto += ev.text ?? ''
      else if (ev.type === 'result') fin = ev
      else if (ev.type === 'error') texto += `\n[error] ${ev.message ?? ev.error ?? 'desconocido'}`
    } catch {}
  }
  const t = fin?.tokens ?? {}
  return {
    texto: String(fin?.text ?? texto).trim(),
    tokensIn: fin ? (t.input ?? 0) + (t.cache_read ?? 0) + (t.cache_write ?? 0) : undefined,
    tokensOut: fin ? (t.output ?? 0) : undefined,
    exitCode: fin?.exit_code,
  }
}

export function leerOpencode(stdout: string): Salida {
  let texto = ''
  let tokensIn = 0
  let tokensOut = 0
  let costo = 0
  for (const linea of stdout.split(/\r?\n/)) {
    if (!linea.trim()) continue
    let ev: any
    try {
      ev = JSON.parse(linea)
    } catch {
      texto += linea + '\n'
      continue
    }
    if (ev.type === 'text') texto += (ev.part?.text ?? '') + '\n'
    else if (ev.type === 'error') texto += `[error] ${ev.error?.data?.message ?? ev.error?.name ?? 'desconocido'}\n`
    else if (ev.type === 'step_finish') {
      const t = ev.part?.tokens ?? {}
      tokensIn += (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)
      tokensOut += (t.output ?? 0) + (t.reasoning ?? 0)
      costo += ev.part?.cost ?? 0
    }
  }
  return { texto: texto.trim(), tokensIn, tokensOut, costo }
}

// Errores que indican que la red o el proxy bloquean, no que el modelo lo hizo mal.
const ERROR_DE_RED = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|tunneling socket|proxy authentication|\b407\b|self[- ]signed certificate|unable to (get|verify) (local )?issuer|UNABLE_TO_VERIFY|CERT_HAS_EXPIRED|certificate verify failed|network is unreachable|connection (refused|reset|timed out)|dial tcp|i\/o timeout|fetch failed|Connection error|Cannot connect to API|Unable to connect/i
export const esErrorDeRed = (texto: string) => ERROR_DE_RED.test(texto)
// Errores de cuenta (clave caducada o no válida): no se arreglan solos, hay que renovar la clave.
export const esErrorDeCuenta = (texto: string) =>
  /api key has expired|invalid api key|api key (is )?(invalid|revoked)|unauthorized|\b401\b|authentication failed|not authenticated|not logged in|please log ?in/i.test(texto)

// Lo que se ve en la terminal de cada agente: su texto legible, no el JSON de sus eventos.
// codex exec --json: un evento por línea. Lo que dice va en item.completed de tipo agent_message,
// los comandos que ejecuta en command_execution y el uso de tokens en turn.completed.
export function leerCodex(stdout: string): Salida {
  const mensajes: string[] = []
  let tokensIn: number | undefined
  let tokensOut: number | undefined
  for (const linea of stdout.split(/\r?\n/)) {
    if (!linea.trim()) continue
    try {
      const ev = JSON.parse(linea)
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') mensajes.push(ev.item.text ?? '')
      else if (ev.type === 'turn.completed') {
        tokensIn = (tokensIn ?? 0) + (ev.usage?.input_tokens ?? 0)
        tokensOut = (tokensOut ?? 0) + (ev.usage?.output_tokens ?? 0) + (ev.usage?.reasoning_output_tokens ?? 0)
      } else if (ev.type === 'error' || ev.type === 'turn.failed') mensajes.push(`[error] ${ev.message ?? ev.error?.message ?? 'desconocido'}`)
    } catch {}
  }
  return { texto: mensajes.join('\n').trim(), tokensIn, tokensOut }
}

export function vistaDe(trabajador: Trabajador, stdout: string): string {
  if (trabajador === 'ollama') return sinAnsi(stdout)
  if (trabajador === 'codex')
    return stdout
      .split(/\r?\n/)
      .map(l => {
        try {
          const ev = JSON.parse(l)
          if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') return ev.item.text
          if (ev.type === 'item.started' && ev.item?.type === 'command_execution') return `› ${String(ev.item.command).replace(/^"[^"]*powershell\.exe"\s+-Command\s+/i, '')}`
        } catch {}
        return ''
      })
      .filter(Boolean)
      .join('\n')
  if (trabajador === 'opencode') return leerOpencode(stdout).texto
  if (trabajador === 'aider') return sinAnsi(stdout)
  if (trabajador === 'hermes')
    return stdout
      .split(/\r?\n/)
      .map(l => {
        try {
          const ev = JSON.parse(l)
          return ev.type === 'text' ? ev.text : ev.type === 'tool' || ev.tool || ev.name ? `\n› ${ev.tool ?? ev.name}\n` : ''
        } catch {
          return ''
        }
      })
      .join('')
  const partes: string[] = []
  for (const linea of stdout.split(/\r?\n/)) {
    try {
      const ev = JSON.parse(linea)
      if (ev.type === 'assistant')
        for (const b of ev.message?.content ?? []) {
          if (b.type === 'text') partes.push(b.text)
          else if (b.type === 'tool_use') partes.push(`› ${b.name}`)
        }
    } catch {}
  }
  return partes.join('\n')
}

// Lo que habría costado con Claude Sonnet 5.5 ($2 entrada / $10 salida por millón; precios oficiales al 6-oct-2026).
// shortcut: cuenta toda la entrada a precio normal aunque parte fuera caché (más barata); sobreestima algo el ahorro.
export const costoComoClaude = (tokIn = 0, tokOut = 0) => (tokIn * 2 + tokOut * 10) / 1_000_000

// --- Autoactualización: cuándo vale la pena buscar una versión nueva ---

// Las sesiones cargan la copia instalada en la caché de plugins de Claude Code; cargado desde otra carpeta (desarrollo) no hay nada que actualizar.
export const enCacheDePlugins = (raiz: string) => /[\\/]\.claude[\\/]plugins[\\/]cache[\\/]/.test(raiz)
// Buscar en internet en cada sesión sería lento y pesado: como mucho una vez cada 6 horas.
export const BUSCAR_ACTUALIZACION_CADA_MS = 6 * 60 * 60 * 1000
export const debeBuscarActualizacion = (raiz: string, ultima: number | undefined, ahora: number) =>
  enCacheDePlugins(raiz) && (ultima === undefined || !Number.isFinite(ultima) || ahora - ultima >= BUSCAR_ACTUALIZACION_CADA_MS)

export type Candidato = { trabajador: Trabajador; modelo: string }

// Un modelo sin probar vale PREVIO: gana a uno que rinde mal y pierde contra uno bueno, así el centro explora solo.
const PREVIO = 6.5
// Claude headless gasta del plan de Claude: solo gana si rinde claramente mejor que los gratis.
const RECARGO_CLAUDE = 1.5
export function ordenar(tabla: Puntajes, categoria: string, candidatos: Candidato[], excluidos: Set<string>): Candidato[] {
  const fila = tabla[categoria] ?? {}
  const nota = (c: Candidato) => {
    const celda = fila[clave(c.trabajador, c.modelo)]
    return (celda && celda.n > 0 ? celda.suma / celda.n : PREVIO) - (c.trabajador === 'claude' ? RECARGO_CLAUDE : 0)
  }
  return candidatos
    .map((c, i) => ({ c, i, n: nota(c) }))
    .filter(x => !excluidos.has(clave(x.c.trabajador, x.c.modelo)))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(x => x.c)
}

// --- Carpeta compartida: varios agentes en la misma rama sin pisarse ---

// Dos rutas chocan si son la misma o una cuelga de la otra ("src/" choca con "src/a.py"); "*" choca con todo.
const norma = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
export function chocan(a: string, b: string): boolean {
  const x = norma(a)
  const y = norma(b)
  return x === '*' || y === '*' || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}

// Cerrojos por archivo y carpeta de trabajo. Quien pide archivos que otro tiene espera su turno (en orden de llegada);
// quien toca archivos distintos entra al momento. Sin archivos declarados se toma "*": espera a todos y todos le esperan.
export class Cerrojos {
  private tomados = new Map<string, { id: number; archivos: string[] }[]>()
  private esperando = new Map<string, { id: number; archivos: string[]; listo: () => void }[]>()
  private siguiente = 0

  private libre(carpeta: string, archivos: string[]) {
    return !(this.tomados.get(carpeta) ?? []).some(t => t.archivos.some(a => archivos.some(b => chocan(a, b))))
  }

  // Quién tuvo qué y cuándo (desde que entró hasta que soltó), para saber qué archivos eran de otros durante el trabajo de uno.
  private historia: { carpeta: string; id: number; archivos: string[]; desde: number; hasta?: number }[] = []

  // Devuelve cómo soltar el cerrojo; el id y el momento de entrada van en la propia función.
  async tomar(carpeta: string, archivos?: string[]): Promise<(() => void) & { id: number; desde: number }> {
    const mios = archivos?.length ? archivos : ['*']
    const id = this.siguiente++
    // Se respeta el orden: si alguien que llegó antes espera por algo que choca con esto, este también espera.
    const antes = (this.esperando.get(carpeta) ?? []).some(w => w.archivos.some(a => mios.some(b => chocan(a, b))))
    if (antes || !this.libre(carpeta, mios)) await new Promise<void>(listo => this.esperando.set(carpeta, [...(this.esperando.get(carpeta) ?? []), { id, archivos: mios, listo }]))
    else this.tomados.set(carpeta, [...(this.tomados.get(carpeta) ?? []), { id, archivos: mios }])
    const desde = Date.now()
    this.historia = this.historia.filter(h => h.hasta === undefined || desde - h.hasta < 3_600_000)
    this.historia.push({ carpeta, id, archivos: mios, desde })
    const soltar = () => {
      const h = this.historia.find(x => x.id === id)
      if (h) h.hasta = Date.now()
      this.tomados.set(carpeta, (this.tomados.get(carpeta) ?? []).filter(t => t.id !== id))
      this.despertar(carpeta)
    }
    return Object.assign(soltar, { id, desde })
  }

  private despertar(carpeta: string) {
    const cola = this.esperando.get(carpeta) ?? []
    const resto: typeof cola = []
    for (const w of cola) {
      const bloqueadoPorOtroEnCola = resto.some(r => r.archivos.some(a => w.archivos.some(b => chocan(a, b))))
      if (!bloqueadoPorOtroEnCola && this.libre(carpeta, w.archivos)) {
        // Se reserva ya, antes de despertar, para que otro que llegue entre medias no se le adelante.
        this.tomados.set(carpeta, [...(this.tomados.get(carpeta) ?? []), { id: w.id, archivos: w.archivos }])
        w.listo()
      } else resto.push(w)
    }
    this.esperando.set(carpeta, resto)
  }

  // Los archivos de los demás que trabajaron en la carpeta a la vez que yo (desde que entré), hayan terminado ya o no.
  deOtros(carpeta: string, miId: number, desde: number) {
    return this.historia.filter(h => h.carpeta === carpeta && h.id !== miId && (h.hasta === undefined || h.hasta >= desde)).flatMap(h => h.archivos)
  }
}

// Archivos modificados según `git status --porcelain` (nuevos, cambiados o borrados), sin las comillas de git.
export function archivosCambiados(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .map(l => l.slice(3).trim().replace(/^"|"$/g, '').replace(/^.* -> /, ''))
    .filter(Boolean)
}

// Lo que cambió un agente fuera de lo que tenía permitido: lo nuevo respecto a antes de empezar, que ni era suyo ni de otro que trabajaba a la vez.
export function fueraDeAlcance(antes: string[], despues: string[], suyos: string[], deOtros: string[]): string[] {
  if (suyos.includes('*')) return []
  const ya = new Set(antes.map(norma))
  return despues.filter(f => !ya.has(norma(f)) && !suyos.some(s => chocan(s, f)) && !deOtros.some(o => chocan(o, f)))
}
