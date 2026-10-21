// Pruebas del instalador de ponytail (mcp/instalar-ponytail.mjs), sin red: contenidos falsos con sus propias huellas.
// Uso: node mcp/prueba-instalador.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as inst from './instalar-ponytail.mjs'
import { PONYTAIL } from '../hooks/ponytailAviso.ts'

const falsos = () => {
  const contenidos = new Map()
  const lista = inst.DESCARGAS.map((d, i) => {
    const buf = Buffer.from(d.ruta === 'skills/ponytail/SKILL.md' ? '---\nname: ponytail\n---\ncuerpo ' + i : 'contenido ' + d.ruta)
    contenidos.set(inst.urlDe(d.ruta), buf)
    return { ruta: d.ruta, sha: inst.shaDeGit(buf), tamano: buf.length }
  })
  const pedidas = []
  return { lista, pedidas, contenidos, descargar: async url => { pedidas.push(url); return contenidos.get(url) } }
}
const casaTemporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mst-ponytail-'))
const skill = (casa, n, a = 'SKILL.md') => path.join(casa, '.claude', 'skills', n, a)
let hechas = 0
const prueba = async (nombre, fn) => {
  await fn()
  hechas++
  console.log('✓', nombre)
}

await prueba('los datos de verificación están completos y apuntan a un commit fijo', () => {
  assert.match(inst.COMMIT, /^[0-9a-f]{40}$/)
  assert.equal(inst.COMMIT, PONYTAIL.commit)
  assert.deepEqual(inst.DESCARGAS.map(d => d.ruta).sort(), ['LICENSE', 'hooks/ponytail-map.js', 'skills/ponytail-audit/SKILL.md', 'skills/ponytail-review/SKILL.md', 'skills/ponytail/SKILL.md'])
  for (const d of inst.DESCARGAS) {
    assert.match(d.sha, /^[0-9a-f]{40}$/)
    assert.equal(inst.urlDe(d.ruta), `https://raw.githubusercontent.com/DietrichGebert/ponytail/${inst.COMMIT}/${d.ruta}`)
  }
  // Lo que dice el aviso del plugin coincide con lo que descarga el instalador.
  const peso = ruta => inst.DESCARGAS.find(d => d.ruta === ruta).tamano
  for (const n of inst.SKILLS) assert.equal(PONYTAIL.skills[n], peso(`skills/${n}/SKILL.md`))
  assert.equal(PONYTAIL.mapa, peso('hooks/ponytail-map.js'))
  assert.equal(PONYTAIL.licencia, peso('LICENSE'))
})

await prueba('la huella de git coincide con la de un archivo conocido (git hash-object)', () => {
  // `printf 'hola\n' | git hash-object --stdin`
  assert.equal(inst.shaDeGit(Buffer.from('hola\n')), '5c1b14949828006ed75a3e8858957f86a2f7e2eb')
  assert.equal(inst.shaDeGit(Buffer.from('')), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
})

await prueba('sin --instalar no descarga ni escribe; instalar verifica todo, escribe lo que falta y no pisa lo que existe', async () => {
  const casa = casaTemporal()
  const f = falsos()
  const p = inst.plan({ casa })
  assert.equal(p.length, 12)
  assert.ok(p.every(x => x.escribir && !x.existe))
  assert.deepEqual(f.pedidas, [])
  assert.equal(fs.existsSync(path.join(casa, '.claude')), false)
  const r = await inst.instalar({ casa, descargar: f.descargar, descargas: f.lista })
  assert.equal(r.escritos.length, 12)
  assert.deepEqual(r.omitidos, [])
  // La licencia se descarga una sola vez aunque se copie en cada carpeta.
  assert.equal(f.pedidas.filter(u => u.endsWith('/LICENSE')).length, 1)
  assert.equal(f.pedidas.length, 5)
  assert.ok(fs.existsSync(skill(casa, 'ponytail-review')))
  assert.ok(fs.existsSync(path.join(casa, '.centro-agentes', 'ponytail', 'ponytail-map.js')))
  assert.ok(fs.readFileSync(skill(casa, 'ponytail', 'ORIGEN.md'), 'utf8').includes(inst.COMMIT))
  // Una segunda vez no pisa nada ni vuelve a descargar.
  fs.writeFileSync(skill(casa, 'ponytail'), 'mío')
  const otra = falsos()
  const r2 = await inst.instalar({ casa, descargar: otra.descargar, descargas: otra.lista })
  assert.deepEqual(r2.escritos, [])
  assert.equal(r2.omitidos.length, 12)
  assert.deepEqual(otra.pedidas, [])
  assert.equal(fs.readFileSync(skill(casa, 'ponytail'), 'utf8'), 'mío')
  // Con --reemplazar sí.
  const r3 = await inst.instalar({ casa, reemplazar: true, descargar: otra.descargar, descargas: otra.lista })
  assert.equal(r3.escritos.length, 12)
  assert.notEqual(fs.readFileSync(skill(casa, 'ponytail'), 'utf8'), 'mío')
  fs.rmSync(casa, { recursive: true, force: true })
})

await prueba('si un archivo no coincide con su huella o su tamaño no se escribe ninguno', async () => {
  const casa = casaTemporal()
  const f = falsos()
  // Un archivo cambiado en el camino: misma longitud, otro contenido.
  const malo = async url => (url.endsWith('hooks/ponytail-map.js') ? Buffer.from('x'.repeat(f.contenidos.get(url).length)) : f.descargar(url))
  await assert.rejects(inst.instalar({ casa, descargar: malo, descargas: f.lista }), /SHA-1.*no se escribió nada/)
  assert.equal(fs.existsSync(path.join(casa, '.claude')), false)
  assert.equal(fs.existsSync(path.join(casa, '.centro-agentes')), false)
  // Tamaño distinto.
  const corto = async url => (url.endsWith('/LICENSE') ? Buffer.from('corto') : f.descargar(url))
  await assert.rejects(inst.instalar({ casa, descargar: corto, descargas: f.lista }), /tamaño/)
  assert.equal(fs.existsSync(path.join(casa, '.claude')), false)
  fs.rmSync(casa, { recursive: true, force: true })
})

await prueba('--solo-manual añade la línea al encabezado una sola vez y lo dice en ORIGEN.md', async () => {
  const casa = casaTemporal()
  const f = falsos()
  await inst.instalar({ casa, soloManual: true, descargar: f.descargar, descargas: f.lista })
  const texto = fs.readFileSync(skill(casa, 'ponytail'), 'utf8')
  assert.ok(texto.startsWith('---\ndisable-model-invocation: true\nname: ponytail'))
  assert.equal(inst.conSoloManual(texto), texto)
  assert.ok(fs.readFileSync(skill(casa, 'ponytail', 'ORIGEN.md'), 'utf8').includes('Única modificación'))
  // Las otras skills quedan idénticas al original.
  assert.ok(!fs.readFileSync(skill(casa, 'ponytail-review'), 'utf8').includes('disable-model-invocation'))
  fs.rmSync(casa, { recursive: true, force: true })
})

await prueba('un archivo sin encabezado no se rompe con --solo-manual', () => {
  assert.equal(inst.conSoloManual('sin encabezado'), 'sin encabezado')
  assert.equal(inst.conSoloManual('---\r\nname: x\r\n---\r\n'), '---\r\ndisable-model-invocation: true\r\nname: x\r\n---\r\n')
})

console.log(`\n${hechas} pruebas del instalador pasan.`)
