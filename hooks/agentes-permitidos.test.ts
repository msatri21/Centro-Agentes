import { expect, test } from 'claude-code/testing'

import { aplicarAgentesPermitidos } from './asincrono.ts'

const modelos = { opencode: ['a', 'b'], ollama: ['c'], codex: ['chatgpt'], claude: ['haiku'] }

test('sin la opción se conservan todos los agentes', () => {
  expect(aplicarAgentesPermitidos(modelos, undefined)).toEqual(modelos)
  expect(aplicarAgentesPermitidos(modelos, '')).toEqual(modelos)
  expect(aplicarAgentesPermitidos(modelos, '  ')).toEqual(modelos)
})

test('solo opencode deja a los demás sin modelos, sin tocar los de opencode', () => {
  expect(aplicarAgentesPermitidos(modelos, 'opencode')).toEqual({ opencode: ['a', 'b'], ollama: [], codex: [], claude: [] })
})

test('varios agentes, con mayúsculas y espacios', () => {
  expect(aplicarAgentesPermitidos(modelos, ' OpenCode , ollama ')).toEqual({ opencode: ['a', 'b'], ollama: ['c'], codex: [], claude: [] })
})

test('un nombre desconocido se ignora y si ninguno existe no se apaga nada', () => {
  expect(aplicarAgentesPermitidos(modelos, 'opencod')).toEqual(modelos)
  expect(aplicarAgentesPermitidos(modelos, 'opencode,nada')).toEqual({ opencode: ['a', 'b'], ollama: [], codex: [], claude: [] })
})
