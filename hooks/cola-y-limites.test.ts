import { expect, test } from 'claude-code/testing'
import { colaDeCandidatos, limiteDeCuenta } from './register'

const c = (trabajador: string, modelo: string) => ({ trabajador, modelo })

// Con modelo fijo el encargo no salta a ningún otro modelo ni agente, aunque haya más en la lista.
test('con modelo fijo la cola es solo ese candidato', () => {
  const preparados = [c('opencode', 'glm'), c('opencode', 'deepseek')]
  const otros = [c('codex', 'gpt')]
  expect(colaDeCandidatos(preparados, otros, 'opencode', 'deepseek')).toEqual([c('opencode', 'deepseek')])
  expect(colaDeCandidatos(preparados, otros, undefined, 'deepseek')).toEqual([c('opencode', 'deepseek')])
})

// Con trabajador fijo solo se usan sus modelos: los de otros agentes no entran en la cola.
test('con trabajador fijo la cola son solo sus modelos, aunque haya otros agentes', () => {
  const preparados = [c('opencode', 'glm'), c('opencode', 'deepseek')]
  const otros = [c('codex', 'gpt'), c('claude', 'haiku')]
  expect(colaDeCandidatos(preparados, otros, 'opencode')).toEqual([c('opencode', 'glm'), c('opencode', 'deepseek')])
})

// Sin trabajador ni modelo fijos, primero los preparados y luego los demás agentes.
test('sin pedido la cola son los preparados y después los demás', () => {
  const preparados = [c('ollama', 'x'), c('opencode', 'glm')]
  const otros = [c('codex', 'gpt')]
  expect(colaDeCandidatos(preparados, otros)).toEqual([c('ollama', 'x'), c('opencode', 'glm'), c('codex', 'gpt')])
})

// El cupo gratis de OpenCode es un límite de la cuenta, no de un modelo.
test('el cupo gratis agotado de OpenCode es límite de cuenta', () => {
  expect(limiteDeCuenta('opencode', 'Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.', 'provider.free-limit')).toBe(true)
})

// Codex avisa con "usage limit" cuando se agota el uso de la cuenta.
test('el uso agotado de Codex es límite de cuenta', () => {
  expect(limiteDeCuenta('codex', "You've hit your usage limit. Upgrade to Plus to continue using Codex", undefined)).toBe(true)
})

// Un error cualquiera no es límite de cuenta: solo se aparta ese modelo.
test('un error cualquiera no es límite de cuenta', () => {
  expect(limiteDeCuenta('opencode', 'Model unavailable: opencode/minimax-m3.1-flash-free', 'provider.no-route')).toBe(false)
  expect(limiteDeCuenta('codex', 'Error de red al conectar')).toBe(false)
})
