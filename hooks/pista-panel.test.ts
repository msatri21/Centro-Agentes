import { expect, test } from 'claude-code/testing'

import { pistaPanel } from './asincrono'

test('con el panel cerrado a mano, la barra dice al final cómo reabrirlo', async () => {
  expect(pistaPanel('⚙ 1 trabajando', true)).toBe('⚙ 1 trabajando · /centro-panel abre el panel')
  expect(pistaPanel('⚙ 1 trabajando', false)).toBe('⚙ 1 trabajando')
  // Sin texto de barra no hay dónde poner la pista: se queda vacía.
  expect(pistaPanel('', true)).toBe('')
  expect(pistaPanel('', false)).toBe('')
})
