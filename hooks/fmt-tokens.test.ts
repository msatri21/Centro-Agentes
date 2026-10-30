import { expect, test } from 'claude-code/testing'

import { filasResumenPanelSesion, fmtTokens } from './asincrono.ts'

test('fmtTokens da formatos cortos y no salta mal en los bordes', () => {
  expect(fmtTokens(0)).toBe('0')
  expect(fmtTokens(999)).toBe('999')
  expect(fmtTokens(1000)).toBe('1.0k')
  expect(fmtTokens(1500)).toBe('1.5k')
  expect(fmtTokens(9999)).toBe('10k')
  expect(fmtTokens(10000)).toBe('10k')
  expect(fmtTokens(12345)).toBe('12k')
  expect(fmtTokens(999_499)).toBe('999k')
  expect(fmtTokens(999_999)).toBe('1.0M')
  expect(fmtTokens(1_000_000)).toBe('1.0M')
  expect(fmtTokens(5_660_000)).toBe('5.7M')
})

test('las filas del resumen del panel son solo de la sesión: sin total ni histórico', () => {
  const filas = filasResumenPanelSesion({ trabajos: 3, entradaNueva: 100, cache: 200, salida: 50, sonnetSesion: 1.234, apiSesion: 0.5, sinPrecioSesion: 1, claudeGastado: 0.1 })
  expect(filas.map(f => f.celdas[0])).toEqual(['Agentes', 'Ahorro', 'Costo API', 'Claude'])
  for (const f of filas) for (const c of f.celdas) expect(/total|hist/i.test(c)).toBe(false)
  expect(filas[1].celdas[1]).toBe('$1.23 vs Sonnet 5.5')
  expect(filas[2].celdas[2]).toBe('1 sin precio')
})

test('sin trabajos de Claude no aparece su fila y sin trabajos sin precio no aparece el aviso', () => {
  const filas = filasResumenPanelSesion({ trabajos: 0, entradaNueva: 0, cache: 0, salida: 0, sonnetSesion: 0, apiSesion: 0, sinPrecioSesion: 0 })
  expect(filas.length).toBe(3)
  expect(filas[2].celdas.length).toBe(2)
})
