import { expect, test } from 'claude-code/testing'

import { lineaHistorial } from './register'

test('la línea del historial junta agente, modelo corto, duración y nota', () => {
  expect(lineaHistorial({ trabajador: 'opencode:ollama/deepseek-v4.1-flash', estado: 'listo', ms: 62_000, puntaje: 8 }))
    .toBe('✓ opencode · deepseek-v4.1-flash · 1m02s · 8/10')
})

test('con la tarea, la línea acaba en su título corto', () => {
  expect(lineaHistorial({ trabajador: 'opencode:ollama/deepseek-v4.1-flash', estado: 'listo', ms: 62_000, puntaje: 8 }, 'Pulido del panel: cabeceras discretas'))
    .toBe('✓ opencode · deepseek-v4.1-flash · 1m02s · 8/10 — Pulido del panel')
})

test('sin modelo, nota ni minutos la línea sigue siendo legible, y el error lleva ✗', () => {
  expect(lineaHistorial({ trabajador: 'ollama', estado: 'listo', ms: 9_000 })).toBe('✓ ollama · 9s')
  expect(lineaHistorial({ trabajador: 'aider:ollama_chat/beam', estado: 'error', ms: 3_000, puntaje: 3 }))
    .toBe('✗ aider · beam · 3s · 3/10')
})
