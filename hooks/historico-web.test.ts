import { expect, test } from 'claude-code/testing'
import { resumenHistorico, seccionHistorico } from './vista'

// Cuatro trabajos de tres agentes: uno con puntaje y tiempo, uno con error,
// otro sin puntaje y un último sin puntaje ni duración (para los '—').
const filas = [
  { trabajador: 'ana:modelo/x', estado: 'listo', ms: 30_000, puntaje: 8, tokensIn: 1000, tokensOut: 500, tokensCache: 400 },
  { trabajador: 'ana:modelo/x', estado: 'error', ms: 10_000, tokensIn: 500, tokensOut: 100, tokensCache: 1000 },
  { trabajador: 'beto:modelo/y', estado: 'listo', ms: 5_000, puntaje: 10, tokensIn: 2000, tokensOut: 300 },
  { trabajador: 'caro:modelo/z', estado: 'listo', tokensIn: 0, tokensOut: 0 },
]

test('el resumen suma totales y medias por agente', () => {
  const r = resumenHistorico(filas)
  expect(r.trabajos).toBe(4)
  expect(r.bien).toBe(3)
  // Entrada nueva = tokensIn - caché; en el segundo trabajo la caché supera lo leído y no resta.
  expect(r.entradaNueva).toBe(600 + 0 + 2000)
  expect(r.cache).toBe(400 + 500)
  expect(r.salida).toBe(500 + 100 + 300)
  expect(r.ms).toBe(45_000)

  const ana = r.agentes.find(a => a.agente === 'ana')!
  expect(ana.trabajos).toBe(2)
  expect(ana.bien).toBe(1)
  expect(ana.error).toBe(1)
  expect(ana.notas).toEqual([8])
  // El tiempo medio cuenta solo los terminados (los dos de ana).
  expect(ana.tiempos).toEqual([30_000, 10_000])

  const caro = r.agentes.find(a => a.agente === 'caro')!
  expect(caro.notas).toEqual([])
  expect(caro.tiempos).toEqual([])
})

test('sin puntajes ni duración, la tabla muestra —', () => {
  const html = seccionHistorico(filas)
  const filaCaro = html.slice(html.indexOf('<td>caro</td>'))
  expect(filaCaro.slice(0, filaCaro.indexOf('</tr>'))).toContain('<td>—</td><td>—</td>')
  // Ana: un solo puntaje (8) y media de sus dos tiempos (20 s).
  expect(html).toContain('<td>ana</td><td>2</td><td>1</td><td>1</td><td>8.0/10</td><td>20 s</td>')
})

test('sin trabajos, la sección sale vacía', () => {
  const html = seccionHistorico([])
  expect(html).toContain('Todo el histórico')
  expect(html).toContain('sin trabajos')
})

test('un nombre de agente con <script> sale escapado', () => {
  const html = seccionHistorico([{ trabajador: '<script>:modelo', estado: 'listo' }])
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
})
