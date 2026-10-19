#!/usr/bin/env node
// Servidor MCP del Centro de agentes MST: el mismo centro que el plugin de Claude Code, para que OpenCode
// (u otro cliente MCP) haga de jefe cuando se acaba el límite de Claude. Habla MCP por stdio (JSON-RPC, una línea por mensaje).
// Reutiliza las piezas puras del plugin (hooks/nucleo.ts y hooks/extras.ts): Node 24 ejecuta TypeScript sin compilar.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cerrojos, archivosCambiados, clave, costoComoClaude, fueraDeAlcance, esErrorDeCuenta, esErrorDeRed, leerClaude, leerCodex, leerHermes, leerOllama, leerOpencode, ordenar, sinAnsi, vistaDe } from '../hooks/nucleo.ts'
import { paginaCentro } from '../hooks/vista.ts'
import { agregarRendimiento, bloqueos, informeMarkdown, leerAider, leerDependencias, listas, temaNtfyValido } from '../hooks/extras.ts'

const VERSION = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8').replace(/^﻿/, '')).version
const CASA = path.join(os.homedir(), '.centro-agentes')
const PUERTO_WEB = 47321
const CONFIG = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(CASA, 'opencode-jefe.json'), 'utf8'))
  } catch {
    return {}
  }
})()

// Los agentes que lanza el centro también cargan este servidor (está en la config global de OpenCode):
// para ellos no hay herramientas, así un agente no puede volver a repartir trabajo.
const ES_TRABAJADOR = process.env.CENTRO_TRABAJADOR === '1'

const MODELOS = {
  opencode: ['ollama/gpt-oss:120b-cloud', 'ollama/beam:cloud', 'ollama/gemma4:31b-cloud', 'ollama/nemotron-3-super:cloud', 'ollama/gpt-oss:20b-cloud'],
  ollama: ['gpt-oss:120b-cloud', 'beam:cloud', 'gemma4:31b-cloud', 'nemotron-3-super:cloud', 'gpt-oss:20b-cloud', 'llama3.2:3b'],
  hermes: ['ollama-local/gpt-oss:120b-cloud', 'ollama-local/beam:cloud', 'ollama-local/gemma4:31b-cloud', 'ollama-local/gpt-oss:20b-cloud'],
  aider: ['ollama_chat/gpt-oss:120b-cloud', 'ollama_chat/beam:cloud', 'ollama_chat/gemma4:31b-cloud'],
  // chatgpt = tu cuenta de ChatGPT (cupo mensual gratis limitado); ollama/... = tu Ollama, de respaldo.
  codex: ['chatgpt', 'ollama/gpt-oss:120b-cloud'],
  // Este servidor existe para cuando no queda Claude: Claude headless solo entra si se activa en la config.
  claude: CONFIG.conClaude ? ['haiku', 'sonnet'] : [],
  ...(CONFIG.modelos ?? {}),
}
const TRABAJADORES = ['opencode', 'ollama', 'hermes', 'aider', 'codex', 'claude']
const TIMEOUT_MS = Math.min(10, Math.max(1, Number(CONFIG.timeoutMin ?? 8))) * 60_000
const SILENCIO_MS = 120_000
const MAX_CAMBIOS = 2
const CAIDO_MS = 10 * 60_000

// ---------- Estado de este chat ----------
const ID = 'opencode-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14)
// CENTRO_CHATS: otra carpeta para las pruebas, así no ensucian la lista de chats.
const DIR = path.join(process.env.CENTRO_CHATS ?? path.join(CASA, 'chats'), ID)
const CARPETA = path.basename(process.cwd())
let plan = null
const trabajos = []
const encargos = new Map()
const caidos = new Map()
const motivo = new Map()
const ocupados = new Map()
let seq = 0
let avisadoPara = ''

const corto = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const miles = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
const leerJson = (f, def) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return def
  }
}
const ARCHIVO_PUNTAJES = path.join(CASA, 'puntajes-opencode.json')
const puntajes = () => leerJson(ARCHIVO_PUNTAJES, {})

// ---------- Procesos ----------
// Los CLIs de npm son atajos .cmd: Node no los lanza sin shell, y con shell una tarea de varias líneas se corta.
// Se busca el .exe real que llama el atajo.
function ejecutable(nombre) {
  if (process.platform !== 'win32') return nombre
  const casa = os.homedir()
  const fijos = { hermes: path.join(casa, '.hermes', 'bin', 'hermes.exe'), aider: path.join(casa, '.aider', 'bin', 'aider.exe') }
  if (fijos[nombre] && fs.existsSync(fijos[nombre])) return fijos[nombre]
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir) continue
    const exe = path.join(dir, nombre + '.exe')
    if (fs.existsSync(exe)) return exe
    const cmd = path.join(dir, nombre + '.cmd')
    if (fs.existsSync(cmd)) {
      const m = fs.readFileSync(cmd, 'utf8').match(/"%dp0%\\([^"]+\.exe)"/)
      if (m) return path.join(dir, m[1])
    }
  }
  return nombre
}
// Atajos de npm que lanzan un script de Node (como codex): se ejecutan con este mismo Node.
function comandoNode(nombre) {
  if (process.platform === 'win32')
    for (const dir of (process.env.PATH ?? '').split(';')) {
      const cmd = dir && path.join(dir, nombre + '.cmd')
      if (!cmd || !fs.existsSync(cmd)) continue
      const m = fs.readFileSync(cmd, 'utf8').match(/"%dp0%\\([^"]+\.js)"/)
      if (m) return [process.execPath, path.join(dir, m[1])]
    }
  return [nombre]
}

function correr(argv, { cwd, stdin, env, timeoutMs = TIMEOUT_MS, silencioMs = SILENCIO_MS } = {}, alTrozo = () => {}) {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let cortado = ''
    let p
    try {
      // OpenCode toma su carpeta de PWD, no de cwd: sin esto trabajaría en la carpeta del jefe y no en la suya.
      p = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...(cwd ? { PWD: cwd } : {}), ...env }, windowsHide: true })
    } catch (e) {
      resolve({ exitCode: null, stdout: '', stderr: String(e), cortado: '' })
      return
    }
    // Sin cerrar stdin, opencode run se queda esperando entrada para siempre.
    p.stdin.on('error', () => {})
    p.stdin.end(stdin ?? '')
    const matar = por => {
      if (cortado) return
      cortado = por
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true })
      else p.kill('SIGKILL')
    }
    const total = setTimeout(() => matar(`tiempo máximo de ${Math.round(timeoutMs / 60_000)} min`), timeoutMs)
    let silencio = setTimeout(() => matar(`${silencioMs / 1000} s sin escribir nada`), silencioMs)
    const vivo = () => {
      clearTimeout(silencio)
      silencio = setTimeout(() => matar(`${silencioMs / 1000} s sin escribir nada`), silencioMs)
    }
    p.stdout.on('data', d => {
      stdout += d
      vivo()
      alTrozo(stdout)
    })
    p.stderr.on('data', d => {
      stderr += d
      vivo()
    })
    p.on('error', e => (stderr += String(e)))
    p.on('close', code => {
      clearTimeout(total)
      clearTimeout(silencio)
      resolve({ exitCode: code, stdout, stderr, cortado })
    })
  })
}

const git = (cwd, a) => correr(['git', '-C', cwd, ...a], { timeoutMs: 60_000, silencioMs: 60_000 })

// ---------- Copias aisladas y verificación ----------
async function crearCopia(cwd, nombre) {
  const raiz = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (raiz.exitCode !== 0) return { error: 'cwd no es un repositorio git: el agente trabaja en la carpeta tal cual' }
  const repo = raiz.stdout.trim()
  const carpeta = path.join(CASA, 'copias', ID, nombre)
  const rama = `mst/${nombre}`
  const r = await git(repo, ['worktree', 'add', '-b', rama, carpeta, 'HEAD'])
  return r.exitCode === 0 ? { repo, carpeta, rama } : { error: `git worktree falló: ${corto(r.stderr.trim(), 200)}` }
}
async function borrarCopia(c) {
  await git(c.repo, ['worktree', 'remove', '--force', c.carpeta])
  await git(c.repo, ['branch', '-D', c.rama])
}
// Las copias con cambios de este chat, para juntarlas todas de una vez con juntar_copias.
const porJuntar = []
async function juntarCopias(subtareas) {
  const elegidas = porJuntar.filter(c => !subtareas?.length || subtareas.includes(c.subtarea))
  const resultados = []
  for (const c of elegidas) {
    const r = await git(c.repo, ['merge', '--no-edit', c.rama])
    if (r.exitCode !== 0) {
      // Con conflicto se deja todo como estaba: el jefe decide (rehacer la subtarea o juntarla a mano).
      await git(c.repo, ['merge', '--abort'])
      resultados.push({ subtarea: c.subtarea, rama: c.rama, juntada: false, motivo: corto(sinAnsi(`${r.stdout}\n${r.stderr}`).trim(), 600) })
      continue
    }
    await git(c.repo, ['worktree', 'remove', '--force', c.carpeta])
    await git(c.repo, ['branch', '-d', c.rama])
    porJuntar.splice(porJuntar.indexOf(c), 1)
    resultados.push({ subtarea: c.subtarea, rama: c.rama, juntada: true })
  }
  return resultados
}
async function cerrarCopia(c, mensaje) {
  await git(c.carpeta, ['add', '-A'])
  const commit = await git(c.carpeta, ['commit', '-q', '-m', mensaje])
  if (commit.exitCode !== 0) {
    await borrarCopia(c)
    return { rama: c.rama, cambios: 'el agente no cambió ningún archivo; la copia se borró' }
  }
  const stat = await git(c.carpeta, ['diff', '--stat', 'HEAD~1', 'HEAD'])
  porJuntar.push(c)
  return {
    carpeta: c.carpeta,
    rama: c.rama,
    cambios: stat.stdout.trim().slice(-2000),
    juntar: `git -C "${c.repo}" merge ${c.rama} && git -C "${c.repo}" worktree remove "${c.carpeta}"`,
  }
}
async function verificarEn(cwd, comando) {
  // Va en un archivo: como argumento, las comillas del comando llegan rotas a cmd.
  fs.mkdirSync(DIR, { recursive: true })
  const archivo = path.join(DIR, `verificar-${Date.now().toString(36)}${(seq++).toString(36)}.cmd`)
  const shell = process.platform === 'win32'
  if (shell) fs.writeFileSync(archivo, `@echo off\r\nchcp 65001 >nul\r\n${comando}\r\n`)
  const r = await correr(shell ? ['cmd', '/d', '/c', archivo] : ['sh', '-c', comando], { cwd, timeoutMs: 5 * 60_000, silencioMs: 5 * 60_000 })
  if (shell) fs.rmSync(archivo, { force: true })
  return { comando, ok: r.exitCode === 0, codigo: r.exitCode, salida: sinAnsi(`${r.stdout}\n${r.stderr}`).trim().slice(-2500) }
}

// ---------- Ejecutar un encargo con un agente ----------
async function argvDe(c, tarea, cwd) {
  if (c.trabajador === 'ollama') return { argv: [ejecutable('ollama'), 'run', '--verbose', '--nowordwrap', '--hidethinking', c.modelo], stdin: tarea }
  // --standalone: con el servicio compartido de OpenCode, la carpeta de la copia queda abierta y no se puede borrar.
  if (c.trabajador === 'opencode')
    return { argv: [ejecutable('opencode'), 'run', '--standalone', '--format', 'json', '-m', c.modelo, tarea] }
  if (c.trabajador === 'hermes') {
    const i = c.modelo.indexOf('/')
    const [prov, modelo] = i > 0 ? [c.modelo.slice(0, i), c.modelo.slice(i + 1)] : ['auto', c.modelo]
    return { argv: [ejecutable('hermes'), 'chat', '--oneshot', '--query-file', '-', '--format', 'stream-json', '--yolo', '--provider', prov, '-m', modelo], stdin: tarea }
  }
  if (c.trabajador === 'aider') {
    // Aider solo edita los archivos que recibe: se le pasan los que nombra la tarea y existen.
    const nombrados = [...new Set(tarea.match(/[\w./\\-]+\.[A-Za-z]\w{0,5}\b/g) ?? [])]
    const archivos = cwd ? nombrados.filter(a => fs.existsSync(path.join(cwd, a))) : []
    return { argv: [ejecutable('aider'), ...archivos, '--model', c.modelo, '--message', tarea, '--yes-always', '--no-git', '--no-pretty', '--no-stream', '--no-check-update', '--no-show-model-warnings', '--no-analytics', '--input-history-file', 'NUL', '--chat-history-file', 'NUL'] }
  }
  if (c.trabajador === 'codex') {
    // --json: un evento por línea. danger-full-access: en Windows su sandbox le impide escribir y ejecutar;
    // trabaja en su carpeta (o en su copia aislada), como los demás agentes. La tarea va por stdin.
    const local = c.modelo.startsWith('ollama/') ? ['--oss', '--local-provider', 'ollama', '-m', c.modelo.slice('ollama/'.length)] : c.modelo && c.modelo !== 'chatgpt' ? ['-m', c.modelo] : []
    return { argv: [...comandoNode('codex'), 'exec', '--json', '--sandbox', 'danger-full-access', '--skip-git-repo-check', ...local], stdin: tarea }
  }
  return { argv: [ejecutable('claude'), '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--model', c.modelo], stdin: tarea }
}

async function intentar(c, input) {
  const quien = clave(c.trabajador, c.modelo)
  const id = `t${Date.now().toString(36)}${(seq++).toString(36)}`
  const t0 = Date.now()
  const trabajo = { id, trabajador: quien, categoria: input.categoria, tarea: corto(input.tarea), estado: 'corriendo', inicio: t0, subtarea: input.subtarea }
  trabajos.push(trabajo)
  marcar(input.subtarea, { estado: 'en curso', quien })
  guardar()
  const { argv, stdin } = await argvDe(c, input.tarea, input.cwd)
  const env = {
    CENTRO_TRABAJADOR: '1',
    OLLAMA_API_BASE: 'http://127.0.0.1:11434',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    ...(process.env.HERMES_HOME ? {} : { HERMES_HOME: path.join(os.homedir(), '.hermes') }),
  }
  let ultimo = 0
  const r = await correr(argv, { cwd: input.cwd, stdin, env }, crudo => {
    if (Date.now() - ultimo < 1500) return
    ultimo = Date.now()
    trabajo.salida = vistaDe(c.trabajador, crudo).slice(-1500)
    guardar()
  })
  const s =
    c.trabajador === 'ollama' ? leerOllama(r.stdout, r.stderr)
    : c.trabajador === 'opencode' ? leerOpencode(r.stdout)
    : c.trabajador === 'hermes' ? leerHermes(r.stdout)
    : c.trabajador === 'aider' ? leerAider(r.stdout)
    : c.trabajador === 'codex' ? leerCodex(r.stdout)
    : leerClaude(r.stdout)
  const sinTexto = ['hermes', 'aider', 'codex'].includes(c.trabajador) && !s.texto
  const ok = r.exitCode === 0 && !r.cortado && !/^\[error\]/.test(s.texto.trim()) && !sinTexto
  const err = ['ollama', 'hermes', 'aider', 'codex'].includes(c.trabajador) ? (ok ? '' : sinAnsi(r.stderr).trim()) : r.stderr.trim()
  if (r.cortado) s.texto += `\n[cortado: ${r.cortado}]`
  if (err) s.texto += `\n[stderr] ${corto(err, 1500)}`
  Object.assign(trabajo, { estado: ok ? 'listo' : 'error', ms: Date.now() - t0, tokensIn: s.tokensIn, tokensOut: s.tokensOut, costo: s.costo, salida: corto(s.texto.trim(), 1500) })
  guardar()
  return { id, ok, ms: Date.now() - t0, s, sinRed: !ok && esErrorDeRed(`${s.texto}\n${r.stderr}`) }
}

const marcar = (n, cambio) => {
  if (n === undefined || !plan) return
  plan.subtareas = plan.subtareas.map(s => (s.n === n ? { ...s, ...cambio } : s))
}
const caidosAhora = () => new Set([...caidos].filter(([, t]) => Date.now() - t < CAIDO_MS).map(([k]) => k))
const candidatos = () => TRABAJADORES.flatMap(t => (MODELOS[t] ?? []).map(modelo => ({ trabajador: t, modelo })))

async function delegarSinCerrojo(input, sinBloqueo = false) {
  const categoria = String(input.categoria ?? '').toLowerCase().trim() || 'general'
  if (input.subtarea !== undefined && !sinBloqueo) {
    const faltan = bloqueos(plan?.subtareas ?? [], input.subtarea)
    if (faltan.length) return { subtarea: input.subtarea, error: `La subtarea ${input.subtarea} espera a ${faltan.join(', ')}: lánzala cuando estén hechas.` }
  }
  if (input.subtarea !== undefined) encargos.set(input.subtarea, { ...input })
  const pedido = input.trabajador && input.trabajador !== 'auto' ? input.trabajador : undefined
  if (pedido && !TRABAJADORES.includes(pedido)) return { error: `Trabajador desconocido: ${pedido}` }
  let todos = candidatos()
  // Copia aislada o verificación = se esperan cambios en archivos, y Ollama solo devuelve texto.
  if (input.aislar || input.verificar?.trim()) todos = todos.filter(c => c.trabajador !== 'ollama')
  const elegibles = todos.filter(c => !pedido || c.trabajador === pedido)
  const modeloPedido = input.modelo?.trim()
  if (modeloPedido && !elegibles.some(c => c.modelo === modeloPedido))
    return { error: `Modelo no permitido: ${modeloPedido}. Usa uno de: ${elegibles.map(c => clave(c.trabajador, c.modelo)).join(', ')}` }
  const tabla = puntajes()
  const libre = c => !ocupados.get(clave(c.trabajador, c.modelo))
  const preparar = l => {
    const o = ordenar(tabla, categoria, l, caidosAhora())
    return [...o.filter(libre), ...o.filter(c => !libre(c))]
  }
  let cola = [...preparar(elegibles), ...(pedido ? preparar(todos.filter(c => c.trabajador !== pedido)) : [])]
  if (modeloPedido) cola = [...cola.filter(c => c.modelo === modeloPedido), ...cola.filter(c => c.modelo !== modeloPedido)]
  const tarea = `${input.tarea}\n\nResponde siempre en español.`

  // Rutas relativas respecto a la carpeta del proyecto (OpenCode arranca este servidor en ella).
  if (input.cwd) input = { ...input, cwd: path.resolve(input.cwd) }
  const copia = input.aislar && input.cwd ? await crearCopia(input.cwd, `s${input.subtarea ?? 'x'}-${Date.now().toString(36)}`) : undefined
  if (copia?.carpeta) copia.subtarea = input.subtarea
  const cwd = copia?.carpeta ?? input.cwd

  const cambios = []
  let r
  let elegido = cola[0]
  for (const c of cola) {
    if (cambios.length > MAX_CAMBIOS) break
    elegido = c
    const k = clave(c.trabajador, c.modelo)
    ocupados.set(k, (ocupados.get(k) ?? 0) + 1)
    try {
      r = await intentar(c, { ...input, categoria, tarea, cwd })
    } finally {
      ocupados.set(k, (ocupados.get(k) ?? 1) - 1)
    }
    if (r.ok) break
    if (esErrorDeCuenta(r.s.texto)) {
      for (const m of MODELOS[c.trabajador]) caidos.set(clave(c.trabajador, m), Date.now() + 60 * 60_000 - CAIDO_MS)
      motivo.set(c.trabajador, 'clave caducada')
    }
    const dePago = /free plan|upgrade|pro is \$/i.test(r.s.texto)
    caidos.set(k, dePago ? Date.now() + 24 * 60 * 60_000 - CAIDO_MS : Date.now())
    if (r.sinRed) for (const m of MODELOS[c.trabajador]) caidos.set(clave(c.trabajador, m), Date.now())
    cambios.push(`${k} falló: ${corto(r.s.texto.replace(/\s+/g, ' '), 120)}`)
  }
  if (!r) {
    if (copia?.carpeta) await borrarCopia(copia)
    return { subtarea: input.subtarea, error: 'Todos los modelos posibles fallaron hace poco. Prueba otro trabajador o espera unos minutos.' }
  }
  if (!r.ok) marcar(input.subtarea, { estado: 'pendiente' })
  const quien = clave(elegido.trabajador, elegido.modelo)
  const aislado = copia?.carpeta ? await cerrarCopia(copia, `mst: subtarea ${input.subtarea ?? '-'} (${quien})`) : copia
  const verificacion = r.ok && input.verificar?.trim() ? await verificarEn(cwd, input.verificar.trim()) : undefined
  guardar()
  return {
    id: r.id,
    subtarea: input.subtarea,
    trabajador: quien,
    exito: r.ok,
    segundos: Math.round(r.ms / 1000),
    tokens: { entrada: r.s.tokensIn, salida: r.s.tokensOut },
    ...(cambios.length ? { cambios } : {}),
    ...(aislado ? { copia: aislado } : {}),
    ...(verificacion ? { verificacion } : {}),
    salida: r.s.texto.slice(0, 30_000) || '(sin salida)',
    aviso: verificacion
      ? `Verificación ${verificacion.ok ? 'superada' : 'FALLIDA'} con "${verificacion.comando}". Revisa y llama a registrar_auditoria con este id.`
      : 'Resultado sin verificar. Audítalo y llama a registrar_auditoria con este id.',
  }
}

// Carpeta compartida: sin "aislar", los agentes de una misma carpeta (y rama) esperan su turno solo si chocan en archivos.
// Con "archivos" declarados, los que tocan cosas distintas trabajan a la vez; sin ellos se toma todo el repo.
const cerrojos = new Cerrojos()
async function cambiosGit(cwd) {
  const r = await git(cwd, ['status', '--porcelain'])
  return r.exitCode === 0 ? archivosCambiados(r.stdout) : null
}
async function delegarUno(input, sinBloqueo = false) {
  if (!input.cwd || input.aislar) return delegarSinCerrojo(input, sinBloqueo)
  const cwd = path.resolve(input.cwd)
  const t0 = Date.now()
  const liberar = await cerrojos.tomar(process.platform === 'win32' ? cwd.toLowerCase() : cwd, input.archivos)
  const esperoSeg = Math.round((Date.now() - t0) / 1000)
  const antes = await cambiosGit(cwd)
  try {
    const r = await delegarSinCerrojo({ ...input, cwd }, sinBloqueo)
    const despues = antes && (await cambiosGit(cwd))
    const fuera = despues ? fueraDeAlcance(antes, despues, input.archivos?.length ? input.archivos : ['*'], cerrojos.deOtros(process.platform === 'win32' ? cwd.toLowerCase() : cwd, liberar.id, liberar.desde)) : []
    return {
      ...r,
      carpeta_compartida: { archivos: input.archivos?.length ? input.archivos : ['*'], ...(esperoSeg ? { esperoSeg } : {}) },
      ...(fuera.length ? { fuera_de_alcance: fuera, aviso: `${r.aviso ?? ''} OJO: el agente tocó archivos que no eran suyos: ${fuera.join(', ')}. Revísalos.`.trim() } : {}),
    }
  } finally {
    liberar()
  }
}

async function delegarVarios(lista) {
  // Una subtarea que espera a otras del mismo lote arranca sola cuando esas terminan bien.
  const subs = plan?.subtareas ?? []
  const porN = new Map(lista.filter(t => t.subtarea !== undefined).map(t => [t.subtarea, t]))
  const enMarcha = new Map()
  const lanzar = (t, camino = new Set()) => {
    const n = t.subtarea
    if (n === undefined) return delegarUno(t)
    if (enMarcha.has(n)) return enMarcha.get(n)
    const espera = bloqueos(subs, n)
    const enLote = espera.filter(e => porN.has(e) && !camino.has(e))
    const p = (async () => {
      if (!espera.length || enLote.length < espera.length) return delegarUno(t)
      const previas = await Promise.all(enLote.map(e => lanzar(porN.get(e), new Set([...camino, n]))))
      const mal = previas.filter(r => !r.exito || r.verificacion?.ok === false).map(r => r.subtarea)
      if (mal.length) return { subtarea: n, error: `No se lanzó: la subtarea ${mal.join(', ')} de la que depende falló. Rehazla y vuelve a lanzar la ${n}.` }
      return { ...(await delegarUno(t, true)), tras: enLote }
    })()
    enMarcha.set(n, p)
    return p
  }
  return Promise.all(lista.map(t => lanzar(t)))
}

function progreso() {
  const subs = plan?.subtareas ?? []
  return { hechas: subs.filter(s => s.estado === 'hecha').length, total: subs.length, faltan: subs.filter(s => s.estado !== 'hecha').map(s => s.n), lanzar_ya: listas(subs).map(s => s.n) }
}

function avisarSiTermino() {
  if (!plan?.subtareas.length || plan.subtareas.some(s => s.estado !== 'hecha') || avisadoPara === plan.objetivo) return
  avisadoPara = plan.objetivo
  const ahorro = trabajos.filter(t => !t.trabajador.startsWith('claude:')).reduce((a, t) => a + costoComoClaude(t.tokensIn, t.tokensOut), 0)
  fs.writeFileSync(path.join(DIR, 'informe.md'), informeMarkdown({ chat: `${CARPETA} · OpenCode jefe`, plan, trabajos, ahorro, fecha: new Date().toLocaleString('es') }))
  const tema = String(CONFIG.ntfyTema ?? '').trim()
  if (temaNtfyValido(tema))
    correr(['curl', '-s', '--max-time', '10', '-H', 'Title: Centro de agentes MST', '-d', `Todo listo: ${corto(plan.objetivo, 120)}`, `https://ntfy.sh/${tema}`], { timeoutMs: 15_000 })
}

// ---------- Web: el mismo servidor y el mismo índice de chats que el plugin ----------
function claveWeb() {
  const f = path.join(CASA, 'clave.txt')
  try {
    const c = fs.readFileSync(f, 'utf8').trim()
    if (c) return c
  } catch {}
  const c = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  fs.mkdirSync(CASA, { recursive: true })
  fs.writeFileSync(f, c)
  return c
}
const urlWeb = () => `http://127.0.0.1:${PUERTO_WEB}/?t=${claveWeb()}&s=${ID}`
let webLista = false
async function asegurarWeb() {
  if (webLista) return
  webLista = true
  const vivo = await fetch(`http://127.0.0.1:${PUERTO_WEB}/version`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok || r.status === 403, () => false)
  if (!vivo) {
    const servidor = fileURLToPath(new URL('../web/servidor.js', import.meta.url))
    const p = spawn(process.execPath, [servidor, String(PUERTO_WEB), path.join(CASA, 'clave.txt'), path.join(CASA, 'chats'), VERSION], { detached: true, stdio: 'ignore', windowsHide: true })
    p.unref()
  }
  setTimeout(() => {
    if (CONFIG.abrirWeb === false || process.env.CENTRO_SIN_NAVEGADOR === '1') return
    if (process.platform === 'win32') spawn('explorer', [urlWeb()], { detached: true, stdio: 'ignore' }).unref()
  }, 1200)
}

// La misma página que el plugin de Claude Code (grafo vivo, gráficas, tablas): hooks/vista.ts.
function pagina() {
  const ahorro = trabajos.filter(t => !t.trabajador.startsWith('claude:')).reduce((a, t) => a + costoComoClaude(t.tokensIn, t.tokensOut), 0)
  const estadoAgente = TRABAJADORES.filter(t => MODELOS[t]?.length).map(t => {
    const fuera = MODELOS[t].every(m => caidosAhora().has(clave(t, m)))
    return { nombre: t, ok: !fuera, nota: fuera ? (motivo.get(t) ?? 'apartado un rato') : `${MODELOS[t].length} modelos` }
  })
  return paginaCentro({
    clave: claveWeb(), chat: CARPETA, jefe: 'OpenCode', plan, trabajos, agentes: estadoAgente, modelos: MODELOS,
    rendimiento: agregarRendimiento(puntajes(), 8), ahorro, cancelables: [], relanzables: [], version: VERSION,
  })
}

let guardando
function guardar() {
  // Como mucho una escritura cada medio segundo: los agentes avisan de cada trozo de salida.
  if (guardando) return
  guardando = setTimeout(guardarYa, 500)
}
function guardarYa() {
  clearTimeout(guardando)
  guardando = undefined
  if (!plan && !trabajos.length) return
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(path.join(DIR, 'estado.json'), JSON.stringify({ plan, trabajos, encargos: [...encargos], nombre: `OpenCode jefe · ${plan?.objetivo ?? ''}` }))
    fs.writeFileSync(path.join(DIR, 'centro.html'), pagina())
  } catch {}
}

// ---------- Herramientas MCP ----------
const SKILLS_NOTA = 'Skills que el agente debe seguir (solo las lee Claude Code; con OpenCode como jefe se ignoran).'
const CAMPOS_ENCARGO = {
  tarea: { type: 'string', description: 'Instrucción completa y autocontenida: el agente no ve esta conversación' },
  categoria: { type: 'string', description: 'Categoría corta: codigo, tests, docs, texto, analisis…' },
  subtarea: { type: 'number', description: 'Número de la subtarea del plan que cubre este trabajo' },
  trabajador: { type: 'string', enum: [...TRABAJADORES.filter(t => MODELOS[t]?.length), 'auto'], description: 'Vacío o auto: el centro elige el mejor según el ranking' },
  modelo: { type: 'string', description: 'Vacío = el centro elige el mejor modelo y cambia solo si falla' },
  cwd: { type: 'string', description: 'Carpeta de trabajo (existente). Distinta por tarea si varias editan archivos sin aislar' },
  aislar: { type: 'boolean', description: 'Si cwd es un repo git: el agente trabaja en su propia copia (git worktree, rama mst/...). Junta luego con "copia.juntar"' },
  verificar: { type: 'string', description: 'Comando que comprueba el resultado (p. ej. npm test); el centro lo ejecuta donde trabajó el agente' },
  archivos: { type: 'array', items: { type: 'string' }, description: 'Carpeta compartida (sin aislar): los archivos o carpetas que este agente puede tocar. Los que tocan cosas distintas trabajan a la vez en la misma rama; los que chocan esperan turno. Sin esto se reserva todo el repo y espera a los demás' },
  skills: { type: 'array', items: { type: 'string' }, description: SKILLS_NOTA },
}
const HERRAMIENTAS = [
  {
    name: 'planificar',
    description: 'Registra el objetivo y las subtareas del trabajo (reemplaza el plan anterior). Devuelve la dirección de la web en vivo y qué subtareas puedes lanzar ya.',
    inputSchema: {
      type: 'object',
      properties: {
        objetivo: { type: 'string', description: 'Resultado final en una frase' },
        subtareas: { type: 'array', items: { type: 'string' }, description: 'Títulos cortos, en orden' },
        dependencias: { type: 'object', description: 'Opcional. Qué subtareas espera cada una, p. ej. {"3": [1, 2]}' },
      },
      required: ['objetivo', 'subtareas'],
    },
  },
  {
    name: 'delegar',
    description: 'Delega una tarea a un agente (opencode, ollama, hermes, aider) con modelos gratis de Ollama y devuelve su salida, tiempo y tokens. El resultado NO está verificado: debes auditarlo.',
    inputSchema: { type: 'object', properties: CAMPOS_ENCARGO, required: ['categoria', 'tarea'] },
  },
  {
    name: 'delegar_varios',
    description: 'Lanza VARIAS subtareas a la vez, cada una a un agente distinto. Una subtarea que espera a otras del mismo lote arranca sola cuando esas terminan bien. Devuelve todos los resultados al terminar.',
    inputSchema: { type: 'object', properties: { tareas: { type: 'array', items: { type: 'object', properties: CAMPOS_ENCARGO, required: ['tarea', 'categoria'] } } }, required: ['tareas'] },
  },
  {
    name: 'registrar_auditoria',
    description: 'Guarda tu nota (1-10) de un trabajo delegado. Con 6 o más su subtarea queda hecha; con menos te sugiere otro modelo para rehacerla.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'id que devolvió delegar' }, puntaje: { type: 'number', minimum: 1, maximum: 10 }, nota: { type: 'string' } }, required: ['id', 'puntaje'] },
  },
  {
    name: 'cerrar_subtarea',
    description: 'Marca como hecha una subtarea que hiciste tú como jefe (p. ej. juntar ramas o revisar el conjunto).',
    inputSchema: { type: 'object', properties: { subtarea: { type: 'number' }, nota: { type: 'string' } }, required: ['subtarea'] },
  },
  {
    name: 'juntar_copias',
    description: 'Junta en tu repositorio las ramas de las copias aisladas (aislar: true) de este chat y borra las copias. Úsalo al final, después de auditar. Si una rama choca con otra, no la junta y te dice por qué. Con "verificar", ejecuta ese comando en el repositorio ya junto.',
    inputSchema: { type: 'object', properties: { subtareas: { type: 'array', items: { type: 'number' }, description: 'Opcional: solo estas subtareas. Vacío = todas las pendientes de juntar' }, verificar: { type: 'string', description: 'Opcional: comando de tests a ejecutar tras juntar' } } },
  },
  {
    name: 'ranking',
    description: 'Nota media y tiempo medio de cada agente y modelo por categoría.',
    inputSchema: { type: 'object', properties: { categoria: { type: 'string' } } },
  },
]

const lista = v => (typeof v === 'string' ? JSON.parse(v) : (v ?? []))
async function llamar(nombre, a) {
  if (nombre === 'planificar') {
    const titulos = lista(a.subtareas)
    const dep = leerDependencias(a.dependencias, titulos.length)
    plan = {
      objetivo: corto(String(a.objetivo ?? ''), 120),
      subtareas: titulos.map((t, i) => ({ n: i + 1, titulo: corto(String(t), 80), estado: 'pendiente', ...(dep.has(i + 1) ? { espera: dep.get(i + 1) } : {}) })),
    }
    avisadoPara = ''
    await asegurarWeb()
    guardar()
    return { guardado: true, web: urlWeb(), subtareas: plan.subtareas.map(s => ({ n: s.n, titulo: s.titulo, ...(s.espera ? { espera: s.espera } : {}) })), lanzar_ya: listas(plan.subtareas).map(s => s.n) }
  }
  if (nombre === 'delegar') {
    await asegurarWeb()
    return delegarUno(a)
  }
  if (nombre === 'delegar_varios') {
    const tareas = lista(a.tareas)
    if (!tareas.length) return { error: 'Pasa al menos una tarea en "tareas".' }
    await asegurarWeb()
    return { resultados: await delegarVarios(tareas), aviso: 'Resultados sin verificar. Audita cada uno y llama a registrar_auditoria con su id.' }
  }
  if (nombre === 'registrar_auditoria') {
    const t = trabajos.find(x => x.id === a.id)
    if (!t) return { error: `No existe el trabajo ${a.id}` }
    const p = Math.max(1, Math.min(10, Math.round(Number(a.puntaje))))
    const tabla = puntajes()
    const c = ((tabla[t.categoria] ??= {})[t.trabajador] ??= { n: 0, suma: 0, msTotal: 0 })
    c.n += 1
    c.suma += p
    c.msTotal += t.ms ?? 0
    fs.mkdirSync(CASA, { recursive: true })
    fs.writeFileSync(ARCHIVO_PUNTAJES, JSON.stringify(tabla))
    t.puntaje = p
    marcar(t.subtarea, { estado: p >= 6 ? 'hecha' : 'pendiente', quien: t.trabajador, puntaje: p })
    avisarSiTermino()
    guardar()
    const siguiente = p < 6 ? ordenar(tabla, t.categoria, candidatos(), new Set([...caidosAhora(), t.trabajador]))[0] : undefined
    return {
      guardado: true, trabajador: t.trabajador, puntaje: p, progreso: progreso(),
      ...(siguiente ? { siguiente, aviso: `Rinde poco: vuelve a delegar con trabajador "${siguiente.trabajador}" y modelo "${siguiente.modelo}" diciendo qué falló.` } : {}),
    }
  }
  if (nombre === 'cerrar_subtarea') {
    const n = Number(a.subtarea)
    if (!plan?.subtareas.some(s => s.n === n)) return { error: `No existe la subtarea ${a.subtarea} en el plan` }
    marcar(n, { estado: 'hecha', quien: 'jefe' })
    avisarSiTermino()
    guardar()
    return { hecha: n, progreso: progreso() }
  }
  if (nombre === 'juntar_copias') {
    if (!porJuntar.length) return { aviso: 'No hay copias con cambios pendientes de juntar en este chat.' }
    const repos = [...new Set(porJuntar.map(c => c.repo))]
    const resultados = await juntarCopias(lista(a.subtareas).map(Number))
    const verificacion = a.verificar?.trim() ? await Promise.all(repos.map(r => verificarEn(r, a.verificar.trim()))) : undefined
    guardar()
    return { resultados, ...(verificacion ? { verificacion } : {}), pendientes: porJuntar.map(c => c.rama) }
  }
  if (nombre === 'ranking') {
    const tabla = puntajes()
    return Object.entries(tabla)
      .filter(([cat]) => !a.categoria || cat === a.categoria)
      .map(([categoria, fila]) => ({
        categoria,
        trabajadores: Object.entries(fila)
          .map(([trabajador, c]) => ({ trabajador, media: Math.round((c.suma / c.n) * 10) / 10, n: c.n, segundosMedios: Math.round(c.msTotal / c.n / 1000) }))
          .sort((x, y) => y.media - x.media),
      }))
  }
  return { error: `Herramienta desconocida: ${nombre}` }
}

// ---------- Protocolo MCP por stdio ----------
const enviar = m => process.stdout.write(JSON.stringify(m) + '\n')
async function atender(m) {
  if (m.id === undefined) return // notificaciones (initialized, cancelled…): nada que responder
  try {
    if (m.method === 'initialize')
      return enviar({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'centro-agentes', version: VERSION } } })
    if (m.method === 'ping') return enviar({ jsonrpc: '2.0', id: m.id, result: {} })
    if (m.method === 'tools/list') return enviar({ jsonrpc: '2.0', id: m.id, result: { tools: ES_TRABAJADOR ? [] : HERRAMIENTAS } })
    if (m.method === 'tools/call') {
      const r = await llamar(m.params?.name, m.params?.arguments ?? {})
      return enviar({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }], isError: !!r?.error } })
    }
    enviar({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Método no soportado: ${m.method}` } })
  } catch (e) {
    enviar({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `Error del centro: ${String(e?.stack ?? e)}` }], isError: true } })
  }
}

let resto = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', trozo => {
  resto += trozo
  let i
  while ((i = resto.indexOf('\n')) >= 0) {
    const linea = resto.slice(0, i).trim()
    resto = resto.slice(i + 1)
    if (!linea) continue
    let m
    try {
      m = JSON.parse(linea)
    } catch {
      continue
    }
    void atender(m)
  }
})
// Al cerrarse el cliente se guarda lo último antes de salir (la escritura normal espera medio segundo).
process.stdin.on('end', () => {
  guardarYa()
  process.exit(0)
})
