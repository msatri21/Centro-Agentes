import { expect, test } from 'claude-code/testing'
import { precioDe } from './catalogo'

const modelsDev = {
  opencode: { models: {
    'deepseek-v4.1-flash-free': { cost: { input: 0, output: 0 } },
    'deepseek-v4.1-flash': { cost: { input: 0.3, output: 1.2, cache_read: 0.1 } },
    'glm-5.3-flash-free': { cost: { input: 0, output: 0 } },
    'glm-5.3-flash': { cost: { input: 0.15, output: 0.5 } },
    'big-pickle': { cost: { input: 0, output: 0 } },
    'nemotron-3-ultra-free': { cost: { input: 0, output: 0 } },
    paid: { cost: { input: 0.8, output: 2 } },
  } },
  ollama: { models: { 'gpt-oss-120b': { cost: { input: 0.2, output: 0.6 } } } },
  otro: { models: { 'gpt-oss-120b': { cost: { input: 0.1, output: 0.5 } } } },
}

test('precio de modelos OpenCode usa hermano de pago o el precio propio', () => {
  expect(precioDe('opencode', 'opencode/deepseek-v4.1-flash-free', modelsDev)).toEqual({ entrada: 0.3, salida: 1.2, cache: 0.1, fuente: 'models.dev opencode/deepseek-v4.1-flash' })
  expect(precioDe('opencode', 'opencode/glm-5.3-flash-free', modelsDev)).toEqual({ entrada: 0.15, salida: 0.5, fuente: 'models.dev opencode/glm-5.3-flash' })
  expect(precioDe('opencode', 'opencode/paid', modelsDev)).toEqual({ entrada: 0.8, salida: 2, fuente: 'models.dev opencode/paid' })
  expect(precioDe('opencode', 'opencode/big-pickle', modelsDev)).toBeUndefined()
  expect(precioDe('opencode', 'opencode/nemotron-3-ultra-free', modelsDev)).toBeUndefined()
})

test('otros agentes buscan coincidencia exacta normalizada y omiten precios cero', () => {
  expect(precioDe('ollama', 'gpt-oss:120b-cloud', modelsDev)).toEqual({ entrada: 0.1, salida: 0.5, fuente: 'models.dev otro/gpt-oss-120b' })
  expect(precioDe('ollama', 'sin-precio', modelsDev)).toBeUndefined()
  expect(precioDe('claude', 'sonnet', modelsDev)).toBeUndefined()
  for (const precio of [
    precioDe('opencode', 'opencode/big-pickle', modelsDev),
    precioDe('opencode', 'opencode/nemotron-3-ultra-free', modelsDev),
    precioDe('ollama', 'sin-precio', modelsDev),
  ]) expect(precio?.entrada).not.toBe(0)
})
