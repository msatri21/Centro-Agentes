import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { archivoNuevo, normalizar, aplicar, agregarAlHistorial, resumen } from '../hooks/tareas.ts'

// El cerrojo exclusivo se crea con `wx` y un token para que solo su dueño lo retire.
// Los cerrojos abandonados caducan, pero se revalidan antes de borrarlos para no quitar uno nuevo.
// Cada temporal lleva pid y token para que procesos concurrentes nunca compartan su nombre.
// El historial se renombra antes que el JSON: así no se confirma una tarea cerrada sin archivarla.
// El renombrado publica cada archivo completo; la copia .bak permite recuperar un JSON corrupto.

export const ARCHIVO = 'mst-tareas.json'
export const HISTORIAL = 'mst-tareas-cerradas.md'
const hoyLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fechas = hoy => hoy ?? hoyLocal()
const jsonSeguro = ruta => {
  try { return { valido: true, valor: JSON.parse(fs.readFileSync(ruta, 'utf8')) } } catch { return { valido: false } }
}

export function leer(raiz, proyecto, hoy) {
  const ruta = path.join(raiz, ARCHIVO)
  if (!fs.existsSync(ruta)) return { existe: false, archivo: archivoNuevo(proyecto, fechas(hoy)), problemas: [], avisos: [] }
  const crudo = jsonSeguro(ruta)
  if (!crudo.valido) return { existe: true, archivo: null, problemas: ['JSON no válido'], avisos: [] }
  const n = normalizar(crudo.valor, fechas(hoy))
  const problemas = [...n.problemas]
  if (!Object.hasOwn(crudo.valor ?? {}, 'siguiente_tarea')) problemas.push('Falta siguiente_tarea; se reconstruyó desde los ids')
  return { existe: true, archivo: n.archivo, problemas, avisos: [...problemas] }
}

export function resumenDe(raiz, proyecto, hoy) {
  const r = leer(raiz, proyecto, hoy)
  if (r.existe && !r.archivo) {
    const bak = jsonSeguro(path.join(raiz, `${ARCHIVO}.bak`))
    return { existe: true, corrupto: true, avisos: [...r.avisos, ...(bak.valido ? ['Hay una copia .bak válida que se puede restaurar con la próxima operación'] : [])] }
  }
  return r.existe ? { existe: true, ...resumen(r.archivo), avisos: r.avisos } : { existe: false }
}

const escribirTemporal = (destino, contenido, token) => {
  const temporal = `${destino}.tmp.${process.pid}.${token}`
  try {
    fs.writeFileSync(temporal, contenido)
    fs.renameSync(temporal, destino)
  } finally {
    try { fs.unlinkSync(temporal) } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
}
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms))
const antiguedadLock = ruta => {
  try {
    const l = JSON.parse(fs.readFileSync(ruta, 'utf8'))
    if (Number.isFinite(l.en)) return { edad: Date.now() - l.en, token: l.token, en: l.en }
  } catch {}
  try {
    const mtimeMs = fs.statSync(ruta).mtimeMs
    return { edad: Date.now() - mtimeMs, mtimeMs }
  } catch { return { edad: Infinity } }
}
async function tomarLock(ruta, esperaMs, caducaMs) {
  const inicio = Date.now(), token = crypto.randomUUID()
  while (true) {
    try {
      const fd = fs.openSync(ruta, 'wx')
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, en: Date.now(), token })) } finally { fs.closeSync(fd) }
      return token
    } catch (e) {
      // En Windows, abrir el cerrojo justo cuando otro proceso lo está borrando da EPERM/EACCES/EBUSY (el archivo queda "pendiente de borrar"):
      // es lo mismo que "ocupado", no un fallo. Si el permiso falta de verdad, el bucle termina igual por tiempo con 'ocupado'.
      if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e
      const visto = antiguedadLock(ruta)
      if (visto.edad > caducaMs) {
        try {
          const actual = antiguedadLock(ruta)
          // El token (o la marca de tiempo en cerrojos antiguos) evita borrar el cerrojo de otro proceso.
          const mismo = visto.token !== undefined ? actual.token === visto.token && actual.en === visto.en : actual.mtimeMs === visto.mtimeMs
          if (mismo) fs.unlinkSync(ruta)
        } catch (borrar) { if (borrar.code !== 'ENOENT') {} }
      }
      if (Date.now() - inicio >= esperaMs) return null
      await pausa(Math.min(60, Math.max(20, 20 + Math.floor(Math.random() * 41)), esperaMs - (Date.now() - inicio)))
    }
  }
}
function guardarJson(ruta, archivo, existia, token) {
  const tmp = `${ruta}.tmp.${process.pid}.${token}`
  try {
    if (existia) fs.copyFileSync(ruta, `${ruta}.bak`)
    fs.writeFileSync(tmp, `${JSON.stringify(archivo, null, 2)}\n`)
    for (let intento = 0; ; intento++) {
      try { fs.renameSync(tmp, ruta); break } catch (e) {
        if (!['EPERM', 'EBUSY'].includes(e.code) || intento >= 9) throw e
        const fin = Date.now() + 20
        while (Date.now() < fin) {}
      }
    }
  } finally {
    try { fs.unlinkSync(tmp) } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
}

export async function transaccion(raiz, proyecto, op, { hoy, esperaMs = 8000, caducaMs = 30000 } = {}) {
  const fecha = fechas(hoy), ruta = path.join(raiz, ARCHIVO), lock = `${ruta}.lock`
  const token = await tomarLock(lock, esperaMs, caducaMs)
  if (!token) return { ok: false, codigo: 'ocupado', mensaje: 'El archivo de tareas está siendo modificado por otro proceso' }
  try {
    const avisos = [], existia = fs.existsSync(ruta)
    let archivo
    if (!existia) archivo = archivoNuevo(proyecto, fecha)
    else {
      const crudo = jsonSeguro(ruta)
      if (!crudo.valido) {
        const bak = jsonSeguro(`${ruta}.bak`)
        if (!bak.valido) return { ok: false, codigo: 'corrupto', mensaje: 'El archivo de tareas y su copia .bak no son JSON válidos' }
        try { fs.copyFileSync(`${ruta}.bak`, ruta) } catch (e) { return { ok: false, codigo: 'corrupto', mensaje: `No se pudo restaurar la copia .bak: ${e.message}` } }
        avisos.push('restaurado desde la copia .bak')
        const n = normalizar(bak.valor, fecha); archivo = n.archivo; avisos.push(...n.problemas)
      } else {
        const n = normalizar(crudo.valor, fecha); archivo = n.archivo; avisos.push(...n.problemas)
        if (!Object.hasOwn(crudo.valor ?? {}, 'siguiente_tarea')) avisos.push('Falta siguiente_tarea; se reconstruyó desde los ids')
      }
    }
    const resultado = aplicar(archivo, op, fecha)
    if (!resultado.ok) return { ...resultado, avisos }
    if (resultado.cerradas.length) {
      try {
        let md = ''
        try { md = fs.readFileSync(path.join(raiz, HISTORIAL), 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
        for (const tarea of resultado.cerradas) md = agregarAlHistorial(md, tarea)
        escribirTemporal(path.join(raiz, HISTORIAL), md, token)
      } catch (e) { return { ok: false, codigo: 'historial', mensaje: `No se pudo actualizar el historial: ${e.message}`, avisos } }
    }
    try { guardarJson(ruta, resultado.archivo, existia, token) } catch (e) { return { ok: false, codigo: 'escritura', mensaje: `No se pudo guardar el archivo de tareas: ${e.message}`, avisos } }
    const salida = { ...resultado, avisos }
    if (!existia) return { ...salida, creado: true, gitignore: asegurarGitignore(raiz) }
    return salida
  } finally {
    try {
      const actual = JSON.parse(fs.readFileSync(lock, 'utf8'))
      if (actual.token === token) fs.unlinkSync(lock)
    } catch (e) { if (e.code !== 'ENOENT') {} }
  }
}

export function asegurarGitignore(raiz) {
  let actual = path.resolve(raiz), hayGit = false
  while (true) {
    if (fs.existsSync(path.join(actual, '.git'))) { hayGit = true; break }
    const padre = path.dirname(actual)
    if (padre === actual) break
    actual = padre
  }
  if (!hayGit) return { accion: 'sin_git' }
  const destino = path.join(raiz, '.gitignore'), existe = fs.existsSync(destino)
  let contenido = ''
  if (existe) contenido = fs.readFileSync(destino, 'utf8')
  if (contenido.split(/\r?\n/).some(l => l === 'mst-tareas*' || l === ARCHIVO)) return versionado(destino, raiz, { accion: 'ya_estaba' })
  const bloque = '# Centro de agentes MST: seguimiento de tareas (local, no se versiona)\nmst-tareas*'
  fs.writeFileSync(destino, `${contenido ? `${contenido.replace(/[\r\n]+$/, '')}\n` : ''}${bloque}\n`)
  return versionado(destino, raiz, { accion: existe ? 'anadido' : 'creado' })
}
function versionado(destino, raiz, resultado) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', ARCHIVO], { cwd: raiz, stdio: 'ignore' })
    return { ...resultado, versionado: true, aviso: `${ARCHIVO} ya está versionado; .gitignore no lo oculta. Sácalo con git rm --cached ${ARCHIVO}.` }
  } catch { return resultado }
}

async function main(argv) {
  const [orden, raizArg, ...args] = argv
  if (!orden || !raizArg) throw new Error('Uso: node mcp/tareas.mjs <orden> <raiz>')
  const raiz = path.resolve(raizArg), opcion = nombre => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined }
  const proyecto = opcion('--proyecto') ?? path.basename(raiz), hoy = opcion('--hoy')
  if (orden === 'gitignore') return asegurarGitignore(raiz)
  if (orden === 'leer') return leer(raiz, proyecto, hoy)
  if (orden === 'resumen') return resumenDe(raiz, proyecto, hoy)
  if (orden === 'aplicar') {
    const fichero = opcion('--op-archivo')
    const op = JSON.parse(fichero ? fs.readFileSync(path.resolve(fichero), 'utf8') : fs.readFileSync(0, 'utf8'))
    return transaccion(raiz, proyecto, op, { hoy })
  }
  throw new Error(`Orden desconocida: ${orden}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r)), e => {
    console.log(JSON.stringify({ ok: false, codigo: 'error', mensaje: e?.message ?? String(e) }))
    process.exitCode = 1
  })
}

