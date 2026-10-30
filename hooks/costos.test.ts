import { expect, test } from 'claude-code/testing'
import { costoApi, costoComoClaude } from './nucleo'

test('costo Sonnet sin caché coincide con la fórmula anterior', () => {
  expect(costoComoClaude(1_000_000, 1_000_000)).toBe(12)
})

test('costo Sonnet cobra la caché leída al precio reducido asumido', () => {
  expect(Math.abs(costoComoClaude(1_000_000, 100_000, 900_000) - 1.38) < 1e-9).toBe(true)
})

test('costo API usa los precios de entrada, caché y salida', () => {
  expect(Math.abs(costoApi({ tokensIn: 1_000_000, tokensCache: 900_000, tokensOut: 100_000 }, { entrada: 2, cache: 0.2, salida: 10 })! - 1.38) < 1e-9).toBe(true)
})

test('costo API devuelve undefined si falta el precio', () => {
  expect(costoApi({ tokensIn: 100 }, undefined)).toBeUndefined()
})

test('costo API limita la caché a la entrada', () => {
  expect(costoApi({ tokensIn: 100, tokensCache: 200 }, { entrada: 2, cache: 0.2, salida: 10 })).toBeGreaterThanOrEqual(0)
  expect(costoApi({ tokensIn: 100, tokensCache: 200 }, { entrada: 2, cache: 0.2, salida: 10 })).toBe(0.00002)
})

test('costo API usa el precio de entrada si falta precio de caché', () => {
  expect(costoApi({ tokensIn: 1_000_000, tokensCache: 900_000 }, { entrada: 2, salida: 10 })).toBe(2)
})

import { agenteYModelo } from './register'

test('agenteYModelo parte en el primer ":" y respeta los ":" del modelo', () => {
  expect(agenteYModelo('ollama:gpt-oss:120b-cloud')).toEqual({ agente: 'ollama', modelo: 'gpt-oss:120b-cloud' })
  expect(agenteYModelo('opencode:opencode/deepseek-v4.1-flash-free')).toEqual({ agente: 'opencode', modelo: 'opencode/deepseek-v4.1-flash-free' })
  expect(agenteYModelo('codex')).toEqual({ agente: 'codex', modelo: '' })
})
