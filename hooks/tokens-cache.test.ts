import { expect, test } from 'claude-code/testing'
import { leerClaude, leerOpencode } from './nucleo'

test('OpenCode separa los tokens leídos de caché y conserva tokensIn', () => {
  const salida = leerOpencode([
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 3, cache: { read: 20, write: 5 } } } }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 2, output: 1, cache: { read: 7, write: 4 } } } }),
  ].join('\n'))

  expect(salida.tokensCache).toBe(27)
  expect(salida.tokensIn).toBe(48)
})

test('Claude separa los tokens leídos de caché y conserva tokensIn', () => {
  const salida = leerClaude(JSON.stringify({
    type: 'result', result: 'listo', usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 3 },
  }))

  expect(salida.tokensCache).toBe(20)
  expect(salida.tokensIn).toBe(35)
})
