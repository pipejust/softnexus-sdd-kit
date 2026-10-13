#!/usr/bin/env node
// Arranque independiente del plugin y de la carpeta del proyecto. Mac, Linux y Windows.
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const PLUGIN='softnexus-sdd@softnexus';
const BASE='https://raw.githubusercontent.com/pipejust/softnexus-sdd-kit/main';
const json=(f)=>JSON.parse(readFileSync(f,'utf8').replace(/^\uFEFF/,''));
export function versionAlMenos(actual,esperada) {
  if (![actual,esperada].every(v=>/^\d+\.\d+\.\d+$/.test(String(v)))) return false;
  const a=actual.split('.').map(Number),b=esperada.split('.').map(Number);
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i]}
  return true;
}
export function leerInstalaciones(casa=os.homedir()) {
  const f=path.join(casa,'.claude/plugins/installed_plugins.json');
  if(!existsSync(f))return [];
  const rows=json(f).plugins?.[PLUGIN]||[];
  if(!Array.isArray(rows))throw new Error('Registro de instalaciones inválido.');
  return rows;
}
export function comprobarVersiones(esperada,rows,{soloUsuario=false}={}) {
  if(!rows.some(i=>i.scope==='user'))throw new Error('No existe instalación de usuario confirmada.');
  const checked=[];
  for(const i of rows.filter(i=>!soloUsuario||i.scope==='user')) {
    const label=`${i.scope}${i.projectPath?' · '+i.projectPath:''}`;
    if(!i.installPath)throw new Error(`${label}: falta la ruta de instalación.`);
    const manifest=path.join(i.installPath,'.claude-plugin/plugin.json');
    if(!existsSync(manifest))throw new Error(`${label}: no existe el manifiesto instalado.`);
    const real=json(manifest).version;
    if(!versionAlMenos(real,esperada)||i.version!==real)throw new Error(`${label}: registro ${i.version||'?'} · archivos ${real||'?'} · requerida ${esperada}. No quedó actualizado.`);
    if(!existsSync(path.join(i.installPath,'scripts/sn-sync.mjs')))throw new Error(`${label}: falta el motor instalado.`);
    checked.push({scope:i.scope,project:i.projectPath||'',version:real});
  }
  return checked;
}
export async function publicada(fetcher=fetch) {
  const r=await fetcher(`${BASE}/plugin/.claude-plugin/plugin.json`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`No pude consultar la versión publicada: HTTP ${r.status}.`);
  const version=(await r.json()).version;
  if(!versionAlMenos(version,version))throw new Error('La versión publicada no es válida.');
  return version;
}
function ejecutar(cmd,args,cwd) {
  const options={cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,windowsHide:true};
  if(process.platform==='win32'&&cmd==='claude') {
    // Todos los argumentos son constantes o scopes validados; las rutas viajan en cwd, sin shell.
    const out=execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',[cmd,...args].join(' ')],{...options,windowsHide:true});
    if(out?.trim())console.log(out.trim()); return out;
  }
  const out=execFileSync(cmd,args,{...options,windowsHide:true});
  if(out?.trim())console.log(out.trim()); return out;
}
export async function actualizarTodo({casa=os.homedir(),consultar=publicada,correr=ejecutar,log=console.log,verificarSolo=false}={}) {
  const esperada=await consultar(); // Sin versión fresca no se modifica nada ni se usa una caché como prueba.
  log(`Versión publicada: ${esperada}`);
  let rows=leerInstalaciones(casa);
  if(verificarSolo)return comprobarVersiones(esperada,rows);
  const known=path.join(casa,'.claude/plugins/known_marketplaces.json');
  const market=existsSync(known)?json(known).softnexus:null;
  const src=market?.source;
  if(['local','directory'].includes(src?.source)) {
    const dir=src.path||market.installLocation;
    if(!dir||!existsSync(dir))throw new Error('La carpeta del catálogo registrado no existe.');
    correr('git',['-C',dir,'pull','--ff-only']);
  }
  if(!market)correr('claude',['plugin','marketplace','add','pipejust/softnexus-sdd-kit']);
  correr('claude',['plugin','marketplace','update','softnexus']);
  correr('claude',['plugin',rows.some(i=>i.scope==='user')?'update':'install',PLUGIN,'--scope','user']);
  rows=leerInstalaciones(casa);
  comprobarVersiones(esperada,rows,{soloUsuario:true}); // CLI exit 0 no demuestra que haya instalado la publicada.
  // Habilitar es idempotente: algunas versiones del CLI fallan si ya está habilitado.
  try{correr('claude',['plugin','enable',PLUGIN,'--scope','user'])}catch(e){
    const text=`${e.stdout||''}\n${e.stderr||''}\n${e.message||''}`;
    if(!/already enabled|ya está (habilitado|activado|encendid)/i.test(text))throw e;
  }
  for(const i of rows.filter(i=>i.scope!=='user')) {
    if(!['project','local'].includes(i.scope))throw new Error(`Ámbito ${i.scope} administrado: requiere actualizarlo con su administrador.`);
    if(!i.projectPath||!existsSync(i.projectPath))throw new Error(`No puedo comprobar la copia ${i.scope}: proyecto inexistente ${i.projectPath||''}.`);
    log(`Actualizando ${i.scope}: ${i.projectPath}`);
    correr('claude',['plugin','update',PLUGIN,'--scope',i.scope],i.projectPath);
  }
  const final=comprobarVersiones(esperada,leerInstalaciones(casa));
  final.forEach(i=>log(`VERIFICADO: ${i.scope} ${i.version}${i.project?' · '+i.project:''}`));
  log('Todas las copias registradas quedaron verificadas. Cierra todas las sesiones de Claude Code y vuelve a abrirlo.');
  return final;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await actualizarTodo({verificarSolo:process.argv.includes('--verificar')});
    if(process.argv.includes('--verificar'))result.forEach(i=>console.log(`VERIFICADO: ${i.scope} ${i.version}${i.project?' · '+i.project:''}`));
  } catch(e) {console.error(`ACTUALIZACIÓN NO CONFIRMADA: ${e.message}`);process.exitCode=1;}
}
