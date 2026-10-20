// Prueba rápida del servidor web: qué órdenes acepta (Cancelar, Relanzar y Encargar) y cuáles rechaza. Uso: node web/prueba-servidor.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-srv-'))
fs.writeFileSync(path.join(base, 'clave.txt'), 'clavedeprueba')
fs.mkdirSync(path.join(base, 'chats', 'chat1'), { recursive: true })
const puerto = 47480 + Math.floor(Math.random() * 15)
const srv = spawn(process.execPath, [fileURLToPath(new URL('./servidor.js', import.meta.url)), String(puerto), path.join(base, 'clave.txt'), path.join(base, 'chats'), 'prueba'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 1200))
const enviar = async cuerpo => (await fetch(`http://127.0.0.1:${puerto}/accion?t=clavedeprueba&s=chat1`, { method: 'POST', body: JSON.stringify(cuerpo) })).status
try {
  assert.equal(await enviar({ tipo: 'cancelar', id: 'abc' }), 200)
  assert.equal(await enviar({ tipo: 'relanzar', n: 2 }), 200)
  assert.equal(await enviar({ tipo: 'encargar', agente: 'opencode', n: 1, texto: 'Añade cuadrado(x)' }), 200)
  assert.equal(await enviar({ tipo: 'encargar', agente: 'rm -rf', texto: 'x' }), 400, 'agente desconocido')
  assert.equal(await enviar({ tipo: 'encargar', agente: 'opencode', texto: '   ' }), 400, 'texto vacío')
  assert.equal(await enviar({ tipo: 'encargar', agente: 'opencode', texto: 'x'.repeat(2001) }), 400, 'texto demasiado largo')
  assert.equal(await enviar({ tipo: 'borrar-todo' }), 400, 'tipo desconocido')
  const res = await fetch(`http://127.0.0.1:${puerto}/accion?t=mala&s=chat1`, { method: 'POST', body: '{}' })
  assert.equal(res.status, 403, 'sin la clave no se acepta nada')
  const lineas = fs.readFileSync(path.join(base, 'chats', 'chat1', 'acciones.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(lineas.map(l => l.tipo), ['cancelar', 'relanzar', 'encargar'])
  assert.equal(lineas[2].texto, 'Añade cuadrado(x)')
  console.log('ok: servidor web')
} finally {
  srv.kill()
  fs.rmSync(base, { recursive: true, force: true })
}
