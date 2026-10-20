// Servidor local del centro de agentes MST: sirve la página de cada chat y recibe sus botones (Cancelar, Relanzar).
// Solo escucha en 127.0.0.1 y exige la clave en cada petición, para que ninguna otra web pueda mandar órdenes.
// Uso: node servidor.js <puerto> <clave.txt> <carpeta de chats>
// Cada chat vive en <carpeta de chats>/<id del chat>/ (centro.html y acciones.jsonl), elegido con ?s=<id>.
// La clave se lee del archivo en cada petición: así coincide con la de cualquier sesión, aunque la cambie otra.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const [puerto, archivoClave, chats, version = '0'] = process.argv.slice(2)
const TIPOS = new Set(['cancelar', 'relanzar', 'encargar', 'jefe'])
const AGENTES = new Set(['opencode', 'ollama', 'hermes', 'aider', 'codex', 'claude'])
const claveActual = () => {
  try {
    return fs.readFileSync(archivoClave, 'utf8').trim()
  } catch {
    return ''
  }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Índice de todos los chats: nombre (el <title> de su página), progreso de su plan y cuándo se actualizó, el más reciente primero.
function indice(clave) {
  let ids = []
  try {
    ids = fs.readdirSync(chats).filter(id => /^[\w-]{1,100}$/.test(id))
  } catch {}
  const filas = ids
    .map(id => {
      const dir = path.join(chats, id)
      let en = 0, titulo = id, objetivo = '', hechas = 0, total = 0, trabajos = 0
      try {
        en = fs.statSync(path.join(dir, 'centro.html')).mtimeMs
        titulo = (fs.readFileSync(path.join(dir, 'centro.html'), 'utf8').match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? id
      } catch {}
      try {
        const g = JSON.parse(fs.readFileSync(path.join(dir, 'estado.json'), 'utf8'))
        objetivo = g.plan?.objetivo ?? ''
        total = g.plan?.subtareas?.length ?? 0
        hechas = (g.plan?.subtareas ?? []).filter(s => s.estado === 'hecha').length
        trabajos = (g.trabajos ?? []).length
      } catch {}
      return { id, en, titulo, objetivo, hechas, total, trabajos }
    })
    .filter(f => f.en)
    .sort((a, b) => b.en - a.en)
  const t = encodeURIComponent(clave)
  const vino = '#9e2a3a'
  const cuerpo = filas.length
    ? filas
        .map(f => `<a class="chat" href="/?t=${t}&s=${encodeURIComponent(f.id)}"><i>${new Date(f.en).toLocaleString('es')}</i><strong>${esc(f.titulo.split(' · ').slice(0, 2).join(' · '))}</strong><span>${esc(f.objetivo || 'sin plan')}</span><small>${f.total ? `${f.hechas}/${f.total} subtareas · ` : ''}${f.trabajos} trabajos</small><b style="width:${f.total ? Math.round((f.hechas / f.total) * 100) : 0}%"></b></a>`)
        .join('')
    : '<p>Aún no hay chats con centro.</p>'
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="10"><title>Todos los chats · Centro de agentes MST</title><style>
html,body{margin:0;background:#0a0a0a;color:#a3a3a3;font:15px ui-monospace,Consolas,monospace}
header,main{max-width:1200px;margin:0 auto;padding:44px 20px 0;box-sizing:border-box}
.rotulo{font-size:13px;color:#8a8a8a;margin:0 0 14px}
h1{font:700 clamp(36px,5vw,68px)/0.95 'Segoe UI',system-ui,sans-serif;letter-spacing:-.03em;color:#f5f5f5;margin:0}h1 b{color:${vino}}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;padding-bottom:40px}
.chat{position:relative;display:block;border:1px solid #2a2a2a;padding:18px 20px 22px;color:inherit;text-decoration:none;overflow:hidden}
.chat:hover{border-color:${vino}}
.chat i{display:block;font-style:normal;font-size:12px;color:${vino};margin-bottom:10px}
.chat strong{display:block;font:600 19px 'Segoe UI',system-ui,sans-serif;color:#f5f5f5;margin-bottom:6px}
.chat span{display:block;color:#a3a3a3;margin-bottom:10px}.chat small{color:#8a8a8a}
.chat b{position:absolute;left:0;bottom:0;height:3px;background:${vino}}
</style></head><body><header><p class="rotulo">/mst · orquestador de agentes · ${filas.length} chats</p><h1>Todos los <b>chats</b></h1></header><main>${cuerpo}</main></body></html>`
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  // Sin clave: solo dice su versión, para que una sesión con una versión más nueva lo releve.
  if (url.pathname === '/version') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end(version)
    return
  }
  // El código del grafo es estático (sin datos del chat): se sirve sin clave para que la página lo cargue como módulo.
  const estatico = req.method === 'GET' && url.pathname.match(/^\/(grafo|grafo-logica|tablero)\.(js|css|html)$/)
  if (estatico) {
    const tipos = { js: 'text/javascript', css: 'text/css', html: 'text/html' }
    fs.readFile(path.join(__dirname, `${estatico[1]}.${estatico[2]}`), (err, js) => {
      if (err) res.writeHead(404).end()
      else res.writeHead(200, { 'content-type': `${tipos[estatico[2]]}; charset=utf-8`, 'cache-control': 'no-store' }).end(js)
    })
    return
  }
  const clave = claveActual()
  if (!clave || url.searchParams.get('t') !== clave) {
    res.writeHead(403).end('clave incorrecta')
    return
  }
  if (req.method === 'GET' && url.pathname === '/todos') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(indice(clave))
    return
  }
  // Solo letras, números, - y _: el id no puede salirse de la carpeta de chats.
  const chat = url.searchParams.get('s') ?? ''
  if (!/^[\w-]{1,100}$/.test(chat)) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('falta el chat (?s=...)')
    return
  }
  const carpeta = path.join(chats, chat)
  if (req.method === 'GET' && url.pathname === '/') {
    fs.readFile(path.join(carpeta, 'centro.html'), (err, html) => {
      if (err) res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Este chat aún no ha escrito su página.')
      else res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html)
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/accion') {
    let cuerpo = ''
    req.on('data', trozo => {
      cuerpo += trozo
      if (cuerpo.length > 4000) req.destroy()
    })
    req.on('end', () => {
      let a
      try {
        a = JSON.parse(cuerpo)
      } catch {
        res.writeHead(400).end('json inválido')
        return
      }
      const textoBueno = typeof a.texto === 'string' && a.texto.trim().length > 0 && a.texto.length <= 2000
      const encargoMalo = (a.tipo === 'encargar' && !(AGENTES.has(a.agente) && textoBueno)) || (a.tipo === 'jefe' && !textoBueno)
      if (!TIPOS.has(a.tipo) || encargoMalo || (a.id !== undefined && typeof a.id !== 'string') || (a.n !== undefined && !Number.isInteger(a.n))) {
        res.writeHead(400).end('acción inválida')
        return
      }
      fs.appendFile(path.join(carpeta, 'acciones.jsonl'), JSON.stringify({ tipo: a.tipo, id: a.id, n: a.n, agente: a.agente, texto: a.texto, en: Date.now() }) + '\n', err => {
        res.writeHead(err ? 500 : 200).end(err ? 'no se pudo guardar' : 'ok')
      })
    })
    return
  }
  res.writeHead(404).end()
})

// Si el puerto ya está ocupado, otra sesión ya sirve las páginas: esta termina sin más.
servidor.on('error', err => process.exit(err.code === 'EADDRINUSE' ? 3 : 1))
servidor.listen(Number(puerto), '127.0.0.1', () => console.log(`centro-web http://127.0.0.1:${puerto}/`))
