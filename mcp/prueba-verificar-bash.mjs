// Prueba real de la verificación por Git Bash (verificarEn): escribe un .sh tal cual lo hace el plugin,
// lo corre con bash y comprueba tuberías a herramientas Unix. `node mcp/prueba-verificar-bash.mjs`
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const bash = 'C:/Program Files/Git/bin/bash.exe'

if (!existsSync(bash)) {
  console.log('omitida: sin Git Bash')
  process.exit(0)
}

const carpeta = mkdtempSync(join(tmpdir(), 'prueba-verificar-bash-'))
const escribe = comando => {
  const archivo = join(carpeta, 'verificar.sh')
  writeFileSync(archivo, `set -o pipefail\n${comando}\ncodigo=$?\nrm -f "$0"\nexit $codigo\n`)
  return archivo
}
const corre = comando => spawnSync(bash, ['--noprofile', '--norc', escribe(comando)], { cwd: carpeta, encoding: 'utf8', timeout: 30_000 })

let fallos = 0
const hola = corre('echo hola | tail -1')
if (hola.status === 0 && hola.stdout.trim() === 'hola') console.log('ok: echo hola | tail -1 -> "hola" con código 0')
else { console.error(`fallo: echo hola | tail -1 -> código ${hola.status}, salida "${hola.stdout.trim()}", error ${hola.stderr.trim()}`); fallos++ }

const fallada = corre('false | cat')
if (fallada.status !== 0) console.log(`ok: false | cat con pipefail -> código ${fallada.status} (distinto de 0)`)
else { console.error('fallo: false | cat con pipefail debería dar código distinto de 0, dio 0'); fallos++ }

const quedan = readdirSync(carpeta).filter(f => f.endsWith('.sh'))
if (!quedan.length) console.log('ok: los .sh se borraron solos')
else { console.error(`fallo: quedaron .sh sin borrar: ${quedan.join(', ')}`); fallos++ }

rmSync(carpeta, { recursive: true, force: true })
process.exit(fallos ? 1 : 0)
