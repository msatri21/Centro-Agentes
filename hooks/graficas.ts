// Gráficas del centro al estilo de anatomy: el mismo marco, tipografía y tonos que la figura isométrica.
// Todas salen de la lista de trabajos (los mismos datos que usan el grafo y las tablas), y solo usan grises y el vinotinto.
import type { Trabajo } from '../types'
import { figureSvg } from './anatomy/iso-kit.ts'
import { corto, marco, texto, VINO, W } from './figura.ts'
import { costoComoClaude } from './nucleo.ts'

const agenteDe = (t: Trabajo) => t.trabajador.split(':')[0]
const miles = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)))
const segs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 1000)}s`)
const rejilla = (x: number, y1: number, y2: number) => `<path class="iso-line" data-tone="faint" d="M${x.toFixed(1)} ${y1}V${y2}"/>`
const envolver = (h: number, etiqueta: string, cuerpo: string[]) => figureSvg({ width: W, height: h, label: etiqueta, body: cuerpo, standalone: true })
const vacio = (h: number, fig: string, titulo: string, pie: string, mensaje: string) =>
  envolver(h, titulo, [...marco(h, fig, titulo, pie, '—'), texto(16, 64, mensaje, 'iso-face-text', 'lo', 13, 'start')])

// Fig 2 · Tokens por agente: lo que leyó (gris) y lo que escribió (vinotinto) cada uno.
export function graficaTokens(trabajos: Trabajo[]): string {
  const por = new Map<string, { entra: number; sale: number; n: number }>()
  for (const t of trabajos) {
    if (t.tokensIn === undefined && t.tokensOut === undefined) continue
    const a = por.get(agenteDe(t)) ?? { entra: 0, sale: 0, n: 0 }
    por.set(agenteDe(t), { entra: a.entra + (t.tokensIn ?? 0), sale: a.sale + (t.tokensOut ?? 0), n: a.n + 1 })
  }
  const filas = [...por].sort((a, b) => b[1].entra + b[1].sale - (a[1].entra + a[1].sale))
  const h0 = 130
  if (!filas.length) return vacio(h0, 'Fig 2', 'Tokens por agente', 'LEÍDOS · ESCRITOS', 'aún no hay trabajos con tokens')
  const arriba = 56
  const alto = 34
  const x0 = 130
  const ancho = W - x0 - 150
  const h = arriba + filas.length * alto + 44
  const maximo = Math.max(...filas.map(([, a]) => a.entra + a.sale))
  const partes: string[] = [texto(16, 44, 'TOKENS (gris leídos · vinotinto escritos)', 'iso-face-text', 'mid', 10.5, 'start')]
  for (const f of [0, 0.5, 1]) {
    const x = x0 + f * ancho
    partes.push(rejilla(x, arriba - 6, h - 40), texto(x, arriba - 10, miles(maximo * f), 'iso-face-text', 'lo', 10, 'middle'))
  }
  filas.forEach(([nombre, a], i) => {
    const y = arriba + i * alto
    const le = (a.entra / maximo) * ancho
    const es = (a.sale / maximo) * ancho
    partes.push(
      texto(16, y + 19, corto(nombre, 14), 'iso-face-text', i === 0 ? 'hi' : 'mid', 12, 'start'),
      `<rect x="${x0}" y="${y + 6}" width="${Math.max(2, le).toFixed(1)}" height="16" fill="var(--anatomy-mid)"/>`,
      `<rect x="${(x0 + le).toFixed(1)}" y="${y + 6}" width="${Math.max(2, es).toFixed(1)}" height="16" class="vino-fill"/>`,
      texto(W - 16, y + 19, `${miles(a.entra)} → ${miles(a.sale)} · ${a.n} trab`, 'iso-face-text', 'lo', 10.5, 'end'),
    )
  })
  const total = filas.reduce((s, [, a]) => s + a.entra + a.sale, 0)
  return envolver(h, `Tokens por agente: ${filas.map(([n, a]) => `${n} ${a.entra + a.sale}`).join(', ')}`, [
    ...marco(h, 'Fig 2', 'Tokens por agente', 'LEÍDOS · ESCRITOS', `${miles(total)} tok`),
    ...partes,
  ])
}

// Fig 4 · Línea de tiempo: una barra por trabajo, de cuándo empezó a cuándo acabó. Gris = terminó bien, vinotinto = falló o sigue en marcha.
export function graficaTiempo(trabajos: Trabajo[], ahora: number): string {
  const ultimos = [...trabajos].sort((a, b) => a.inicio - b.inicio).slice(-12)
  if (!ultimos.length) return vacio(130, 'Fig 4', 'Línea de tiempo', 'CADA TRABAJO, DE INICIO A FIN', 'aún no hay trabajos')
  const desde = Math.min(...ultimos.map(t => t.inicio))
  const hasta = Math.max(...ultimos.map(t => (t.ms !== undefined ? t.inicio + t.ms : ahora)), desde + 1000)
  const arriba = 56
  const alto = 26
  const x0 = 196
  const ancho = W - x0 - 28
  const h = arriba + ultimos.length * alto + 44
  const x = (ms: number) => x0 + ((ms - desde) / (hasta - desde)) * ancho
  const partes: string[] = [texto(16, 44, 'SEGUNDOS DESDE EL PRIMER TRABAJO', 'iso-face-text', 'mid', 10.5, 'start')]
  for (let i = 0; i <= 4; i++) {
    const f = i / 4
    partes.push(rejilla(x0 + f * ancho, arriba - 6, h - 40), texto(x0 + f * ancho, arriba - 10, segs((hasta - desde) * f), 'iso-face-text', 'lo', 10, 'middle'))
  }
  ultimos.forEach((t, i) => {
    const y = arriba + i * alto
    const fin = t.ms !== undefined ? t.inicio + t.ms : ahora
    const x1 = x(t.inicio)
    const largo = Math.max(3, x(fin) - x1)
    const marcado = t.estado !== 'listo'
    partes.push(
      texto(16, y + 16, corto(`${t.subtarea !== undefined ? `${t.subtarea} · ` : ''}${t.trabajador}`, 26), 'iso-face-text', marcado ? 'vino' : 'mid', 11, 'start'),
      t.estado === 'corriendo'
        ? `<rect x="${x1.toFixed(1)}" y="${y + 4}" width="${largo.toFixed(1)}" height="14" fill="none" stroke="${VINO}" stroke-width="1.5" stroke-dasharray="4 3"/>`
        : `<rect x="${x1.toFixed(1)}" y="${y + 4}" width="${largo.toFixed(1)}" height="14" ${marcado ? 'class="vino-fill"' : 'fill="var(--anatomy-mid)"'}/>`,
    )
  })
  const fallos = ultimos.filter(t => t.estado === 'error').length
  return envolver(h, `Línea de tiempo de ${ultimos.length} trabajos`, [
    ...marco(h, 'Fig 4', 'Línea de tiempo', 'CADA TRABAJO, DE INICIO A FIN', `${ultimos.length} trabajos${fallos ? ` · ${fallos} fallos` : ''}`),
    ...partes,
  ])
}

// Fig 5 · Notas: la nota que puso el jefe a cada trabajo, en orden. Vinotinto bajo 6 (hay que rehacerlo).
export function graficaNotas(trabajos: Trabajo[]): string {
  const notas = trabajos.filter(t => t.puntaje !== undefined).sort((a, b) => a.inicio - b.inicio).slice(-16)
  if (!notas.length) return vacio(130, 'Fig 5', 'Notas del jefe', 'NOTA 1-10 POR TRABAJO', 'aún no hay trabajos puntuados')
  const alto = 200
  const base = 60 + alto
  const h = base + 54
  const ancho = (W - 64) / notas.length
  const partes: string[] = []
  for (const v of [0, 5, 10]) {
    const y = base - (v / 10) * alto
    partes.push(`<path class="iso-line" data-tone="faint" d="M40 ${y.toFixed(1)}H${W - 16}"/>`, texto(32, y + 4, String(v), 'iso-face-text', 'lo', 10, 'end'))
  }
  const y6 = base - (6 / 10) * alto
  partes.push(`<path d="M40 ${y6.toFixed(1)}H${W - 16}" stroke="${VINO}" stroke-width="1" stroke-dasharray="4 4" fill="none"/>`, texto(40, 46, 'línea punteada: mínimo para pasar (6)', 'iso-face-text', 'vino', 10, 'start'))
  notas.forEach((t, i) => {
    const p = t.puntaje as number
    const alt = (p / 10) * alto
    const x = 40 + i * ancho + ancho * 0.18
    const bw = ancho * 0.64
    partes.push(
      `<rect x="${x.toFixed(1)}" y="${(base - alt).toFixed(1)}" width="${bw.toFixed(1)}" height="${alt.toFixed(1)}" ${p < 6 ? 'class="vino-fill"' : 'fill="var(--anatomy-mid)"'}/>`,
      texto(x + bw / 2, base - alt - 5, String(p), 'iso-face-text', p < 6 ? 'vino' : 'hi', 11, 'middle'),
      texto(x + bw / 2, base + 14, t.subtarea !== undefined ? `#${t.subtarea}` : '·', 'iso-face-text', 'lo', 10, 'middle'),
      texto(x + bw / 2, base + 28, corto(agenteDe(t), 6), 'iso-face-text', 'lo', 8.5, 'middle'),
    )
  })
  const media = notas.reduce((s, t) => s + (t.puntaje as number), 0) / notas.length
  const bajas = notas.filter(t => (t.puntaje as number) < 6).length
  return envolver(h, `Notas del jefe: media ${media.toFixed(1)}`, [
    ...marco(h, 'Fig 5', 'Notas del jefe', 'NOTA 1-10 POR TRABAJO · # = SUBTAREA', `media ${media.toFixed(1)}${bajas ? ` · ${bajas} a rehacer` : ''}`),
    ...partes,
  ])
}

// Fig 6 · Ahorro acumulado: lo que habría costado con Claude Sonnet lo que hicieron los agentes gratis, sumado trabajo a trabajo.
export function graficaAhorro(trabajos: Trabajo[]): string {
  const hechos = trabajos
    .filter(t => t.ms !== undefined && !t.trabajador.startsWith('claude:') && (t.tokensIn !== undefined || t.tokensOut !== undefined))
    .sort((a, b) => a.inicio + (a.ms as number) - (b.inicio + (b.ms as number)))
  if (!hechos.length) return vacio(130, 'Fig 6', 'Ahorro acumulado', 'USD FRENTE A CLAUDE SONNET', 'aún no hay trabajos de agentes gratis')
  let suma = 0
  const puntos = hechos.map(t => ({ t, v: (suma += costoComoClaude(t.tokensIn, t.tokensOut)) }))
  const arriba = 56
  const alto = 170
  const base = arriba + alto
  const h = base + 50
  const x0 = 56
  const ancho = W - x0 - 28
  const maximo = Math.max(suma, 0.01)
  const desde = hechos[0].inicio + (hechos[0].ms as number)
  const hasta = Math.max(...hechos.map(t => t.inicio + (t.ms as number)), desde + 1000)
  const px = (ms: number) => (puntos.length === 1 ? x0 + ancho / 2 : x0 + ((ms - desde) / (hasta - desde)) * ancho)
  const py = (v: number) => base - (v / maximo) * alto
  const partes: string[] = [texto(16, 44, 'USD ACUMULADOS', 'iso-face-text', 'mid', 10.5, 'start')]
  for (const f of [0, 0.5, 1]) {
    const y = py(maximo * f)
    partes.push(`<path class="iso-line" data-tone="faint" d="M${x0} ${y.toFixed(1)}H${W - 16}"/>`, texto(x0 - 8, y + 4, `$${(maximo * f).toFixed(2)}`, 'iso-face-text', 'lo', 10, 'end'))
  }
  // Escalón: el ahorro sube de golpe cuando termina cada trabajo.
  let d = `M${px(desde).toFixed(1)} ${base}`
  let previo = 0
  for (const { t, v } of puntos) {
    const x = px(t.inicio + (t.ms as number))
    d += `L${x.toFixed(1)} ${py(previo).toFixed(1)}L${x.toFixed(1)} ${py(v).toFixed(1)}`
    previo = v
  }
  d += `L${px(hasta).toFixed(1)} ${py(previo).toFixed(1)}`
  partes.push(`<path d="${d}L${px(hasta).toFixed(1)} ${base}Z" fill="${VINO}" opacity="0.16"/>`, `<path d="${d}" fill="none" stroke="${VINO}" stroke-width="2"/>`)
  for (const { t, v } of puntos) partes.push(`<circle cx="${px(t.inicio + (t.ms as number)).toFixed(1)}" cy="${py(v).toFixed(1)}" r="3.5" fill="var(--anatomy-hi)"/>`)
  partes.push(texto(x0, base + 18, segs(0), 'iso-face-text', 'lo', 10, 'start'), texto(W - 16, base + 18, segs(hasta - desde), 'iso-face-text', 'lo', 10, 'end'))
  return envolver(h, `Ahorro acumulado: $${suma.toFixed(2)}`, [
    ...marco(h, 'Fig 6', 'Ahorro acumulado', 'USD FRENTE A CLAUDE SONNET · POR TRABAJO TERMINADO', `$${suma.toFixed(2)}`),
    ...partes,
  ])
}
