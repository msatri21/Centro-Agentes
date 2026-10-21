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
  assert.equal(await enviar({ tipo: 'encargar', agente: 'claude', n: 1, texto: 'Hazlo', modelo: 'opus' }), 200, 'con modelo')
  assert.equal(await enviar({ tipo: 'encargar', agente: 'claude', texto: 'x', modelo: 'a b; rm' }), 400, 'modelo con caracteres raros')
  assert.equal(await enviar({ tipo: 'encargar', agente: 'opencode', texto: '   ' }), 400, 'texto vacío')
  assert.equal(await enviar({ tipo: 'encargar', agente: 'opencode', texto: 'x'.repeat(2001) }), 400, 'texto demasiado largo')
  assert.equal(await enviar({ tipo: 'jefe', texto: 'Cambia el plan' }), 200)
  assert.equal(await enviar({ tipo: 'jefe', texto: '' }), 400, 'mensaje vacío al jefe')
  assert.equal(await enviar({ tipo: 'borrar-todo' }), 400, 'tipo desconocido')
  // Terminales del tablero: solo se prueba lo que se rechaza y el estado de una nueva (lanzar agentes de verdad gasta modelos).
  const urlT = `http://127.0.0.1:${puerto}/terminal`
  const T = (ruta, cuerpo) => fetch(`${urlT}/${ruta}?t=clavedeprueba&s=chat1`, { method: 'POST', body: JSON.stringify(cuerpo) }).then(r => r.status)
  assert.equal(await T('enviar', { id: 'a b', agente: 'ollama', modelo: '', texto: 'hola' }), 400, 'id inválido')
  assert.equal(await T('enviar', { id: 'x1', agente: 'rm', modelo: '', texto: 'hola' }), 400, 'agente desconocido')
  assert.equal(await T('enviar', { id: 'x1', agente: 'ollama', modelo: 'a b; rm', texto: 'hola' }), 400, 'modelo con caracteres raros')
  assert.equal(await T('enviar', { id: 'x1', agente: 'ollama', modelo: '', texto: '  ' }), 400, 'mensaje vacío')
  assert.equal(await T('enviar', { id: 'x1', agente: 'ollama', modelo: '', texto: 'hola', cwd: 'C:/no/existe/nunca' }), 400, 'carpeta inexistente')
  const estado = await (await fetch(`${urlT}/estado?t=clavedeprueba&s=chat1&id=nueva-1&agente=claude`)).json()
  assert.deepEqual([estado.estado, estado.turnos.length], ['libre', 0], 'una terminal nueva está libre y vacía')
  assert.equal((await fetch(`${urlT}/estado?t=mala&s=chat1&id=nueva-1&agente=claude`)).status, 403, 'sin clave no hay terminales')
  assert.equal((await fetch(`${urlT}/enviar?t=clavedeprueba&s=chat1`)).status, 405, 'enviar solo por POST')
  const res = await fetch(`http://127.0.0.1:${puerto}/accion?t=mala&s=chat1`, { method: 'POST', body: '{}' })
  assert.equal(res.status, 403, 'sin la clave no se acepta nada')
  const lineas = fs.readFileSync(path.join(base, 'chats', 'chat1', 'acciones.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(lineas.map(l => l.tipo), ['cancelar', 'relanzar', 'encargar', 'encargar', 'jefe'])
  assert.equal(lineas[2].texto, 'Añade cuadrado(x)')
  console.log('ok: servidor web')
} finally {
  srv.kill()
  fs.rmSync(base, { recursive: true, force: true })
}
