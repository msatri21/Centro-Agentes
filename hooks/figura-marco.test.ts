import { expect, test } from 'claude-code/testing'

import { figura } from './figura'
import type { DatosFigura } from './figura'

const datos: DatosFigura = {
  bahias: [{ nombre: 'ollama', modelo: 'gpt-oss:120b', tokens: 900, trabajando: true }],
  subtareas: ['solucionado', 'en_proceso', 'pendiente'],
  contexto: 40,
  titulo: 'demo',
  lectura: '1/3 hechas',
}

test('sin marco: mesa sola, sin cabecera ni borde, y escala por viewBox; con marco (por defecto) sí', async () => {
  const sin = figura(datos, { marco: false })
  expect(sin).not.toContain('Fig 1')
  expect(sin).not.toContain('DEMO')
  // El borde de la tarjeta, fuera; la mesa, dentro.
  expect(sin).not.toContain('<rect x="1" y="1"')
  expect(sin).toContain('data-pulse')
  // Se reescala al ancho: viewBox y ni ancho ni alto fijos.
  expect(sin).toContain('viewBox="0 0 640 380"')
  expect(/<svg[^>]*\swidth="/.test(sin)).toBe(false)
  expect(/<svg[^>]*\sheight="/.test(sin)).toBe(false)

  const porDefecto = figura(datos)
  expect(porDefecto).toContain('Fig 1')
  expect(porDefecto).toContain('DEMO')
  expect(porDefecto).toContain('<rect x="1" y="1"')
  // Omitir marco y pedirlo true dan exactamente lo mismo.
  expect(figura(datos, { marco: true })).toBe(porDefecto)
  expect(figura(datos, {})).toBe(porDefecto)
})
