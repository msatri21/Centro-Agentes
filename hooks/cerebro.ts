// El cerebro global: lo que el centro aprendió en TODOS los chats. Cada vez que el jefe puntúa un trabajo se guarda una experiencia
// (qué se hizo, qué agente y modelo, qué nota sacó); en una tarea parecida, el jefe lo consulta y el centro prefiere a quien mejor
// lo hizo. Solo lógica pura: leer y escribir ~/.centro-agentes/cerebro.json lo hace quien lo usa (el plugin y el servidor MCP).

export type Experiencia = {
  en: number
  area: string // la categoría con la que se repartió (css, javascript, tests...)
  tarea: string // de qué iba, en corto
  agente: string
  modelo: string
  nota: number // 1-10, la del jefe
  ms?: number
  tokens?: number
  chat?: string
  leccion?: string // lo que anotó el jefe al auditar
}
export type Cerebro = { experiencias: Experiencia[] }
export type Recuerdo = { agente: string; modelo: string; notaMedia: number; veces: number; segundosProm?: number }

// Cuántas experiencias se guardan: las más viejas se olvidan.
export const MAX_EXPERIENCIAS = 400

const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const PARADAS = new Set('que con los las del una uno por para como pero este esta esto sus son hay ser mas muy sin sobre entre todo todos cada tiene hacer haz crea crear the and for with'.split(' '))
export const palabras = (t: string) => [...new Set(normal(String(t ?? '')).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !PARADAS.has(w)))]

// Apunta una experiencia (con la nota ya validada) y olvida las más viejas.
export function registrar(c: Cerebro, e: Experiencia): Cerebro {
  const nota = Math.max(1, Math.min(10, Math.round(e.nota)))
  return { experiencias: [...c.experiencias, { ...e, nota, tarea: e.tarea.slice(0, 200), leccion: e.leccion?.slice(0, 300) }].slice(-MAX_EXPERIENCIAS) }
}

// Qué tan parecida es una experiencia a lo que se busca: palabras en común (área y tarea) y, si coincide, el área.
function parecido(e: Experiencia, buscadas: string[], area?: string) {
  const suyas = new Set(palabras(`${e.area} ${e.tarea}`))
  return buscadas.filter(w => suyas.has(w)).length + (area && normal(area.trim()) === normal(e.area) ? 2 : 0)
}

// Lo que el cerebro recuerda de algo parecido a esto: quién lo hizo mejor y los casos más parecidos.
export function consultar(c: Cerebro, texto: string, area?: string, limite = 5) {
  const buscadas = palabras(`${texto} ${area ?? ''}`)
  const relevantes = c.experiencias.map(e => ({ e, r: parecido(e, buscadas, area) })).filter(x => x.r > 0)
  const grupos = new Map<string, Experiencia[]>()
  for (const { e } of relevantes) grupos.set(`${e.agente}:${e.modelo}`, [...(grupos.get(`${e.agente}:${e.modelo}`) ?? []), e])
  const mejores: Recuerdo[] = [...grupos.values()]
    .map(es => {
      const conTiempo = es.filter(x => x.ms !== undefined)
      return {
        agente: es[0]!.agente,
        modelo: es[0]!.modelo,
        notaMedia: Math.round((es.reduce((a, x) => a + x.nota, 0) / es.length) * 10) / 10,
        veces: es.length,
        ...(conTiempo.length ? { segundosProm: Math.round(conTiempo.reduce((a, x) => a + (x.ms ?? 0), 0) / conTiempo.length / 1000) } : {}),
      }
    })
    .sort((a, b) => b.notaMedia - a.notaMedia || b.veces - a.veces || (a.segundosProm ?? Infinity) - (b.segundosProm ?? Infinity))
  const similares = relevantes.sort((a, b) => b.r - a.r || b.e.nota - a.e.nota || b.e.en - a.e.en).slice(0, limite).map(x => x.e)
  const mejor = mejores[0]
  return {
    ...(mejor && mejor.notaMedia >= 7 ? { recomendacion: mejor } : {}),
    mejores: mejores.slice(0, 4),
    similares,
    experiencias: c.experiencias.length,
  }
}

// El agente y modelo que el centro prefiere de entrada para esta tarea (nota media de 7 o más en casos parecidos).
// Claude headless gasta del plan de Claude: solo se prefiere si sacó 9 o más.
export function recomendar(c: Cerebro, area: string, tarea: string): Recuerdo | undefined {
  const r = consultar(c, tarea, area).recomendacion
  return r && (r.agente !== 'claude' || r.notaMedia >= 9) ? r : undefined
}

// Pone primero al candidato recomendado (si está entre los posibles); el resto conserva su orden.
export function preferir<T extends { trabajador: string; modelo: string }>(candidatos: T[], r?: Recuerdo): T[] {
  if (!r) return candidatos
  const i = candidatos.findIndex(c => c.trabajador === r.agente && c.modelo === r.modelo)
  return i <= 0 ? candidatos : [candidatos[i]!, ...candidatos.filter((_, j) => j !== i)]
}
