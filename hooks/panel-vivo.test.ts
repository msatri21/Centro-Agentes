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
