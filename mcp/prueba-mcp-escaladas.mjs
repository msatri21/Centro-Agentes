import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-escaladas-'))
const bin = path.join(tmp, 'bin'), servidor = fileURLToPath(new URL('./centro-mcp.mjs', import.meta.url))
fs.mkdirSync(bin)
const falso = path.join(bin, 'opencode-falso.mjs')
fs.writeFileSync(falso, `import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
const tarea=fs.readFileSync(0,'utf8'), espera=n=>new Promise(r=>setTimeout(r,n))
if(tarea.includes('callado')) await espera(1800)
if(tarea.includes('espera permiso')||tarea.includes('pregunta normal')) await espera(3000)
if(tarea.includes('escribe')) for(let i=0;i<14;i++){console.log(JSON.stringify({type:'text',part:{text:'avance'}}));await espera(100)}
if(tarea.includes('falla')) { console.log(JSON.stringify({type:'text',part:{text:'[error] fallo deliberado'}})); process.exit(1) }
const n=Number(tarea.match(/archivos (\\d+)/)?.[1]||0)
for(let i=0;i<n;i++) fs.writeFileSync('archivo-'+i+'.txt','dato')
if(tarea.includes('choque')) fs.writeFileSync('choque.txt',tarea.includes('uno')?'uno':'dos')
// El agente guarda su trabajo él mismo, como hace un agente real: el commit del centro fallará.
if(tarea.includes('commit propio')) { fs.writeFileSync('propio.txt','dato'); execFileSync('git',['add','.'],{stdio:'ignore'}); execFileSync('git',['-c','user.email=t@e','-c','user.name=T','commit','-qm','agente'],{stdio:'ignore'}) }
console.log(JSON.stringify({type:'text',part:{text:'resultado falso'}}))
`)
if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" "${falso}" %*\r\n`)
else { const exe=path.join(bin,'opencode'); fs.writeFileSync(exe,`#!/usr/bin/env node\nawait import(${JSON.stringify(falso)})\n`); fs.chmodSync(exe,0o755) }
const chats=path.join(tmp,'chats')
const base=process.platform==='win32'?[process.env.SystemRoot+'\\System32',process.env.SystemRoot,path.dirname(process.execPath)]:[path.dirname(process.execPath),'/usr/bin','/bin']
// Las copias aisladas necesitan git: se añade su carpeta al PATH restringido del servidor.
base.push(path.dirname(execFileSync(process.platform==='win32'?'where':'which',['git']).toString().split(/\r?\n/)[0]))
const p=spawn(process.execPath,[servidor],{env:{...process.env,PATH:[bin,...base].join(path.delimiter),HOME:tmp,USERPROFILE:tmp,CENTRO_TRABAJADOR:'0',CENTRO_CHATS:chats,CENTRO_SIN_WEB:'1',CENTRO_SIN_NAVEGADOR:'1',CENTRO_SIN_CATALOGO:'1',CENTRO_INACTIVIDAD_MS:'400',CENTRO_VIGILANTE_MS:'100',CENTRO_MODELOS:JSON.stringify({opencode:Array.from({length:30},(_,i)=>'opencode/m'+(i+1)),ollama:[],hermes:[],aider:[],codex:[],claude:[]})},stdio:['pipe','pipe','inherit']})
let resto='',seq=0
const pendientes=new Map()
p.stdout.on('data',d=>{resto+=d;let i;while((i=resto.indexOf('\n'))>=0){const m=JSON.parse(resto.slice(0,i));resto=resto.slice(i+1);pendientes.get(m.id)?.(m)}})
const pedir=(method,params={})=>new Promise(resolve=>{const id=++seq;pendientes.set(id,resolve);p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})
const llamar=async(name,args={})=>JSON.parse((await pedir('tools/call',{name,arguments:args})).result.content[0].text)
const dormir=ms=>new Promise(r=>setTimeout(r,ms))
const esperar=async(id)=>{const avisos=[];for(let i=0;i<100;i++){const e=await llamar('estado',{ids:[id],esperar_seg:1});avisos.push(...(e.avisos_web??[]));if(e.terminados+e.fallidos)return {...e.encargos[0].resultado,avisos_web:avisos};await dormir(20)}throw Error('encargo no termino')}
const delegar=(tarea,extra={})=>llamar('delegar',{categoria:'prueba',tarea,trabajador:'opencode',necesita:[],...extra})
try {
 await pedir('initialize',{protocolVersion:'2025-06-18'})
 const silencioso=await delegar('callado'); await dormir(900)
 let estado=await llamar('estado',{ids:[silencioso.encargo]})
 assert.equal(estado.avisos_web.filter(x=>x.includes('ESCALADA (inactivo)')).length,1)
 const activo=await delegar('escribe'); await dormir(900)
 estado=await llamar('estado',{ids:[activo.encargo]})
 assert.equal((estado.avisos_web??[]).filter(x=>x.includes('ESCALADA (inactivo)')).length,0)

 const chat=path.join(chats,fs.readdirSync(chats)[0])
 const permiso=await delegar('espera permiso'); await dormir(150)
 const consulta={id:'cp',trabajo:'',tipo:'permiso',categoria:'instalar',texto:'Instalar herramienta',en:Date.now()}
 for(let i=0;i<30&&!consulta.trabajo;i++){await dormir(100);consulta.trabajo=JSON.parse(fs.readFileSync(path.join(chat,'estado.json'),'utf8')).trabajos.find(x=>x.estado==='corriendo'&&x.tarea.includes('espera permiso'))?.id??''}
 assert.ok(consulta.trabajo)
 fs.appendFileSync(path.join(chat,'consultas.jsonl'),JSON.stringify(consulta)+'\n')
 await dormir(250)
 estado=await llamar('estado',{ids:[permiso.encargo]})
 assert.ok(estado.avisos_web.some(x=>x.includes('ESCALADA (permiso)')&&x.includes('Instalar herramienta')))
 fs.appendFileSync(path.join(chat,'respuestas.jsonl'),JSON.stringify({id:'cp',decision:'denegar'})+'\n')
 const pregunta=await delegar('pregunta normal'); await dormir(120)
 let t
 for(let i=0;i<30&&!t;i++){await dormir(100);t=JSON.parse(fs.readFileSync(path.join(chat,'estado.json'),'utf8')).trabajos.find(x=>x.estado==='corriendo'&&x.tarea.includes('pregunta normal'))}
 assert.ok(t)
 fs.appendFileSync(path.join(chat,'consultas.jsonl'),JSON.stringify({id:'cq',trabajo:t.id,tipo:'pregunta',categoria:'general',texto:'Cual opcion?',en:Date.now()})+'\n')
 await dormir(200); estado=await llamar('estado',{ids:[pregunta.encargo]})
 assert.equal((estado.avisos_web??[]).filter(x=>x.includes('ESCALADA (permiso)')).length,0)
 fs.appendFileSync(path.join(chat,'respuestas.jsonl'),JSON.stringify({id:'cq',decision:'responder',texto:'x'})+'\n')

 // Un modelo que falla queda apartado un rato: hay modelos de sobra para que cada delegación tenga con quién probar.
 const racha=async tareas=>{const avisos=[];for(const tarea of tareas){const r=await delegar(tarea,{subtarea:9});const e=await esperar(r.encargo);avisos.push(...e.avisos_web)}return avisos.filter(x=>x.includes('ESCALADA (fallos)')).length}
 assert.equal(await racha(['falla uno','falla dos']),1)
 assert.equal(await racha(['exito']),0)
 assert.equal(await racha(['falla tres','falla cuatro']),1)

 const repo=path.join(tmp,'repo'); fs.mkdirSync(repo); const git=(...a)=>{const r=spawn(process.platform==='win32'?'git':'git',['-C',repo,...a],{stdio:'ignore'});return new Promise(ok=>r.on('close',ok))}
 await git('init','-q'); await git('config','user.email','test@example.com'); await git('config','user.name','Prueba'); fs.writeFileSync(path.join(repo,'base.txt'),'base'); await git('add','.'); await git('commit','-qm','base')
 for(const n of [16,15]) {
  const r=await delegar(`archivos ${n}`,{cwd:repo,aislar:true}); const res=await esperar(r.encargo)
  assert.equal(res.copia.archivos.length,n)
  assert.equal(res.escalar?.includes('masiva')??false,n===16)
  assert.equal((res.avisos_web??[]).some(x=>x.includes('ESCALADA (modificación masiva')),n===16)
 }
 // Si el agente ya hizo su propio commit, la rama y la copia se conservan con su trabajo.
 const propia=await delegar('commit propio',{cwd:repo,aislar:true}); const resPropia=await esperar(propia.encargo)
 assert.ok(resPropia.copia?.rama)
 assert.ok(fs.existsSync(path.join(resPropia.copia.carpeta,'propio.txt')))
 assert.ok(resPropia.copia.archivos.includes('propio.txt'))
 assert.ok(execFileSync('git',['-C',repo,'branch','--list',resPropia.copia.rama]).toString().includes(resPropia.copia.rama))
 const lote=await llamar('delegar_varios',{tareas:['choque uno','choque dos'].map(tarea=>({cwd:repo,aislar:true,categoria:'prueba',tarea,trabajador:'opencode'}))})
 // El aviso del grupo llega cuando termina el último encargo: cada consulta vuelve en cuanto acaba uno, así que se acumulan los avisos.
 const avisosLote=[]
 for(let i=0;i<20&&!avisosLote.some(x=>x.includes('ESCALADA (choque de ramas)'));i++) avisosLote.push(...((await llamar('estado',{grupo:lote.grupo,esperar_seg:10})).avisos_web??[]))
 assert.ok(avisosLote.some(x=>x.includes('ESCALADA (choque de ramas)')))
 // esperar_seg espera a que termine OTRO encargo más: si ya había terminado alguno y volviera al instante, el jefe sondearía en bucle.
 const par=await llamar('delegar_varios',{tareas:['rapido','callado'].map(tarea=>({categoria:'prueba',tarea,trabajador:'opencode'}))})
 let parcial
 do { parcial=await llamar('estado',{grupo:par.grupo,esperar_seg:10}) } while(parcial.terminados+parcial.fallidos<1)
 assert.equal(parcial.terminados+parcial.fallidos,1)
 const inicioEspera=Date.now(), completo=await llamar('estado',{grupo:par.grupo,esperar_seg:10})
 assert.ok(Date.now()-inicioEspera>=500,'con un encargo ya terminado, esperar_seg espera al siguiente')
 assert.equal(completo.terminados+completo.fallidos,2)
 p.kill(); console.log('ok: escaladas MCP')
} finally { try{p.kill()}catch{} await dormir(100); fs.rmSync(tmp,{recursive:true,force:true}) }
