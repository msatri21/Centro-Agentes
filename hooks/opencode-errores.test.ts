import { expect, test } from 'claude-code/testing'
import { leerOpencode } from './nucleo'

// Las tres líneas JSON reales que emite `opencode run --format json` al fallar el proveedor.
test('las tres líneas reales de error del opencode se ven como [error] <mensaje>, no desconocido', () => {
  const cupo = '{"type":"error","sessionID":"ses_free","error":{"type":"provider.free-limit","message":"Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.","status":429,"retryAfterMs":33725000}}'
  const sinRuta = '{"type":"error","sessionID":"ses_ruta","error":{"type":"provider.no-route","message":"Model unavailable: opencode/minimax-m3.1-flash-free"}}'
  const invalida = '{"type":"error","sessionID":"ses_inval","error":{"type":"provider.invalid-request","message":"Upstream request failed: Model is unavailable."}}'

  const c = leerOpencode(cupo)
  expect(c.texto).toBe('[error] Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.')
  expect(c.errorTipo).toBe('provider.free-limit')
  expect(c.reintentoMs).toBe(33725000)

  const r = leerOpencode(sinRuta)
  expect(r.texto).toBe('[error] Model unavailable: opencode/minimax-m3.1-flash-free')
  expect(r.errorTipo).toBe('provider.no-route')

  const i = leerOpencode(invalida)
  expect(i.texto).toBe('[error] Upstream request failed: Model is unavailable.')
  expect(i.errorTipo).toBe('provider.invalid-request')

  // El formato antiguo (name + data.message) sigue leyéndose, y sin error.type no hay apartado.
  const viejo = leerOpencode('{"type":"error","error":{"name":"APIError","data":{"message":"sin cuota"}}}')
  expect(viejo.texto).toBe('[error] sin cuota')
  expect(viejo.errorTipo).toBeUndefined()
})
