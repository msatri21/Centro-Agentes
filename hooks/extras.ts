import type { Plan, Subtarea, Trabajo } from '../types'

export const estadoSubtareaNuevo = (e: string) => e === 'en curso' ? 'en_proceso' : e === 'hecha' ? 'solucionado' : e

// Dependencias del plan: {"3": [1, 2]} (o ese JSON como texto). Ignora números fuera del plan y las que se esperan a sí mismas.
export function leerDependencias(dep: unknown, total: number): Map<number, number[]> {
  const obj = typeof dep === 'string' ? JSON.parse(dep || '{}') : (dep ?? {})
  const valido = (n: number) => Number.isInteger(n) && n >= 1 && n <= total
  const m = new Map<number, number[]>()
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const n = Number(k)
    const espera = (Array.isArray(v) ? v : [v]).map(Number).filter(x => valido(x) && x !== n)
    if (valido(n) && espera.length) m.set(n, [...new Set(espera)])
  }
  return m
}
// Lo que aún bloquea a una subtarea: las que espera y no están hechas.
export const bloqueos = (subs: Subtarea[], n: number) =>
  (subs.find(s => s.n === n)?.espera ?? []).filter(e => subs.find(s => s.n === e)?.estado !== 'solucionado')
// Subtareas pendientes que ya se pueden lanzar a un agente: las manuales no (las hace el usuario o el jefe) y delegarlas da error.
export const listas = (subs: Subtarea[]) => subs.filter(s => s.estado === 'pendiente' && !s.manual && !bloqueos(subs, s.n).length)

// Puntajes guardados: categoría → "trabajador:modelo" → suma de notas, nº de trabajos y tiempo total.
export type Puntajes = Record<string, Record<string, { n: number; suma: number; msTotal: number }>>
export type Rendimiento = { quien: string; media: number; n: number; segundos: number }

// Rendimiento de cada trabajador:modelo sumando todas las categorías (media ponderada por nº de trabajos).
// Ordena primero los más usados y, a igual uso, los de mejor nota.
export function agregarRendimiento(tabla: Puntajes, max = 10): Rendimiento[] {
  const acc = new Map<string, { n: number; suma: number; ms: number }>()
  for (const fila of Object.values(tabla))
    for (const [quien, c] of Object.entries(fila)) {
      const a = acc.get(quien) ?? { n: 0, suma: 0, ms: 0 }
      acc.set(quien, { n: a.n + c.n, suma: a.suma + c.suma, ms: a.ms + c.msTotal })
    }
  return [...acc]
    .filter(([, a]) => a.n > 0)
    .map(([quien, a]) => ({ quien, media: Math.round((a.suma / a.n) * 10) / 10, n: a.n, segundos: Math.round(a.ms / a.n / 1000) }))
    .sort((x, y) => y.n - x.n || y.media - x.media)
    .slice(0, max)
}

const seg = (ms = 0) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.round(ms / 1000)} s`)
const celda = (t: string) => t.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

// El informe final de un chat, en Markdown: qué se pidió, quién hizo cada parte, con qué nota y cuánto costó.
export function informeMarkdown(d: { chat: string; plan: Plan | null; trabajos: Trabajo[]; ahorro: number; fecha: string }): string {
  const subs = d.plan?.subtareas ?? []
  const hechas = subs.filter(s => s.estado === 'solucionado').length
  const terminados = d.trabajos.filter(t => t.ms !== undefined)
  const tokIn = terminados.reduce((a, t) => a + (t.tokensIn ?? 0), 0)
  const tokOut = terminados.reduce((a, t) => a + (t.tokensOut ?? 0), 0)
  const gastoClaude = terminados.filter(t => t.trabajador.startsWith('claude:')).reduce((a, t) => a + (t.costo ?? 0), 0)
  const lineas = [
    `# Informe del Centro de agentes MST`,
    '',
    `- **Chat:** ${d.chat}`,
    `- **Fecha:** ${d.fecha}`,
    `- **Objetivo:** ${d.plan?.objetivo ?? '(sin plan)'}`,
    `- **Progreso:** ${hechas} de ${subs.length} subtareas hechas`,
    `- **Tokens de los agentes:** ${tokIn.toLocaleString('es')} leídos, ${tokOut.toLocaleString('es')} escritos`,
    `- **Ahorro estimado frente a Claude Sonnet 5.5:** $${d.ahorro.toFixed(2)}${gastoClaude ? ` (gastado en Claude headless: $${gastoClaude.toFixed(2)})` : ''}`,
    '',
  ]
  if (subs.length) {
    lineas.push('## Subtareas', '', '| # | Subtarea | Estado | Quién | Nota |', '|---|---|---|---|---|')
    for (const s of subs) lineas.push(`| ${s.n} | ${celda(s.titulo)} | ${s.estado} | ${celda(s.quien ?? '')} | ${s.puntaje !== undefined ? `${s.puntaje}/10` : ''} |`)
    lineas.push('')
  }
  if (terminados.length) {
    lineas.push('## Trabajos', '', '| Agente y modelo | Subtarea | Resultado | Tiempo | Tokens | Nota | Skills |', '|---|---|---|---|---|---|---|')
    for (const t of terminados)
      lineas.push(
        `| ${celda(t.trabajador)} | ${t.subtarea ?? ''} | ${t.estado === 'error' ? 'falló' : 'terminado'} | ${seg(t.ms)} | ${t.tokensIn !== undefined ? `${t.tokensIn}→${t.tokensOut ?? 0}` : ''} | ${t.puntaje !== undefined ? `${t.puntaje}/10` : ''} | ${celda((t.skills ?? []).join(', '))} |`,
      )
    lineas.push('')
  }
  const rehechos = terminados.filter(t => t.puntaje !== undefined && t.puntaje < 6)
  if (rehechos.length) lineas.push(`**Se rehicieron ${rehechos.length} trabajo(s)** que no pasaron la verificación (nota menor de 6).`, '')
  return lineas.join('\n')
}

// Aider escribe texto plano: avisos de arranque, su razonamiento (► THINKING), la respuesta (► ANSWER),
// una línea "Tokens: 746 sent, 158 received." y lo que aplicó ("Applied edit to x").
const RUIDO_AIDER = /^(Can't initialize prompt toolkit|cmd\.exe\?|Aider v|Model:|Git repo:|Repo-map:|https:\/\/aider\.chat|-{6,})/
const numAider = (t: string) => (t.endsWith('k') ? Math.round(parseFloat(t) * 1000) : Number(t))
export function leerAider(stdout: string): { texto: string; tokensIn?: number; tokensOut?: number } {
  const limpio = stdout.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  const t = limpio.match(/Tokens:\s*([\d.]+k?)\s*sent,\s*([\d.]+k?)\s*received/)
  const respuesta = limpio.split(/►\s*\*\*ANSWER\*\*/).pop() ?? limpio
  const texto = respuesta
    .split(/\r?\n/)
    .filter(l => !RUIDO_AIDER.test(l.trim()) && !/^Tokens:/.test(l.trim()))
    .join('\n')
    .trim()
  return { texto, tokensIn: t ? numAider(t[1]) : undefined, tokensOut: t ? numAider(t[2]) : undefined }
}

// Un tema de ntfy.sh válido: es la "dirección" del aviso; cualquiera que la sepa puede leerlo, así que mejor larga.
export const temaNtfyValido = (t: string) => /^[\w-]{8,64}$/.test(t)
