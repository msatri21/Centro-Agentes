// Instala las skills de ponytail (https://github.com/DietrichGebert/ponytail, licencia MIT) que el Centro de agentes MST usa si están.
// Sin banderas solo MUESTRA qué se descargaría y dónde (no descarga ni escribe nada). Con --instalar, lo hace.
//   node mcp/instalar-ponytail.mjs                  muestra el plan
//   node mcp/instalar-ponytail.mjs --instalar       descarga, verifica y escribe solo lo que falte
// Banderas: --reemplazar (sobrescribe lo que ya exista) · --solo-manual (añade `disable-model-invocation: true` a la skill ponytail, para que
// Claude no la active solo en tus sesiones; el centro la sigue usando) · --casa <carpeta> (otra carpeta de usuario, para pruebas).
// Seguridad: todo viene de un commit fijo; cada archivo se verifica (tamaño y SHA-1 de git, los que da GitHub) ANTES de escribir nada,
// y si uno no coincide no se escribe ninguno. Lo descargado no se ejecuta.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const REPO = 'DietrichGebert/ponytail'
export const COMMIT = '09c434ab73ca43761c5d8b0c5d341926c2fba710'
// Lo único que se descarga: ruta en el repositorio, SHA-1 de git y tamaño en bytes (los del listado de GitHub para ese commit).
export const DESCARGAS = [
  { ruta: 'skills/ponytail/SKILL.md', sha: 'd64edd32265ba21cbf5270158f04e97d96925f27', tamano: 3496 },
  { ruta: 'skills/ponytail-review/SKILL.md', sha: 'a50e3ac6ded6fccc9edae34ce37877bbce11e3fa', tamano: 5143 },
  { ruta: 'skills/ponytail-audit/SKILL.md', sha: 'ff9a95480700600fe2664d2d0906a4d750b2da0b', tamano: 5417 },
  { ruta: 'hooks/ponytail-map.js', sha: '03ec4a87e0e3a0a11fdcd22430edac3fd78f9788', tamano: 5439 },
  { ruta: 'LICENSE', sha: '715d483338cea4365f0d91a27799cf61226d6bcf', tamano: 1071 },
]
export const SKILLS = ['ponytail', 'ponytail-review', 'ponytail-audit']
const MAX_BYTES = 100_000
const LINEA_MANUAL = 'disable-model-invocation: true'

export const urlDe = ruta => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${ruta}`
export const shaDeGit = buf => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')

// Dónde va cada archivo: una carpeta por skill en ~/.claude/skills y el script del mapa en ~/.centro-agentes/ponytail.
export function destinos(casa) {
  const skill = n => path.join(casa, '.claude', 'skills', n)
  const mapa = path.join(casa, '.centro-agentes', 'ponytail')
  return [
    ...SKILLS.flatMap(n => [
      { carpeta: skill(n), archivo: 'SKILL.md', de: `skills/${n}/SKILL.md` },
      { carpeta: skill(n), archivo: 'LICENSE', de: 'LICENSE' },
      { carpeta: skill(n), archivo: 'ORIGEN.md', de: null, origen: `skills/${n}/SKILL.md` },
    ]),
    { carpeta: mapa, archivo: 'ponytail-map.js', de: 'hooks/ponytail-map.js' },
    { carpeta: mapa, archivo: 'LICENSE', de: 'LICENSE' },
    { carpeta: mapa, archivo: 'ORIGEN.md', de: null, origen: 'hooks/ponytail-map.js' },
  ].map(d => ({ ...d, ruta: path.join(d.carpeta, d.archivo) }))
}

const origenMd = (origen, soloManual) =>
  `Origen: https://github.com/${REPO} (${origen})\nCommit fijado: ${COMMIT}\nLicencia: MIT (ver LICENSE)\n` +
  `Instalado por el Centro de agentes MST (mcp/instalar-ponytail.mjs) el ${new Date().toISOString().slice(0, 10)}; tamaño y SHA-1 de git verificados contra los de GitHub.\n` +
  (soloManual && origen === 'skills/ponytail/SKILL.md' ? `Única modificación: línea ${LINEA_MANUAL} en el encabezado.\n` : 'Contenido idéntico al del repositorio.\n')

// Añade la línea al encabezado (entre los dos ---) si no estaba.
export function conSoloManual(texto) {
  if (texto.includes(LINEA_MANUAL)) return texto
  const m = texto.match(/^(﻿?---\r?\n)/)
  if (!m) return texto
  const nl = m[1].endsWith('\r\n') ? '\r\n' : '\n'
  return m[1] + LINEA_MANUAL + nl + texto.slice(m[1].length)
}

async function descargarReal(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error(`${url} pesa más de lo esperado (${buf.length} bytes)`)
  return buf
}

// El plan: qué archivos de destino ya existen y cuáles faltan.
export function plan({ casa = os.homedir(), reemplazar = false } = {}) {
  return destinos(casa).map(d => ({ ...d, existe: fs.existsSync(d.ruta), escribir: reemplazar || !fs.existsSync(d.ruta) }))
}

// Descarga lo necesario, lo verifica TODO y solo entonces escribe. `descargas` y `descargar` se pueden cambiar para las pruebas.
export async function instalar({ casa = os.homedir(), reemplazar = false, soloManual = false, descargar = descargarReal, descargas = DESCARGAS } = {}) {
  const filas = plan({ casa, reemplazar })
  const pendientes = filas.filter(f => f.escribir)
  const omitidos = filas.filter(f => !f.escribir).map(f => f.ruta)
  const necesarias = [...new Set(pendientes.map(f => f.de).filter(Boolean))]
  const contenido = new Map()
  for (const ruta of necesarias) {
    const meta = descargas.find(x => x.ruta === ruta)
    if (!meta) throw new Error(`No hay datos de verificación para ${ruta}`)
    const buf = await descargar(urlDe(ruta))
    if (buf.length !== meta.tamano) throw new Error(`${ruta}: tamaño ${buf.length} en vez de ${meta.tamano}; no se escribió nada`)
    if (shaDeGit(buf) !== meta.sha) throw new Error(`${ruta}: la verificación (SHA-1) no coincide; no se escribió nada`)
    contenido.set(ruta, buf)
  }
  const escritos = []
  for (const f of pendientes) {
    fs.mkdirSync(f.carpeta, { recursive: true })
    let datos
    if (f.de) {
      datos = contenido.get(f.de)
      if (soloManual && f.de === 'skills/ponytail/SKILL.md') datos = Buffer.from(conSoloManual(datos.toString('utf8')), 'utf8')
    } else datos = Buffer.from(origenMd(f.origen, soloManual), 'utf8')
    fs.writeFileSync(f.ruta, datos)
    escritos.push(f.ruta)
  }
  return { escritos, omitidos }
}

async function main(argv) {
  const tiene = b => argv.includes(b)
  const i = argv.indexOf('--casa')
  const casa = i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : os.homedir()
  const reemplazar = tiene('--reemplazar')
  const filas = plan({ casa, reemplazar })
  console.log(`ponytail ${COMMIT.slice(0, 7)} (${REPO}, licencia MIT)\n`)
  const instalando = tiene('--instalar')
  // Solo lo que hace falta: si todo existe, no se descarga nada.
  const necesarias = new Set(filas.filter(f => f.escribir).map(f => f.de).filter(Boolean))
  const aBajar = DESCARGAS.filter(d => necesarias.has(d.ruta))
  console.log(aBajar.length ? `${instalando ? 'Se descarga' : 'Se descargaría'} (solo de raw.githubusercontent.com, a ese commit):` : 'No hace falta descargar nada.')
  for (const d of aBajar) console.log(`  ${urlDe(d.ruta)}  (${d.tamano} bytes)`)
  console.log(`\n${instalando ? 'Se escribe' : 'Se escribiría'} en:`)
  for (const f of filas) console.log(`  ${f.escribir ? (f.existe ? 'reemplaza' : 'nuevo    ') : 'ya existe (se deja)'}  ${f.ruta}`)
  if (!tiene('--instalar')) {
    console.log('\nNo se descargó ni se escribió nada. Para instalar: node mcp/instalar-ponytail.mjs --instalar' + (reemplazar ? ' --reemplazar' : ''))
    return 0
  }
  const r = await instalar({ casa, reemplazar, soloManual: tiene('--solo-manual') })
  console.log(`\nListo: ${r.escritos.length} archivos escritos, ${r.omitidos.length} ya existían y se dejaron.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(c => process.exit(c), e => {
    console.error('✗ ' + (e?.message ?? e))
    process.exit(1)
  })
}
