import { expect, test } from 'claude-code/testing'

import { seccionCostos } from './vista.ts'

const base = { sonnetSesion: 1.5, apiSesion: 0.4, sinPrecioSesion: 1, apiTotal: 12.3, sonnetTotal: 490.73, gastoClaude: 0.31 }

test('la sección Costos separa la sesión del total histórico y marca lo que no tiene precio con —', () => {
  const html = seccionCostos({
    ...base,
    porModelo: [
      { trabajador: 'opencode:opencode/deepseek-v4.1-flash-free', agente: 'opencode', modelo: 'opencode/deepseek-v4.1-flash-free', trabajos: 3, entradaNueva: 120_000, cache: 1_500_000, salida: 9_000, precio: { entrada: 0.3, salida: 1.2, cache: 0.006, fuente: 'models.dev opencode/deepseek-v4.1-flash' }, costoApi: 0.05, costoSonnet: 0.4, ahorro: 0.35 },
      { trabajador: 'opencode:opencode/big-pickle', agente: 'opencode', modelo: 'opencode/big-pickle', trabajos: 1, entradaNueva: 1000, cache: 0, salida: 100, costoSonnet: 0.01, ahorro: 0 },
    ],
  })
  expect(html).toContain('deepseek-v4.1-flash-free')
  expect(html).toContain('1.5M')
  expect(html).toContain('$0.30 / $1.20')
  expect(html).toContain('Esta sesión')
  expect(html).toContain('Total histórico (todas las sesiones)')
  expect(html).toContain('1 trabajo sin precio')
  // big-pickle no tiene precio: ni precio ni costo API ni ahorro se inventan.
  const fila = html.split('<tr>').find(f => f.includes('big-pickle')) ?? ''
  expect(fila.match(/<td[^>]*>—<\/td>/g)?.length).toBe(3)
})

test('un modelo malicioso sale escapado y no inyecta HTML', () => {
  const html = seccionCostos({ ...base, porModelo: [{ trabajador: 'x:<script>', agente: '<img src=x>', modelo: 'x/<script>alert(1)<b>', trabajos: 1, entradaNueva: 1, cache: 0, salida: 1, costoSonnet: 0, ahorro: 0 }] })
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img src=x>')
  expect(html).toContain('&lt;script&gt;')
})

test('sin trabajos la sección lo dice y sigue mostrando los totales', () => {
  const html = seccionCostos({ ...base, porModelo: [] })
  expect(html).toContain('Aún no hay trabajos con consumo.')
  expect(html).toContain('Total histórico')
})
