#!/usr/bin/env node
// Arranque independiente del plugin y de la carpeta del proyecto. Mac, Linux y Windows.
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,realpathSync,mkdirSync,writeFileSync,readdirSync,cpSync,rmSync} from 'node:fs';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
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
  const r=await fetcher(`${BASE}/plugin/.claude-plugin/plugin.json?sn=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`No pude consultar la versión publicada: HTTP ${r.status}.`);
  const version=(await r.json()).version;
  if(!versionAlMenos(version,version))throw new Error('La versión publicada no es válida.');
  return version;
}
function ejecutar(cmd,args,cwd) {
  const options={cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,windowsHide:true};
  if(process.platform==='win32'&&['claude','codex'].includes(cmd)) {
    // Todos los argumentos son constantes o scopes validados; las rutas viajan en cwd, sin shell.
    const out=execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',[cmd,...args].join(' ')],{...options,windowsHide:true});
    if(out?.trim())console.log(out.trim()); return out;
  }
  const out=execFileSync(cmd,args,{...options,windowsHide:true});
  if(out?.trim())console.log(out.trim()); return out;
}
// Solo se retira la declaración de este plugin. Nunca se borran .claude, credenciales o skills ajenos.
export function proyectosConocidos(casa,rows,cwd) {
  const history=path.join(casa,'.claude.json');
  const dirs=[...rows.filter(i=>i.scope!=='user').map(i=>i.projectPath),
    ...Object.keys(existsSync(history)?json(history).projects||{}:{}),cwd];
  return [...new Set(dirs.filter(Boolean).map(d=>existsSync(d)?realpathSync(d):path.resolve(d)))].filter(d=>d!==(existsSync(casa)?realpathSync(casa):path.resolve(casa)));
}
function ajustesProyecto(dirs) {
  return dirs.flatMap(dir=>['settings.json','settings.local.json'].map(name=>path.join(dir,'.claude',name)))
    .filter(existsSync).map(file=>({file,data:json(file)}))
    .filter(({data})=>Object.hasOwn(data.enabledPlugins||{},PLUGIN));
}
export function comprobarGeneral(casa,rows,dirs) {
  if(rows.length!==1||rows[0].scope!=='user')throw new Error('Migración incompleta: todavía hay instalaciones particulares o duplicadas.');
  const user=path.join(casa,'.claude/settings.json');
  if(!existsSync(user)||json(user).enabledPlugins?.[PLUGIN]!==true)throw new Error('El plugin general no está habilitado en los ajustes del usuario.');
  const pendientes=ajustesProyecto(dirs);
  if(pendientes.length)throw new Error(`Todavía hay declaraciones de proyecto: ${pendientes.map(i=>i.file).join(', ')}`);
}
function migrar(casa,rows,dirs,correr,log) {
  const copias=rows.filter(i=>i.scope!=='user');
  for(const i of copias) {
    if(!['project','local'].includes(i.scope))throw new Error(`Ámbito ${i.scope} administrado: requiere intervención del administrador.`);
    if(!i.projectPath||!existsSync(i.projectPath))throw new Error(`No se puede retirar la copia ${i.scope}: proyecto no disponible ${i.projectPath||''}. Conecta el disco o restaura esa ruta y repite.`);
    if(realpathSync(i.projectPath)===realpathSync(casa))throw new Error('Hay una instalación de proyecto en la carpeta de usuario; requiere revisión manual para proteger los ajustes generales.');
  }
  const ajustes=ajustesProyecto(dirs); // Validar TODOS los JSON antes de retirar la primera copia.
  const generales=['settings.json','settings.local.json'].map(n=>path.join(casa,'.claude',n)).filter(existsSync).map(f=>realpathSync(f));
  if(ajustes.some(({file})=>generales.includes(realpathSync(file))))throw new Error('Un proyecto enlaza los ajustes generales del usuario: revisa ese enlace antes de migrar.');
  if(ajustes.length) {
    const backup=path.join(casa,'.claude/backups/softnexus',randomUUID());
    mkdirSync(backup,{recursive:true,mode:0o700});
    ajustes.forEach(({file},i)=>writeFileSync(path.join(backup,`${i}.json`),readFileSync(file),{mode:0o600}));
    writeFileSync(path.join(backup,'rutas.json'),JSON.stringify(ajustes.map(({file},i)=>({original:file,respaldo:`${i}.json`})),null,2),{mode:0o600});
    log(`Respaldo de ajustes: ${backup}`);
  }
  for(const i of copias) {
    log(`Retirando instalación ${i.scope}: ${i.projectPath}`);
    correr('claude',['plugin','uninstall',PLUGIN,'--scope',i.scope,'--keep-data'],i.projectPath);
  }
  // También cubre declaraciones sin instalación registrada y bloqueos locales enabledPlugins:false.
  for(const {file} of ajustes) {
    const data=json(file);
    if(Object.hasOwn(data.enabledPlugins||{},PLUGIN)) {
      delete data.enabledPlugins[PLUGIN];
      if(!Object.keys(data.enabledPlugins).length)delete data.enabledPlugins;
      writeFileSync(file,JSON.stringify(data,null,2)+'\n');
    }
    log(`Ajuste migrado: ${file}. Si está versionado, entrega este cambio mediante PR.`);
  }
}
export async function actualizarTodo({casa=os.homedir(),consultar=publicada,correr=ejecutar,log=console.log,verificarSolo=false,conservarProyectos=false,cwd=process.cwd()}={}) {
  const esperada=await consultar(); // Sin versión fresca no se modifica nada ni se usa una caché como prueba.
  log(`Versión publicada: ${esperada}`);
  let rows=leerInstalaciones(casa);
  const dirs=proyectosConocidos(casa,rows,cwd);
  if(verificarSolo){const checked=comprobarVersiones(esperada,rows);if(!conservarProyectos)comprobarGeneral(casa,rows,dirs);return checked;}
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
  if(!conservarProyectos)migrar(casa,rows,dirs,correr,log);
  for(const i of rows.filter(i=>conservarProyectos&&i.scope!=='user')) {
    if(!['project','local'].includes(i.scope))throw new Error(`Ámbito ${i.scope} administrado: requiere actualizarlo con su administrador.`);
    if(!i.projectPath||!existsSync(i.projectPath))throw new Error(`No puedo comprobar la copia ${i.scope}: proyecto inexistente ${i.projectPath||''}.`);
    log(`Actualizando ${i.scope}: ${i.projectPath}`);
    correr('claude',['plugin','update',PLUGIN,'--scope',i.scope],i.projectPath);
  }
  const final=comprobarVersiones(esperada,leerInstalaciones(casa));
  if(!conservarProyectos)comprobarGeneral(casa,leerInstalaciones(casa),dirs);
  final.forEach(i=>log(`VERIFICADO: ${i.scope} ${i.version}${i.project?' · '+i.project:''}`));
  log(conservarProyectos?'Todas las copias registradas quedaron verificadas.':'GENERAL VERIFICADA: una instalación de usuario; sin copias ni declaraciones en los proyectos comprobados.');
  log('Cierra todas las sesiones de Claude Code y vuelve a abrirlo. Las credenciales de Altum siguen vigentes.');
  return final;
}
// Adaptadores de clientes. Codex y ChatGPT de escritorio local comparten el runtime Codex.
export function buscarCliente(nombre,{correr=ejecutar}={}) {
  const candidates=nombre==='codex'?[process.env.SN_CODEX_BIN,'codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex']:['claude'];
  for(const cmd of candidates.filter(Boolean))try{correr(cmd,['--version']);return cmd}catch{}
  return null;
}
export function migrarCopiasOpenAI({casa,codexHome,cwd,verificarSolo=false,log=console.log}) {
  const state=path.join(codexHome,'.codex-global-state.json');
  const saved=existsSync(state)?json(state):{};
  const projects=new Set([cwd,...(saved['electron-saved-workspace-roots']||[]),...(saved['active-workspace-roots']||[])].filter(d=>typeof d==='string'&&d&&path.resolve(d)!==path.resolve(casa)));
  // También revisar los ancestros del cwd dentro de su repositorio.
  let dir=cwd;const ancestors=[];
  while(dir&&path.resolve(dir)!==path.resolve(casa)&&path.dirname(dir)!==dir){ancestors.push(dir);if(existsSync(path.join(dir,'.git'))){ancestors.forEach(d=>projects.add(d));break;}dir=path.dirname(dir);}
  const skillBases=[path.join(casa,'.agents/skills'),path.join(codexHome,'skills'),...[...projects].flatMap(d=>[path.join(d,'.agents/skills'),path.join(d,'.codex/skills')])];
  const cambios=[];
  for(const base of new Set(skillBases)) {
    if(!existsSync(base))continue;
    for(const name of readdirSync(base).filter(n=>/^sn(?:-[a-z]+)?$/.test(n))) {
      const folder=path.join(base,name),skill=path.join(folder,'SKILL.md');if(!existsSync(skill))continue;
      const text=readFileSync(skill,'utf8');
      // Solo copias identificables de SN. Nunca borrar skills ajenos por compartir prefijo.
      if(!/Softnexus|CLAUDE_PLUGIN_ROOT/.test(text))continue;
      cambios.push({file:folder,folder:true});
    }
  }
  for(const project of projects) {
    const file=path.join(project,'.agents/plugins/marketplace.json');
    if(existsSync(file)){
      const data=json(file);
      if(data.plugins?.some(p=>p.name==='softnexus-sdd')){data.plugins=data.plugins.filter(p=>p.name!=='softnexus-sdd');cambios.push({file,text:JSON.stringify(data,null,2)+'\n'});}
    }
    const config=path.join(project,'.codex/config.toml');
    if(existsSync(config)){
      const original=readFileSync(config,'utf8');let skip=false,removed=false;const lines=[];
      if(/softnexus-sdd@/.test(original)&&(/"""/.test(original)||original.includes("'''")))throw new Error(`Revisa la declaración Softnexus del TOML con cadenas multilínea: ${config}`);
      for(const line of original.split(/\r?\n/)){
        if(/^\s*\[/.test(line))skip=/^\s*\[plugins\.["']softnexus-sdd@[^"']+["'](?:\.|\])/.test(line);
        if(!skip)lines.push(line);else removed=true;
      }
      const text=lines.join(original.includes('\r\n')?'\r\n':'\n');if(removed)cambios.push({file:config,text});
    }
  }
  if(!cambios.length)return;
  if(verificarSolo)throw new Error(`OpenAI: quedan copias/declaraciones particulares de Softnexus: ${cambios.map(c=>c.file).join(', ')}`);
  const backup=path.join(codexHome,'backups/softnexus',randomUUID());mkdirSync(backup,{recursive:true,mode:0o700});
  // Respaldar todo antes de retirar nada. No se modifican claves ni ajustes generales de Codex.
  cambios.forEach((c,i)=>cpSync(c.file,path.join(backup,String(i)),{recursive:true}));
  writeFileSync(path.join(backup,'rutas.json'),JSON.stringify(cambios.map(({file},i)=>({original:file,respaldo:String(i)})),null,2),{mode:0o600});
  log(`Respaldo de copias OpenAI: ${backup}`);
  for(const c of cambios){if(c.folder)rmSync(c.file,{recursive:true});else writeFileSync(c.file,c.text);log(`Migrado: ${c.file}. Si está versionado, entrega el cambio por PR.`);}
}
export async function actualizarCodex({casa=os.homedir(),codexHome=process.env.CODEX_HOME||path.join(casa,'.codex'),bin='codex',consultar=publicada,correr=ejecutar,log=console.log,verificarSolo=false,conservarProyectos=false,cwd=process.cwd()}={}) {
  const esperada=await consultar();
  const run=args=>JSON.parse(String(correr(bin,['plugin',...args,'--json'],casa)).replace(/^\uFEFF/,''));
  let install;
  if(!verificarSolo) {
    const markets=run(['marketplace','list']);
    if(!markets.marketplaces?.some(m=>m.name==='softnexus'))run(['marketplace','add','pipejust/softnexus-sdd-kit']);
    const catalog=markets.marketplaces?.find(m=>m.name==='softnexus');
    if(catalog?.marketplaceSource?.sourceType==='local'){
      if(!catalog.root||!existsSync(catalog.root))throw new Error('No existe el catálogo local de Codex.');
      correr('git',['-C',catalog.root,'pull','--ff-only'],casa);
    }else{
      const upgraded=run(['marketplace','upgrade','softnexus']);
      if(upgraded.errors?.length)throw new Error('Codex no pudo refrescar el catálogo Softnexus.');
    }
    install=run(['add',PLUGIN]); // add también refresca una instalación existente; no remove/reinstall.
  }
  const list=run(['list','--marketplace','softnexus']);
  const rows=list.installed?.filter(i=>i.pluginId===PLUGIN&&i.installed&&i.enabled)||[];
  if(rows.length!==1)throw new Error('Codex/ChatGPT: falta una instalación general habilitada y única.');
  const row=rows[0];
  const root=install?.installedPath||path.join(codexHome,'plugins/cache/softnexus/softnexus-sdd',row.version||'');
  comprobarVersiones(esperada,[{scope:'user',version:row.version,installPath:root}]);
  if(install&&(install.pluginId!==PLUGIN||install.version!==row.version))throw new Error('Codex: el resultado de instalación y el registro no coinciden.');
  if(!conservarProyectos)migrarCopiasOpenAI({casa,codexHome,cwd,verificarSolo,log});
  const receipt={cliente:'codex',version:row.version,ruta:root};
  if(!verificarSolo){mkdirSync(codexHome,{recursive:true});writeFileSync(path.join(codexHome,'softnexus-install.json'),JSON.stringify(receipt,null,2)+'\n');}
  log(`VERIFICADO: CODEX / CHATGPT LOCAL user ${row.version}`);
  log('Instalación general comprobada. Abre una sesión nueva y revisa los hooks de Softnexus en /hooks o en la configuración de la aplicación. No se autorizaron automáticamente.');
  return receipt;
}
export async function actualizarClientes({cliente='auto',correr=ejecutar,log=console.log,...opciones}={}) {
  if(!['auto','claude','codex','chatgpt','todos'].includes(cliente))throw new Error('Cliente no compatible. Usa auto, claude, codex, chatgpt o todos.');
  const targets=cliente==='claude'?['claude']:['codex','chatgpt'].includes(cliente)?['codex']:['claude','codex'];
  const results=[],errors=[];
  for(const name of targets) {
    const bin=buscarCliente(name,{correr});
    if(!bin){if(cliente!=='auto')errors.push(`${name}: no se encontró su CLI. Actualiza/instala ese cliente y verifica su comando en la terminal.`);continue;}
    log(`Actualizando cliente: ${name}`);
    try{
      const clientLog=l=>log(`[${name}] ${l.replace(/^GENERAL VERIFICADA:/,'CLIENTE VERIFICADO:')}`);
      const result=name==='claude'?await actualizarTodo({...opciones,correr,log:clientLog}):await actualizarCodex({...opciones,correr,log:clientLog,bin});
      results.push(result);
      if(name==='claude')result.forEach(i=>log(`VERIFICADO: CLAUDE ${i.scope} ${i.version}`));
    }
    catch(e){errors.push(`${name}: ${e.message}`)}
  }
  if(!results.length&&!errors.length)throw new Error('No se encontró Claude Code ni Codex. ChatGPT de escritorio local necesita su runtime Codex; instala o actualiza Codex CLI si el comando no está disponible.');
  if(errors.length)throw new Error(errors.join('\n'));
  log(opciones.conservarProyectos?'ACTUALIZACIÓN VERIFICADA: se conservaron las copias particulares.':'GENERAL VERIFICADA: instalaciones de los clientes seleccionados comprobadas. Reinicia las aplicaciones.');
  return results;
}
if(process.argv[1]&&existsSync(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const flags=process.argv.slice(2);let cliente='auto';
    const idx=flags.indexOf('--cliente');
    if(idx!==-1){if(!flags[idx+1])throw new Error('Falta el valor de --cliente.');cliente=flags[idx+1];flags.splice(idx,2);}
    if(flags.some(f=>!['--verificar','--conservar-proyectos'].includes(f)))throw new Error('Opciones: --cliente auto|claude|codex|chatgpt|todos, --verificar, --conservar-proyectos.');
    await actualizarClientes({cliente,verificarSolo:flags.includes('--verificar'),conservarProyectos:flags.includes('--conservar-proyectos')});
  } catch(e) {console.error(`ACTUALIZACIÓN NO CONFIRMADA: ${e.message}`);process.exitCode=1;}
}
