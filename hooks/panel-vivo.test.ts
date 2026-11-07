import { expect, test } from 'claude-code/testing'

import { filasPanelVivo } from './register'

test('el panel incluye la fila del agente vivo', () => {
  const filas = filasPanelVivo([{
    id: 't1', trabajador: 'ollama:gemma4:31b-cloud', estado: 'corriendo', inicio: 1000, tarea: 'hacer algo',
  }], 61_000)

  expect(filas).toEqual([{
    agente: 'ollama', modelo: 'gemma4:31b-cloud', tarea: 'hacer algo', tiempo: '1 min', color: '#d4d4d4',
  }])
})

test('el panel muestra con ✦ las skills que sigue el agente, también las que añade el centro', () => {
  const filas = filasPanelVivo([{
    id: 't2', trabajador: 'opencode:opencode/deepseek-v4.1-flash-free', estado: 'corriendo', inicio: 1000, tarea: 'añade suma a mate.mjs', skills: ['ponytail'],
  }, {
    id: 't3', trabajador: 'codex:chatgpt', estado: 'corriendo', inicio: 2000, skills: ['ponytail-review'],
  }], 61_000)
  expect(filas[0].tarea).toBe('✦ ponytail · añade suma a mate.mjs')
  // Sin texto de tarea queda solo la skill, sin un « · » colgando.
  expect(filas[1].tarea).toBe('✦ ponytail-review')
})
