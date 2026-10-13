import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {actualizarTodo,actualizarClientes,actualizarCodex,migrarCopiasOpenAI,comprobarVersiones,versionAlMenos} from '../herramientas/actualizar-plugin.mjs';
let ok=0,fallas=0;
async function check(name,fn){try{await fn();ok++;console.log('OK    '+name)}catch(e){fallas++;console.log('FALLA '+name+': '+e.message)}}
const root=mkdtempSync(path.join(os.tmpdir(),'sn-update-test-'));
const casa=path.join(root,'usuario');const project=path.join(root,'proyecto con espacios');
mkdirSync(path.join(casa,'.claude/plugins'),{recursive:true});mkdirSync(path.join(project,'.claude'),{recursive:true});
const registry=path.join(casa,'.claude/plugins/installed_plugins.json');
const settings=path.join(project,'.claude/settings.json');writeFileSync(settings,'{"enabledPlugins":{"softnexus-sdd@softnexus":true}}\n');
writeFileSync(path.join(casa,'.claude/plugins/known_marketplaces.json'),'{"softnexus":{"source":{"source":"github"}}}');
function copy(scope,version){const dir=path.join(root,scope);mkdirSync(path.join(dir,'.claude-plugin'),{recursive:true});mkdirSync(path.join(dir,'scripts'),{recursive:true});writeFileSync(path.join(dir,'.claude-plugin/plugin.json'),JSON.stringify({version}));writeFileSync(path.join(dir,'scripts/sn-sync.mjs'),'// motor\n');return {scope,version,installPath:dir,...(scope==='user'?{}:{projectPath:project})}}
let rows;let calls;let logs;
function reset(){rows=[copy('user','0.62.0'),copy('project','0.62.0')];calls=[];logs=[];writeFileSync(registry,JSON.stringify({plugins:{'softnexus-sdd@softnexus':rows}}))}
function update(scope){for(const i of rows.filter(i=>i.scope===scope)){i.version='0.63.0';writeFileSync(path.join(i.installPath,'.claude-plugin/plugin.json'),'{"version":"0.63.0"}')}writeFileSync(registry,JSON.stringify({plugins:{'softnexus-sdd@softnexus':rows}}))}
const options=(correr)=>({casa,cwd:project,consultar:async()=> '0.63.0',correr,log:l=>logs.push(l),conservarProyectos:true});
try {
 await check('El CLI dice éxito pero usuario sigue 0.62: falla antes de tocar proyectos',async()=>{reset();await assert.rejects(actualizarTodo(options((cmd,args,cwd)=>calls.push({cmd,args,cwd}))),/0.62.0.*0.63.0/);assert.equal(calls.some(c=>c.args.includes('project')),false);assert.equal(logs.some(l=>l.includes('Todas las copias')),false)});
 await check('Usuario 0.63 pero proyecto 0.62: no declara éxito',async()=>{reset();await assert.rejects(actualizarTodo(options((cmd,args,cwd)=>{calls.push({cmd,args,cwd});if(args.includes('user')&&args.includes('update'))update('user')})),/project.*0.62.0.*0.63.0/);assert.equal(logs.some(l=>l.includes('Todas las copias')),false)});
 await check('Actualiza usuario y proyecto, verifica los archivos y conserva settings',async()=>{reset();const before=readFileSync(settings,'utf8');const final=await actualizarTodo(options((cmd,args,cwd)=>{calls.push({cmd,args,cwd});if(args.includes('update')&&args.includes('--scope'))update(args.at(-1))}));assert.equal(final.length,2);assert.ok(final.every(i=>i.version==='0.63.0'));assert.equal(readFileSync(settings,'utf8'),before);assert.equal(calls.find(c=>c.args.includes('project')).cwd,project)});
 await check('Registry nuevo pero archivos viejos: no confirma versión',()=>{reset();rows[0].version='0.63.0';assert.throws(()=>comprobarVersiones('0.63.0',rows),/archivos 0.62.0/)});
 await check('Archivos nuevos pero registry viejo: no confirma versión',()=>{reset();writeFileSync(path.join(rows[0].installPath,'.claude-plugin/plugin.json'),'{"version":"0.63.0"}');assert.throws(()=>comprobarVersiones('0.63.0',rows),/registro 0.62.0/)});
 await check('Sin red no toca instalación ni usa caché',async()=>{reset();await assert.rejects(actualizarTodo({...options(()=>calls.push('mutation')),consultar:async()=>{throw new Error('sin red')}}),/sin red/);assert.equal(calls.length,0)});
 await check('Modo verificar solo lee y detecta proyecto viejo',async()=>{reset();update('user');await assert.rejects(actualizarTodo({...options(()=>calls.push('mutation')),verificarSolo:true}),/project.*0.62.0/);assert.equal(calls.length,0)});
 await check('Catálogo local se trae con git antes del CLI',async()=>{reset();writeFileSync(path.join(casa,'.claude/plugins/known_marketplaces.json'),JSON.stringify({softnexus:{source:{source:'directory',path:project}}}));await actualizarTodo(options((cmd,args,cwd)=>{calls.push({cmd,args,cwd});if(args.includes('update')&&args.includes('--scope'))update(args.at(-1))}));assert.equal(calls[0].cmd,'git');assert.deepEqual(calls[0].args,['-C',project,'pull','--ff-only'])});
 await check('Plugin aún no instalado: instala user y confirma antes de seguir',async()=>{reset();rows=[];writeFileSync(registry,'{"plugins":{}}');await actualizarTodo(options((cmd,args)=>{calls.push({cmd,args});if(args.includes('install')){rows=[copy('user','0.63.0')];writeFileSync(registry,JSON.stringify({plugins:{'softnexus-sdd@softnexus':rows}}))}}));assert.ok(calls.some(c=>c.args.includes('install')))});
 await check('Un error del CLI se propaga y no hay mensaje final verde',async()=>{reset();await assert.rejects(actualizarTodo(options(()=>{throw new Error('CLI falló')})),/CLI falló/);assert.equal(logs.some(l=>l.includes('Todas las copias')),false)});
 await check('Ya habilitado permite continuar y comprobar los proyectos',async()=>{reset();writeFileSync(path.join(casa,'.claude/plugins/known_marketplaces.json'),'{"softnexus":{"source":{"source":"github"}}}');const final=await actualizarTodo(options((cmd,args)=>{if(args.includes('enable')){const e=new Error('Command failed');e.stdout='Plugin is already enabled';throw e}if(args.includes('update')&&args.includes('--scope'))update(args.at(-1))}));assert.equal(final.length,2)});
 await check('Motor ausente no cuenta como instalación válida',()=>{reset();rmSync(path.join(rows[0].installPath,'scripts/sn-sync.mjs'));rows[0].version='0.63.0';writeFileSync(path.join(rows[0].installPath,'.claude-plugin/plugin.json'),'{"version":"0.63.0"}');assert.throws(()=>comprobarVersiones('0.63.0',rows),/falta el motor/)});
 await check('Registro corrupto no se interpreta como instalación vacía',async()=>{reset();writeFileSync(registry,'no es JSON');await assert.rejects(actualizarTodo(options(()=>calls.push('mutation'))));assert.equal(calls.length,0)});
 await check('Versiones semánticas y versiones ilegibles',()=>{assert.ok(versionAlMenos('0.64.0','0.63.0'));assert.equal(versionAlMenos('0.62.0','0.63.0'),false);assert.equal(versionAlMenos('ultima','0.63.0'),false)});
 await check('Migración predeterminada retira project y local, preserva API y otros ajustes',async()=>{
   reset();rows.push(copy('local','0.62.0'));writeFileSync(registry,JSON.stringify({plugins:{'softnexus-sdd@softnexus':rows}}));
   writeFileSync(settings,JSON.stringify({enabledPlugins:{'softnexus-sdd@softnexus':true,otro:true},permissions:{allow:['Read']}}));
   const local=path.join(project,'.claude/settings.local.json');writeFileSync(local,'{"enabledPlugins":{"softnexus-sdd@softnexus":false},"env":{"API":"conservar"}}');
   const final=await actualizarTodo({...options((cmd,args,cwd)=>{
     calls.push({cmd,args,cwd});if(args.includes('update')&&args.includes('user'))update('user');
     if(args.includes('enable'))writeFileSync(path.join(casa,'.claude/settings.json'),'{"enabledPlugins":{"softnexus-sdd@softnexus":true}}');
     if(args.includes('uninstall')){assert.ok(args.includes('--keep-data'));rows=rows.filter(i=>i.scope!==args[args.indexOf('--scope')+1]);writeFileSync(registry,JSON.stringify({plugins:{'softnexus-sdd@softnexus':rows}}));}
   }),conservarProyectos:false,cwd:project});
   assert.equal(final.length,1);assert.equal(final[0].scope,'user');
   assert.deepEqual(JSON.parse(readFileSync(settings)),{enabledPlugins:{otro:true},permissions:{allow:['Read']}});
   assert.equal(JSON.parse(readFileSync(local)).env.API,'conservar');assert.ok(logs.some(l=>l.startsWith('Respaldo')));assert.ok(logs.some(l=>l.startsWith('GENERAL VERIFICADA')));
 });
 await check('Uninstall con éxito aparente pero registro intacto no termina verde',async()=>{
   reset();await assert.rejects(actualizarTodo({...options((cmd,args)=>{if(args.includes('update')&&args.includes('user'))update('user')}),conservarProyectos:false,cwd:project}));assert.ok(!logs.some(l=>l.startsWith('GENERAL VERIFICADA')));
 });
 await check('Verificar rechaza dos copias aunque ambas estén actualizadas',async()=>{
   reset();update('user');update('project');await assert.rejects(actualizarTodo({...options(()=>{}),conservarProyectos:false,verificarSolo:true,cwd:project}),/Migración incompleta/);
 });
 await check('Declaración sin registro de plugin también se retira y repetir es idempotente',async()=>{
   reset();rows=[copy('user','0.63.0')];writeFileSync(registry,JSON.stringify({plugins:{'softnexus-sdd@softnexus':rows}}));writeFileSync(settings,'{"enabledPlugins":{"softnexus-sdd@softnexus":true}}');
   writeFileSync(path.join(casa,'.claude.json'),JSON.stringify({projects:{[project]:{}}}));
   const opt={...options(()=>{}),conservarProyectos:false,cwd:root};await actualizarTodo(opt);assert.equal(JSON.parse(readFileSync(settings)).enabledPlugins,undefined);await actualizarTodo(opt);
 });
 await check('Proyecto desconectado impide anunciar migración completa',async()=>{
   reset();rows[1].projectPath=path.join(root,'no-existe');writeFileSync(registry,JSON.stringify({plugins:{'softnexus-sdd@softnexus':rows}}));await assert.rejects(actualizarTodo({...options((cmd,args)=>{if(args.includes('update')&&args.includes('user'))update('user')}),conservarProyectos:false,cwd:root}),/proyecto no disponible/);
 });
 await check('El comando ejecuta el descargable a través de un alias de carpeta (Mac /tmp)',()=>{
   const real=path.join(root,'descarga-real'),alias=path.join(root,'descarga-alias');mkdirSync(real);
   const source=readFileSync(new URL('../herramientas/actualizar-plugin.mjs',import.meta.url));writeFileSync(path.join(real,'actualizar.mjs'),source);symlinkSync(real,alias,'junction');
   const result=spawnSync(process.execPath,[path.join(alias,'actualizar.mjs'),'--opcion-invalida'],{encoding:'utf8',windowsHide:true});
   assert.equal(result.status,1,'El script no debe salir cero sin ejecutar su entrada');assert.match(result.stderr,/ACTUALIZACIÓN NO CONFIRMADA: Opciones:/);
 });
 // El CLI Codex se simula con el mismo JSON observado en una instalación nativa aislada.
 const codexHome=path.join(root,'codex');
 function openaiRunner({old=false,disabled=false,marketError=false}={}) {
   const installed=copy('openai',old?'0.62.0':'0.63.0');
   return (cmd,args,cwd)=>{
     calls.push({cmd,args,cwd});
     if(cmd!=='codex')throw new Error('CLI ausente');
     if(args[0]==='--version')return 'codex-cli test';
     assert.equal(cwd,casa,'El CLI se ejecuta en el usuario, no en el proyecto');
     if(args.includes('marketplace'))return JSON.stringify(args.includes('list')?{marketplaces:[{name:'softnexus'}]}:{errors:marketError?['no red']:[]});
     if(args.includes('add'))return JSON.stringify({pluginId:'softnexus-sdd@softnexus',version:installed.version,installedPath:installed.installPath});
     if(args.includes('list'))return JSON.stringify({installed:[{pluginId:'softnexus-sdd@softnexus',version:installed.version,installed:true,enabled:!disabled}]});
     throw new Error('Comando no esperado');
   };
 }
 await check('Codex se instala y verifica sin Claude; guarda ruta para el motor común',async()=>{
   reset();const result=await actualizarClientes({...options(openaiRunner()),cliente:'codex',codexHome,conservarProyectos:false});assert.equal(result[0].cliente,'codex');assert.ok(!calls.some(c=>c.cmd==='claude'));assert.equal(JSON.parse(readFileSync(path.join(codexHome,'softnexus-install.json'))).version,'0.63.0');assert.ok(logs.at(-1).startsWith('GENERAL VERIFICADA'));
 });
 await check('ChatGPT local usa el mismo adaptador Codex',async()=>{reset();await actualizarClientes({...options(openaiRunner()),cliente:'chatgpt',codexHome});assert.ok(calls.some(c=>c.cmd==='codex'&&c.args.includes('add')))});
 await check('Auto detecta Codex aunque Claude no exista',async()=>{reset();await actualizarClientes({...options(openaiRunner()),codexHome});assert.ok(calls.some(c=>c.cmd==='codex'&&c.args.includes('add')))});
 await check('Codex CLI exitoso con versión vieja no declara éxito',async()=>{reset();await assert.rejects(actualizarClientes({...options(openaiRunner({old:true})),cliente:'codex',codexHome}),/0.62.0.*0.63.0/);assert.ok(!logs.some(l=>l.startsWith('GENERAL VERIFICADA')))});
 await check('Codex deshabilitado y catálogo sin refrescar no se dan por buenos',async()=>{reset();await assert.rejects(actualizarCodex({...options(openaiRunner({disabled:true})),codexHome}),/habilitada/);await assert.rejects(actualizarCodex({...options(openaiRunner({marketError:true})),codexHome}),/refrescar/)});
 await check('Cliente desconocido o sin CLI produce error explícito',async()=>{reset();await assert.rejects(actualizarClientes({...options(()=>{throw new Error('ausente')}),cliente:'codex'}),/no se encontró/);await assert.rejects(actualizarClientes({...options(()=>{}),cliente:'antigravity'}),/no compatible/)});
 await check('Hooks Codex detectan .env y tamaño excesivo en apply_patch',()=>{
   const run=(hook,command)=>spawnSync(process.execPath,[fileURLToPath(new URL(`../plugin/hooks/${hook}.mjs`,import.meta.url))],{input:JSON.stringify({tool_name:'apply_patch',hook_event_name:'PreToolUse',cwd:project,tool_input:{command}}),encoding:'utf8',windowsHide:true});
   assert.equal(run('guard','*** Begin Patch\n*** Add File: .env\n+SECRET=x\n*** End Patch').status,2);
   assert.equal(run('file-size','*** Begin Patch\n*** Add File: a.js\n'+Array(1001).fill('+x').join('\n')+'\n*** End Patch').status,2);
   assert.equal(run('guard','*** Begin Patch\n*** Add File: a.js\n+x\n*** End Patch').status,0);
   writeFileSync(path.join(project,'acumulado.js'),Array(999).fill('x').join('\n')+'\n');
   assert.equal(run('file-size','*** Begin Patch\n*** Update File: acumulado.js\n@@\n+x\n*** Update File: acumulado.js\n@@\n+x\n*** End Patch').status,2);
 });
 await check('Migra skills y declaraciones OpenAI sin alterar otros plugins ni ajustes',()=>{
   const skills=path.join(project,'.agents/skills/sn');mkdirSync(skills,{recursive:true});writeFileSync(path.join(skills,'SKILL.md'),'---\nname: sn\n---\nSoftnexus');
   const plugins=path.join(project,'.agents/plugins');mkdirSync(plugins,{recursive:true});writeFileSync(path.join(plugins,'marketplace.json'),JSON.stringify({name:'repo',plugins:[{name:'softnexus-sdd'},{name:'otro'}]}));
   const config=path.join(project,'.codex/config.toml');mkdirSync(path.dirname(config),{recursive:true});writeFileSync(config,'model="x"\r\n[plugins."softnexus-sdd@softnexus"]\r\nenabled=false\r\n[plugins."otro@repo"]\r\nenabled=true\r\n');
   assert.throws(()=>migrarCopiasOpenAI({casa,codexHome,cwd:project,verificarSolo:true,log:()=>{}}),/quedan copias/);
   migrarCopiasOpenAI({casa,codexHome,cwd:project,log:()=>{}});
   assert.equal(JSON.parse(readFileSync(path.join(plugins,'marketplace.json'))).plugins[0].name,'otro');
   assert.equal(readFileSync(config,'utf8'),'model="x"\r\n[plugins."otro@repo"]\r\nenabled=true\r\n');
   assert.throws(()=>readFileSync(path.join(skills,'SKILL.md')));
   migrarCopiasOpenAI({casa,codexHome,cwd:project,verificarSolo:true,log:()=>{}});
 });
 await check('La descarga standalone y el motor usan exactamente el mismo actualizador',()=>{const dir=new URL('../',import.meta.url);assert.equal(readFileSync(new URL('herramientas/actualizar-plugin.mjs',dir),'utf8'),readFileSync(new URL('plugin/scripts/sync/update-general.mjs',dir),'utf8'))});
} finally{rmSync(root,{recursive:true,force:true})}
console.log(`\nRESULTADO: ${ok} OK · ${fallas} fallas`);process.exitCode=fallas?1:0;
