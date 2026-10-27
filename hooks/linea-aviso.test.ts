import { expect, test } from 'claude-code/testing'
import { lineaAviso } from './asincrono.ts'

test('lineaAviso quita el prefijo del centro y corta en la primera frase', () => {
  expect(lineaAviso('[Centro de agentes MST] Terminó el grupo g1 (3 encargo(s)). Verifica cada resultado y registra su puntaje:\n[...]')).toBe('⚙ Terminó el grupo g1 (3 encargo(s))')
})

test('lineaAviso recorta a 90 caracteres con puntos suspensivos', () => {
  const l = lineaAviso('[Centro de agentes MST] ' + 'a'.repeat(200))
  expect(l.length).toBe(90)
  expect(l.endsWith('…')).toBe(true)
})

test('lineaAviso respeta una línea corta sin prefijo', () => {
  expect(lineaAviso('Hola')).toBe('⚙ Hola')
})
