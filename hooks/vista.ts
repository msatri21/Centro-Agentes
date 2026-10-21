// La página web del centro, compartida por el plugin de Claude Code y el servidor MCP de OpenCode.
// De arriba abajo: cabecera, cifras, el grafo grande (web/grafo.js, vivo), las gráficas del estilo anatomy y las tablas.
// La página se vuelve a pedir cada 2 s y solo se cambian las partes de texto y las gráficas: el grafo no se recarga, así sus animaciones no se cortan.
import type { Plan, Trabajo } from '../types'
import { esc, grafica, VINO } from './figura.ts'
import { graficaAhorro, graficaNotas, graficaTiempo, graficaTokens } from './graficas.ts'

export type DatosPagina = {
  clave: string
  chat: string
  /** Quién hace de jefe: Claude u OpenCode */
  jefe: string
  plan: Plan | null
  trabajos: Trabajo[]
  agentes: { nombre: string; ok: boolean; nota: string }[]
  modelos: Record<string, string[]>
  rendimiento: { quien: string; media: number; n: number; segundos: number }[]
  /** USD que habría costado con Claude Sonnet */
  ahorro: number
  cancelables: { id: string; titulo: string }[]
  relanzables: { n: number; titulo: string }[]
  version: string
  /** Figura isométrica y tarjeta de detalles (solo el plugin de Claude Code las dibuja) */
  extra?: string
  /** Columnas de la rejilla de `extra`, según la proporción de cada figura (p. ej. "1.68fr 0.84fr") */
  columnasExtra?: string
  ahora?: number
  /** Planes anteriores del chat (el grafo los dibuja atenuados) */
  planes?: { objetivo: string; subtareas: { n: number; titulo: string; estado: string; quien?: string; puntaje?: number }[] }[]
  /** Preguntas/permisos pendientes del agente al jefe */
  pendientes?: {
    id: string
    consulta: string
    agente: string
    tipo: 'pregunta' | 'permiso'
    texto: string
    detalle?: string
    categoria?: string
    opciones?: string[]
    en?: number
  }[]
}

const miles = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
const corto = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const seg = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.round(ms / 1000)} s`)

const ESTILO = `
:root{--vino:${VINO}}
html,body{margin:0;background:#0a0a0a;color:#a3a3a3;font:16px/1.5 'Segoe UI',system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}
header,.cinta{max-width:1800px;margin:0 auto;padding:0 20px}
header{padding-top:40px}
.rotulo{font:13px ui-monospace,Consolas,monospace;color:#8a8a8a;letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px}
.rotulo a{color:#d4d4d4}.rotulo a:hover{color:var(--vino)}
h1{font:700 clamp(40px,6vw,84px)/.95 'Segoe UI',system-ui,sans-serif;letter-spacing:-.03em;color:#f5f5f5;margin:0}h1 b{color:var(--vino)}
.obj{color:#d4d4d4;font-size:18px;margin:14px 0 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:28px}
.kpi{border-top:1px solid #2a2a2a;border-right:1px solid #1c1c1c;padding:16px 22px 20px}.kpi:last-child{border-right:0}
.kpi i{display:block;font:normal 12px ui-monospace,Consolas,monospace;color:var(--vino);margin-bottom:10px}
.kpi span{display:block;color:#a3a3a3;font-size:15px;margin-bottom:4px}
.kpi strong{display:block;font:700 clamp(30px,3.4vw,46px)/1 'Segoe UI',system-ui,sans-serif;color:#f5f5f5;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi small{display:block;font:13px ui-monospace,Consolas,monospace;color:#8a8a8a;margin-top:10px}
.listo{margin-top:14px;padding:10px 16px;border:1px solid var(--vino);color:#f5f5f5}
.botones{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.botones:empty{display:none}
button{background:#131313;color:#d4d4d4;border:1px solid #3e3e3e;padding:10px 16px;font:14px ui-monospace,Consolas,monospace;cursor:pointer}
button:hover{border-color:var(--vino);color:#fff}button:disabled{opacity:.6;cursor:default}
h2.seccion{font:12px ui-monospace,Consolas,monospace;color:#8a8a8a;letter-spacing:.1em;text-transform:uppercase;margin:34px 0 12px;border-bottom:1px solid #1c1c1c;padding-bottom:8px}

/* El grafo grande */
#grafo-montaje{max-width:1800px;margin:24px auto 0;padding:0 20px}
.lienzo{position:relative;height:min(78vh,820px);min-height:520px;overflow:hidden;border:1px solid #2a2a2a;background:radial-gradient(ellipse at 50% 45%,#141414 0%,#0a0a0a 70%);touch-action:none;cursor:grab;user-select:none}
.lienzo.moviendo{cursor:grabbing}
.lienzo svg{display:block;width:100%;height:100%}
.g-rotulo{position:absolute;top:14px;font:11px ui-monospace,Consolas,monospace;color:#5a5a5a;letter-spacing:.12em;text-transform:uppercase;pointer-events:none}
.g-izq{left:18px}.g-der{right:18px;text-align:right}
.g-controles{position:absolute;right:14px;bottom:14px;display:flex;gap:6px}
.g-controles button{background:#131313;color:#d4d4d4;border:1px solid #3e3e3e;padding:6px 11px;font:13px ui-monospace,Consolas,monospace;cursor:pointer;border-radius:3px}
.g-controles button:hover{border-color:var(--vino);color:#fff}
.arista{fill:none;stroke:#333;stroke-width:1.2;transition:stroke .4s}.arista.viva{stroke:#666}
.bus{fill:none;stroke:#2f2f2f;stroke-width:1;stroke-dasharray:3 5}
.cambio{fill:none;stroke:transparent;stroke-width:1.4;stroke-dasharray:5 4}.cambio.viva{stroke:#5c1822}
.nodo rect,.nodo circle.cuerpo{fill:#121212;stroke:#3e3e3e;stroke-width:1.2;transition:stroke .4s,fill .4s}
.nodo .nombre{font:600 16px 'Segoe UI',system-ui,sans-serif;fill:#f5f5f5}
.nodo .rol{font:12px ui-monospace,Consolas,monospace;fill:#8a8a8a}
.nodo .modelo{font:11px ui-monospace,Consolas,monospace;fill:#5a5a5a}.nodo .modelo.vino{fill:#c4485a}
.nodo .etiqueta{font:10.5px ui-monospace,Consolas,monospace;fill:#5a5a5a;letter-spacing:.1em}
.nodo{cursor:help}.nodo:hover rect,.nodo:hover circle.cuerpo{stroke:#a3a3a3}
.nodo.activo rect{stroke:var(--vino);fill:#170d0f}
.nodo.hecho rect{stroke:#6a6a6a}
.nodo.apartado rect{stroke:#5c1822;stroke-dasharray:5 4}
.nodo.falla rect{stroke:#c4485a;animation:parpadeo .35s steps(2) infinite}
.terminal rect{fill:#0c0c0c;stroke:#262626}
.terminal text{font:12px ui-monospace,Consolas,monospace;fill:#a3a3a3}.terminal text.ok{fill:#d4d4d4}.terminal text.mal{fill:#c4485a}
.nota{font:700 15px ui-monospace,Consolas,monospace;fill:#f5f5f5;opacity:0;transition:opacity .5s}.nota.vino{fill:#c4485a}
.aviso-falla{font:13px ui-monospace,Consolas,monospace;fill:#c4485a;opacity:0;transition:opacity .4s}
.tarjeta rect{fill:#141414;stroke:#444}.tarjeta text{font:600 14px ui-monospace,Consolas,monospace;fill:#d4d4d4}
.tarjeta.asignada rect{stroke:var(--vino)}.tarjeta.lista rect{fill:#5c1822;stroke:var(--vino)}
.anillo{fill:none;stroke:var(--vino);stroke-width:1.5;stroke-dasharray:6 9;transform-box:fill-box;transform-origin:center;animation:girar 30s linear infinite}
.halo{fill:var(--vino);opacity:.12;transform-box:fill-box;transform-origin:center;animation:latido 2.6s ease-in-out infinite}
.jefe-titulo{font:700 26px 'Segoe UI',system-ui,sans-serif;fill:#f5f5f5}.jefe-sub{font:12px ui-monospace,Consolas,monospace;fill:#c4485a;letter-spacing:.14em}.jefe-desc{font:11.5px ui-monospace,Consolas,monospace;fill:#8a8a8a}
.rotulo-svg{font:11px ui-monospace,Consolas,monospace;fill:#5a5a5a;letter-spacing:.12em;text-transform:uppercase}.rotulo-arista{font:12px ui-monospace,Consolas,monospace;fill:#a3a3a3}
.listo-svg{font:700 44px 'Segoe UI',system-ui,sans-serif;fill:#f5f5f5;opacity:0;transition:opacity .6s}.listo-svg tspan{fill:#c4485a}
.movil{opacity:.35;transition:opacity .4s}.movil.vibra{opacity:1;animation:vibrar .18s linear infinite}
.movil rect{fill:#111;stroke:#8a8a8a}.movil.vibra rect{stroke:#c4485a}
/* Un cuadrado punteado por plan, con la línea de tiempo de fases sobre su borde de arriba */
.caja-grupo{fill:#0d0d0d99;stroke:#4a4a4a;stroke-width:1.4;stroke-dasharray:7 6;transition:stroke .4s}
.grupo.actual .caja-grupo{stroke:#7a7a7a}
.grupo.atenuado{opacity:.42}
.titulo-grupo{font:600 14px 'Segoe UI',system-ui,sans-serif;fill:#f5f5f5}
.grupo .rol{font:12px ui-monospace,Consolas,monospace;fill:#8a8a8a}
.etq-fase{font:9.5px ui-monospace,Consolas,monospace;fill:#5f5f5f;letter-spacing:.06em;text-transform:uppercase;text-anchor:middle;pointer-events:none}.etq-fase.actual{fill:#e6e6e6}
.arista.tenue{stroke:#222}
.linea-fases{fill:none;stroke:var(--vino);stroke-width:2.2}
.punto-fase{stroke:#0a0a0a;stroke-width:2;transition:fill .4s}
.punto-fase.pasada{fill:#8a8a8a}.punto-fase.futura{fill:#2c2c2c;stroke:#3e3e3e}
.punto-fase.actual{fill:var(--vino);stroke:#f5f5f5;stroke-width:1.6}
.contador-agentes{font:700 30px 'Segoe UI',system-ui,sans-serif;fill:#f5f5f5}
.con-alarma{fill:#d9a441}
/* Los subagentes: nodos pequeños que se agrandan con un clic o cuando piden algo */
.nodo.sub{cursor:pointer}
.nodo.sub rect{fill:#141414;stroke:#3e3e3e;stroke-width:1.2}
.nodo.sub.abierto rect{fill:#121212;stroke:#6a6a6a}
.nombre-sub{font:600 14px 'Segoe UI',system-ui,sans-serif}
.punto-estado{fill:#8a8a8a}
.punto-estado.trabajando{fill:var(--vino);animation:parpadeo 1.4s ease-in-out infinite}
.punto-estado.listo{fill:#5ac18e}.punto-estado.error{fill:#e0505f}
.nodo.sub.abierto .insignia{font-weight:700}
.nodo.sub foreignObject{overflow:visible}
.fo-cuerpo{font:12.5px/1.4 'Segoe UI',system-ui,sans-serif;color:#d4d4d4;height:100%;overflow:auto;cursor:default;padding-right:2px}
.fo-texto{margin:0 0 6px;font-size:13.5px;color:#f5f5f5;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.fo-detalle{margin:0 0 6px;font:11.5px ui-monospace,Consolas,monospace;color:#9a9a9a;word-break:break-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fo-cat{margin:0 0 6px;font:11px ui-monospace,Consolas,monospace;color:#d9a441}
.fo-nota{margin:0 0 6px;font:11px ui-monospace,Consolas,monospace;color:#8a8a8a}
.fo-acciones{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}
.fo-cuerpo button{background:#131313;color:#d4d4d4;border:1px solid #3e3e3e;padding:5px 10px;font:12px ui-monospace,Consolas,monospace;cursor:pointer;border-radius:3px}
.fo-cuerpo button:hover{border-color:var(--vino);color:#fff}
.fo-cuerpo button:disabled{opacity:.55;cursor:default}
.fo-cuerpo .btn-principal{background:#c4485a;border-color:#c4485a;color:#fff}
.fo-cuerpo textarea{width:100%;box-sizing:border-box;min-height:44px;background:#0c0c0c;color:#d4d4d4;border:1px solid #3e3e3e;padding:6px 8px;font:12px ui-monospace,Consolas,monospace;border-radius:3px;resize:none}
.fo-cuerpo textarea:focus{outline:none;border-color:var(--vino)}
.fo-estado{font:11.5px ui-monospace,Consolas,monospace;color:#8a8a8a;margin-top:4px}.fo-estado.ok{color:#5ac18e}.fo-estado.aviso{color:#d9a441}.fo-estado.mal{color:#e0505f}
.fo-fila{display:flex;gap:10px;padding:2px 0;border-bottom:1px solid #1f1f1f}
.fo-k{flex:0 0 64px;font:11px ui-monospace,Consolas,monospace;color:#6a6a6a;text-transform:uppercase;letter-spacing:.06em}.fo-v{color:#e6e6e6;word-break:break-word}
.fo-salida{margin-top:6px;font:11px ui-monospace,Consolas,monospace;color:#8a8a8a;word-break:break-all}
@media (min-width:701px){#pendientes{display:none}}
@keyframes girar{to{transform:rotate(360deg)}}
@keyframes latido{0%,100%{transform:scale(1);opacity:.1}50%{transform:scale(1.18);opacity:.22}}
@keyframes parpadeo{50%{opacity:.35}}
@keyframes vibrar{0%{transform:translate(0,0)}25%{transform:translate(-2px,1px)}50%{transform:translate(2px,-1px)}75%{transform:translate(-1px,-1px)}}
@keyframes pulso-amarillo{0%,100%{stroke-opacity:.35}50%{stroke-opacity:1}}
@keyframes pulso-azul{0%,100%{stroke-opacity:.35}50%{stroke-opacity:1}}
@keyframes pulso-rojo{0%,100%{stroke-opacity:.3}50%{stroke-opacity:1}}
.nodo.card{transition:transform .45s cubic-bezier(.2,.7,.2,1)}
.nodo.card rect{fill:#121212;stroke:#3e3e3e;stroke-width:1.2;transition:stroke .4s,fill .4s}
.nodo.card.activo rect{stroke:var(--vino);fill:#170d0f}
.nodo.card.hecho rect{stroke:#6a6a6a}
.nodo.card.falla rect{stroke:#c4485a;animation:parpadeo .35s steps(2) infinite}
.nodo.card.alarma-silencio rect{stroke:#d9a441;animation:pulso-amarillo 2.5s ease-in-out infinite}
.nodo.card.alarma-pregunta rect{stroke:#5b9bd5;animation:pulso-azul 2s ease-in-out infinite}
.nodo.card.alarma-permiso rect{stroke:#e0505f;animation:pulso-rojo 1.2s ease-in-out infinite}
.card .insignia{font:11px ui-monospace,Consolas,monospace;fill:#d9a441}
.card .insignia.pregunta{fill:#5b9bd5}
.card .insignia.permiso{fill:#e0505f}
.card-entra{animation:card-entra 0.35s ease-out}
@keyframes card-entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.contador-agentes{font:700 28px 'Segoe UI',system-ui,sans-serif;fill:#f5f5f5}
.paso{display:grid;grid-template-columns:1fr;gap:18px;margin-top:20px;padding:22px 24px;border:1px solid #2a2a2a;background:#111}
@media (min-width:900px){.paso{grid-template-columns:340px 1fr}}
.paso h2{font:700 28px/1.1 'Segoe UI',system-ui,sans-serif;color:#f5f5f5;margin:0}.paso h2 i{font:normal 15px ui-monospace,Consolas,monospace;color:#c4485a;display:block;margin-bottom:6px}
.paso p{margin:0;color:#d4d4d4;font-size:17px;min-height:52px}.paso .rotulo{margin:0 0 6px}
.fases,.fases-nombres{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}.fases{margin-top:16px}
.fases span{height:6px;background:#262626;transition:background .4s}.fases span.pasada{background:#555}.fases span.actual{background:var(--vino)}
.fases-nombres{margin-top:6px;font:10.5px ui-monospace,Consolas,monospace;color:#5a5a5a;text-transform:uppercase;letter-spacing:.04em}
@media (max-width:700px){.fases-nombres{display:none}}
.g-lista{display:none}
.g-fila{border:1px solid #2a2a2a;background:#111;padding:12px 14px}
.g-fila.activo{border-color:var(--vino);background:#170d0f}.g-fila.falla{border-color:#c4485a}.g-fila.apartado{border-style:dashed;border-color:#5c1822}
.g-cab{display:flex;justify-content:space-between;gap:10px;font:14px ui-monospace,Consolas,monospace}.g-cab b{color:#f5f5f5;font:600 16px 'Segoe UI',system-ui,sans-serif}.g-cab span{color:#a3a3a3}
.g-fila small{display:block;color:#5a5a5a;font:12px ui-monospace,Consolas,monospace;margin-top:2px}
.g-fila pre{margin:8px 0 0;color:#a3a3a3;font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}.g-fila pre:empty{display:none}
@media (max-width:700px){#grafo-montaje .lienzo{display:none}.g-lista{display:grid;gap:8px;margin-top:0}}
#g-tip{position:fixed;z-index:10;max-width:320px;padding:12px 14px;background:#141414;border:1px solid var(--vino);color:#d4d4d4;font-size:14px;line-height:1.45;pointer-events:none;opacity:0;transition:opacity .15s}
#g-tip b{display:block;color:#f5f5f5;font-size:15px;margin-bottom:4px}
@media (prefers-reduced-motion:reduce){.punto-estado.trabajando,.anillo,.halo,.movil.vibra,.nodo.falla rect,.nodo.card.alarma-silencio rect,.nodo.card.alarma-pregunta rect,.nodo.card.alarma-permiso rect,.card-entra{animation:none!important}.nodo.card{transition:none!important}}

/* Pendientes: consultas de los agentes */
#pendientes{margin-top:24px}
.consulta{border:1px solid #2a2a2a;background:#111;padding:16px 18px;margin-bottom:12px;border-radius:4px}
.consulta.permiso{border-color:#e0505f}
.consulta.pregunta{border-color:#5b9bd5}
.consulta .insignia-c{display:flex;align-items:center;gap:8px;margin-bottom:10px;font:11px ui-monospace,Consolas,monospace;text-transform:uppercase;letter-spacing:.08em}
.consulta .insignia-c .agente{color:#c4485a;font-weight:700}
.consulta .insignia-c .tipo{padding:2px 8px;border-radius:3px;font-size:10px}
.consulta.permiso .insignia-c .tipo{background:#3a1216;color:#e0505f}
.consulta.pregunta .insignia-c .tipo{background:#12263a;color:#5b9bd5}
.consulta .texto-c{font:600 17px/1.3 'Segoe UI',system-ui,sans-serif;color:#f5f5f5;margin-bottom:6px}
.consulta .detalle-c{font:12px ui-monospace,Consolas,monospace;color:#8a8a8a;margin-bottom:10px}
.consulta .categoria-c{font:11px ui-monospace,Consolas,monospace;color:#d9a441;margin-bottom:10px}
.consulta .acciones-c{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.consulta button{background:#131313;color:#d4d4d4;border:1px solid #3e3e3e;padding:8px 14px;font:13px ui-monospace,Consolas,monospace;cursor:pointer;border-radius:3px}
.consulta button:hover{border-color:var(--vino);color:#fff}
.consulta button:disabled{opacity:.6;cursor:default}
.consulta .btn-principal{background:#c4485a;border-color:#c4485a;color:#fff}
.consulta .btn-principal:hover{background:#d65a6c;border-color:#d65a6c}
.consulta textarea{width:100%;min-height:56px;max-height:140px;background:#0c0c0c;color:#d4d4d4;border:1px solid #3e3e3e;padding:8px 10px;font:13px ui-monospace,Consolas,monospace;border-radius:3px;resize:vertical;margin-top:8px}
.consulta textarea:focus{outline:none;border-color:var(--vino)}
.consulta .estado-c{font:12px ui-monospace,Consolas,monospace;color:#8a8a8a;margin-top:8px}
.consulta .nota-c{font:11px ui-monospace,Consolas,monospace;color:#8a8a8a;margin-top:8px}
.consulta .opciones-c{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
@media (max-width:700px){.consulta{padding:14px 12px}}

/* Gráficas y tablas */
.rejilla{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(520px,100%),1fr));gap:24px;align-items:start}
.rejilla svg,.detalles svg{display:block;width:100%;height:auto}
.detalles{display:grid;grid-template-columns:1fr;gap:24px;align-items:start;margin-bottom:24px}
@media (min-width:1100px){.detalles{grid-template-columns:var(--cols,1fr 1fr)}}
table{width:100%;border-collapse:collapse;font:14px ui-monospace,Consolas,monospace}
td{padding:7px 10px;border-bottom:1px solid #161616;color:#a3a3a3;vertical-align:top}td small{color:#5a5a5a}
tr.hecha td{color:#d4d4d4}tr.curso td{color:#f5f5f5}tr.curso td:first-child{border-left:2px solid var(--vino)}tr.mal td{color:#c4485a}
.vacio{color:#5a5a5a;font:13px ui-monospace,Consolas,monospace}
footer{max-width:1800px;margin:40px auto;padding:0 20px;color:#5a5a5a;font:12px ui-monospace,Consolas,monospace}
`

// Texto JSON seguro dentro de <script>: sin "<" no puede cerrarse la etiqueta desde dentro.
const jsonSeguro = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c')

export function paginaCentro(d: DatosPagina): string {
  const ahora = d.ahora ?? Date.now()
  const subs = d.plan?.subtareas ?? []
  const hechas = subs.filter(s => s.estado === 'hecha').length
  const pct = subs.length ? Math.round((hechas / subs.length) * 100) : 0
  const corriendo = d.trabajos.filter(t => t.estado === 'corriendo')
  const tokIn = d.trabajos.reduce((a, t) => a + (t.tokensIn ?? 0), 0)
  const tokOut = d.trabajos.reduce((a, t) => a + (t.tokensOut ?? 0), 0)
  const kpis = [
    ['Progreso', subs.length ? `${pct}%` : '—', subs.length ? `${hechas} de ${subs.length} subtareas` : 'sin plan'],
    ['Trabajando', String(corriendo.length), corriendo.length ? corto(corriendo.map(t => t.trabajador.split(':')[0]).join(', '), 40) : 'nadie ahora'],
    ['Tokens', miles(tokIn + tokOut), `${miles(tokIn)} leídos · ${miles(tokOut)} escritos`],
    ['Ahorro', `$${d.ahorro.toFixed(2)}`, 'frente a Claude Sonnet'],
  ]
  const boton = (texto: string, accion: object) => `<button data-accion="${esc(JSON.stringify(accion))}">${esc(texto)}</button>`
  const botones = [
    ...d.cancelables.map(c => boton(`■ Cancelar ${c.titulo}`, { tipo: 'cancelar', id: c.id })),
    ...d.relanzables.map(r => boton(`↻ Relanzar ${r.n} · ${r.titulo}`, { tipo: 'relanzar', n: r.n })),
  ].join('')
  const listo = subs.length > 0 && hechas === subs.length ? d.plan!.objetivo : ''

  const filasPlan = subs
    .map(s => `<tr class="${s.estado === 'hecha' ? 'hecha' : s.estado === 'en curso' ? 'curso' : ''}"><td>${s.n}</td><td>${esc(s.titulo)}${s.espera?.length ? ` <small>espera ${s.espera.join(', ')}</small>` : ''}</td><td>${esc(s.estado)}</td><td>${esc(s.quien ?? '')}</td><td>${s.puntaje !== undefined ? `${s.puntaje}/10` : ''}</td></tr>`)
    .join('')
  const historial = [...d.trabajos]
    .reverse()
    .filter(t => t.estado !== 'corriendo')
    .slice(0, 14)
    .map(t => `<tr class="${t.estado === 'error' ? 'mal' : ''}"><td>${t.estado === 'error' ? '✗' : '✓'}</td><td>${esc(t.trabajador)}${t.skills?.length ? ` <small>✦ ${esc(t.skills.join(', '))}</small>` : ''}</td><td>${t.subtarea ?? ''}</td><td>${seg(t.ms ?? 0)}</td><td>${t.tokensIn !== undefined ? `${miles(t.tokensIn)}→${miles(t.tokensOut ?? 0)}` : ''}</td><td>${t.puntaje !== undefined ? `${t.puntaje}/10` : ''}</td></tr>`)
    .join('')

  // Solo lo necesario para el grafo; la salida se recorta para que la página no pese.
  const datos = {
    jefe: d.jefe,
    ahora,
    plan: d.plan,
    trabajos: d.trabajos.slice(-60).map(t => ({ id: t.id, trabajador: t.trabajador, estado: t.estado, subtarea: t.subtarea, inicio: t.inicio, ms: t.ms, puntaje: t.puntaje, salida: (t.salida ?? '').slice(-400), skills: t.skills, tokensIn: t.tokensIn, tokensOut: t.tokensOut, ultimaActividad: t.ultimaActividad, plan: t.plan })),
    planes: (d.planes ?? []).slice(-6).map(p => ({ objetivo: p.objetivo, subtareas: p.subtareas.map(x => ({ n: x.n, titulo: x.titulo, estado: x.estado, quien: x.quien, puntaje: x.puntaje })) })),
    agentes: d.agentes,
    modelos: d.modelos,
    listo,
    pendientes: (d.pendientes ?? []).map(p => ({
      id: String(p.id),
      consulta: String(p.consulta),
      agente: String(p.agente),
      tipo: p.tipo,
      texto: String(p.texto).slice(0, 600),
      detalle: p.detalle ? String(p.detalle).slice(0, 800) : undefined,
      categoria: p.categoria ? String(p.categoria).slice(0, 30) : undefined,
      opciones: p.opciones ? p.opciones.slice(0, 6).map(o => String(o).slice(0, 80)) : undefined,
      en: p.en
    })),
    esperaSilencioMs: 60000,
  }
  const titulo = `${d.chat} · ${d.jefe} jefe · ${d.plan ? corto(d.plan.objetivo, 40) : 'sin plan'}`
  const graficas = [graficaTokens(d.trabajos), grafica(d.rendimiento), graficaTiempo(d.trabajos, ahora), graficaNotas(d.trabajos), graficaAhorro(d.trabajos)].join('')

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>
<header><p class="rotulo">/mst · orquestador de agentes · jefe: ${esc(d.jefe)} · ${esc(d.chat)} · <a href="/todos?t=${encodeURIComponent(d.clave)}">todos los chats</a></p><h1>Centro de agentes <b>MST</b></h1></header>
<div id="v1" class="cinta"><script id="datos" type="application/json">${jsonSeguro(datos)}</script>${d.plan ? `<p class="obj">${esc(d.plan.objetivo)}</p>` : ''}
<div class="kpis">${kpis.map(([e, v, n], i) => `<div class="kpi"><i>0${i + 1}</i><span>${esc(e)}</span><strong>${esc(v)}</strong><small>${esc(n)}</small></div>`).join('')}</div>
${listo ? `<div class="listo">✓ Todo listo · ${esc(listo)}</div>` : ''}<div class="botones">${botones}</div></div>
<div id="grafo-montaje"></div>
<section id="pendientes" class="cinta" aria-live="polite"></section>
<div id="v2" class="cinta">
${d.extra ? `<h2 class="seccion">Detalles del chat</h2><div class="detalles" style="--cols:${d.columnasExtra ?? '1fr 1fr'}">${d.extra}</div>` : ''}
<h2 class="seccion">Gráficas</h2><div class="rejilla">${graficas}</div>
<h2 class="seccion">Subtareas</h2>${filasPlan ? `<table>${filasPlan}</table>` : '<p class="vacio">El jefe aún no ha hecho el plan.</p>'}
<h2 class="seccion">Historial</h2>${historial ? `<table>${historial}</table>` : '<p class="vacio">Sin trabajos terminados.</p>'}
</div>
<footer>Centro de agentes MST ${esc(d.version)} · se actualiza cada 2 s sin recargar</footer>
<script type="module">
import { crearGrafo } from '/grafo.js'
const leer = doc => JSON.parse(doc.getElementById('datos').textContent)
const grafo = crearGrafo(document.getElementById('grafo-montaje'))
let datos = leer(document)
grafo.actualizar(datos)
// Los botones llevan la orden a este chat (location.search ya trae la clave y el chat) y a ningún otro.
document.addEventListener('click', async ev => {
  const b = ev.target.closest('button[data-accion]')
  if (!b) return
  b.disabled = true; b.textContent = 'enviando…'
  try { await fetch('/accion' + location.search, { method: 'POST', body: b.dataset.accion }); b.textContent = 'enviado ✓' } catch { b.textContent = 'no se pudo enviar' }
})

// Pinta las consultas pendientes de los agentes
const pendientesVistos = new Set()
function pintarPendientes(lista) {
  const sec = document.getElementById('pendientes')
  if (!sec) return
  const actuales = new Set(lista.map(p => p.consulta))
  // Eliminar tarjetas que ya no están en la lista
  for (const el of sec.querySelectorAll('.consulta')) {
    const cid = el.dataset.consulta
    if (cid && !actuales.has(cid)) el.remove()
  }
  // Título
  let titulo = sec.querySelector('.pendientes-titulo')
  if (lista.length > 0) {
    if (!titulo) {
      titulo = document.createElement('p')
      titulo.className = 'pendientes-titulo'
      titulo.style.cssText = 'font:12px ui-monospace,Consolas,monospace;color:#8a8a8a;letter-spacing:.1em;text-transform:uppercase;margin:0 0 12px'
      sec.insertBefore(titulo, sec.firstChild)
    }
    titulo.textContent = 'Esperan tu respuesta (' + lista.length + ')'
  } else if (titulo) {
    titulo.remove()
  }
  // Crear/actualizar tarjetas
  for (const p of lista) {
    // Una tarjeta que ya está dibujada no se toca: el usuario puede estar escribiendo en ella.
    if ([...sec.querySelectorAll('.consulta')].some(e => e.dataset.consulta === p.consulta)) continue
    const esNueva = true
    const tarjeta = document.createElement('div')
    tarjeta.className = 'consulta ' + (p.tipo === 'permiso' ? 'permiso' : 'pregunta')
    tarjeta.dataset.consulta = p.consulta
    sec.appendChild(tarjeta)
    let categoriaDiv = null
    // Insignia
    const insignia = document.createElement('div')
    insignia.className = 'insignia-c'
    const agenteSpan = document.createElement('span')
    agenteSpan.className = 'agente'
    agenteSpan.textContent = p.agente
    const tipoSpan = document.createElement('span')
    tipoSpan.className = 'tipo'
    tipoSpan.textContent = p.tipo === 'permiso' ? 'PERMISO' : 'PREGUNTA'
    insignia.append(agenteSpan, tipoSpan)
    // Texto principal
    const textoDiv = document.createElement('div')
    textoDiv.className = 'texto-c'
    textoDiv.textContent = p.texto
    // Detalle
    const detalleDiv = document.createElement('div')
    detalleDiv.className = 'detalle-c'
    detalleDiv.textContent = p.detalle ?? ''
    if (!p.detalle) detalleDiv.style.display = 'none'
    // Acciones
    const acciones = document.createElement('div')
    acciones.className = 'acciones-c'
    if (p.tipo === 'permiso') {
      const btnAprobar = document.createElement('button')
      btnAprobar.className = 'btn-principal'
      btnAprobar.textContent = 'Aprobar'
      btnAprobar.dataset.decision = 'aprobar'
      const btnDenegar = document.createElement('button')
      btnDenegar.textContent = 'Denegar'
      btnDenegar.dataset.decision = 'denegar'
      const btnSiempre = document.createElement('button')
      btnSiempre.className = 'btn-principal'
      btnSiempre.textContent = 'Permitir siempre en esta petición'
      btnSiempre.dataset.decision = 'siempre'
      const cat = p.categoria
      if (!cat || cat === 'destructivo') {
        btnSiempre.style.display = 'none'
        const nota = document.createElement('div')
        nota.className = 'nota-c'
        nota.textContent = 'Los comandos destructivos siempre se preguntan.'
        acciones.append(btnAprobar, btnDenegar, nota)
      } else {
        acciones.append(btnAprobar, btnDenegar, btnSiempre)
      }
      // Categoría
      if (cat) {
        categoriaDiv = document.createElement('div')
        categoriaDiv.className = 'categoria-c'
        categoriaDiv.textContent = 'Categoría: ' + cat
      }
    } else {
      // Pregunta: opciones + textarea
      if (p.opciones && p.opciones.length) {
        const optsDiv = document.createElement('div')
        optsDiv.className = 'opciones-c'
        for (const op of p.opciones) {
          const btn = document.createElement('button')
          btn.textContent = op
          btn.dataset.decision = 'texto'
          btn.dataset.texto = op
          optsDiv.appendChild(btn)
        }
        acciones.appendChild(optsDiv)
      }
      const ta = document.createElement('textarea')
      ta.placeholder = 'Escribe tu respuesta… (Ctrl+Enter para enviar)'
      ta.style.marginTop = '8px'
      const btnEnviar = document.createElement('button')
      btnEnviar.className = 'btn-principal'
      btnEnviar.textContent = 'Enviar'
      btnEnviar.dataset.decision = 'texto'
      btnEnviar.dataset.textarea = '1'
      acciones.append(ta, btnEnviar)
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          btnEnviar.click()
        }
      })
    }
    // Estado
    const estado = document.createElement('div')
    estado.className = 'estado-c'
    estado.style.display = 'none'
    // Montar
    tarjeta.append(insignia, textoDiv, detalleDiv)
    if (categoriaDiv) tarjeta.append(categoriaDiv)
    tarjeta.append(acciones, estado)
    // Los botones solo se conectan una vez: la tarjeta no se vuelve a dibujar.
    if (esNueva) {
      tarjeta.addEventListener('click', async ev => {
        const btn = ev.target.closest('button[data-decision]')
        if (!btn) return
        const decision = btn.dataset.decision
        let texto = ''
        if (decision === 'texto') {
          if (btn.dataset.textarea) {
            const ta = tarjeta.querySelector('textarea')
            texto = ta?.value?.trim() ?? ''
            if (!texto) return
          } else {
            texto = btn.dataset.texto ?? ''
          }
        }
        const controles = tarjeta.querySelectorAll('button, textarea')
        controles.forEach(c => { c.disabled = true })
        estado.style.display = 'block'
        estado.textContent = 'enviando…'
        try {
          const r = await fetch('/accion' + location.search, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'responder', id: p.consulta, decision, texto })
          })
          if (r.status === 200) {
            estado.textContent = 'enviado ✓'
            estado.style.color = '#5b9bd5'
          } else if (r.status === 409) {
            estado.textContent = 'ya estaba respondida'
            estado.style.color = '#d9a441'
          } else {
            throw new Error(String(r.status))
          }
        } catch {
          estado.textContent = 'no se pudo enviar'
          estado.style.color = '#c4485a'
          controles.forEach(c => { c.disabled = false })
        }
      })
    }
    // Notificación solo la primera vez que aparece
    if (esNueva && !pendientesVistos.has(p.consulta)) {
      pendientesVistos.add(p.consulta)
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Un agente espera tu respuesta', { body: p.agente + ': ' + p.texto.slice(0, 120) })
        }
      } catch {}
    }
  }
}
// Llamada inicial
pintarPendientes(datos.pendientes ?? [])
if ((datos.pendientes ?? []).length) document.title = '(' + datos.pendientes.length + ') ' + document.title

function avisar(listo) {
  try {
    if (listo && localStorage.getItem('centro-avisado') !== listo) {
      localStorage.setItem('centro-avisado', listo)
      if ('Notification' in window) Notification.requestPermission().then(p => { if (p === 'granted') new Notification('Centro de agentes MST', { body: 'Todo listo: ' + listo }) })
    }
  } catch {}
}
avisar(datos.listo)
async function vuelta() {
  try {
    const r = await fetch(location.href, { cache: 'no-store' })
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html')
    for (const id of ['v1', 'v2']) document.getElementById(id).innerHTML = doc.getElementById(id).innerHTML
    datos = leer(doc)
    document.title = doc.title
    // Prefijo de pendientes en el título
    const n = (datos.pendientes ?? []).length
    if (n > 0) document.title = '(' + n + ') ' + document.title
    grafo.actualizar(datos)
    avisar(datos.listo)
    pintarPendientes(datos.pendientes ?? [])
  } catch {}
  setTimeout(vuelta, 2000)
}
setTimeout(vuelta, 2000)
</script></body></html>`
}
