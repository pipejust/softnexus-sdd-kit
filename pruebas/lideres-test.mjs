import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {lideresDelProyecto} from '../plugin/scripts/sync/altum-backlog.mjs';
import {esElLider,codeownersConLider,agentsConLider,lineaLider} from '../plugin/scripts/sync/lider.mjs';
import {firmaDelLider} from '../plugin/scripts/sync/pr.mjs';
import {statusOf} from '../plugin/scripts/validation-state.mjs';
let ok=0,fallas=0;
const check=(name,fn)=>{try{fn();ok++;console.log('OK    '+name)}catch(e){fallas++;console.log('FALLA '+name+': '+e.message)}};
const members=[{employee_id:'a',name:'Ana',email:'ana@x',github_username:'ana',is_lead:true},{employee_id:'b',name:'Juan',email:'juan@x',github_username:'TON618-Q',is_lead:true},{employee_id:'c',name:'Dev',email:'dev@x',github_username:'dev',is_lead:false}];
const project={id:'p',name:'Proyecto',members};
const data=lideresDelProyecto(project,{projects:[{id:'p',is_lead:true}],user:{employee_id:'b',name:'Juan',email:'juan@x',github_username:'TON618-Q'}});
check('Altum conserva los dos líderes',()=>assert.equal(data.leaders.length,2));
check('La persona actual no recibe el GitHub del primer líder',()=>{assert.equal(data.name,'Juan');assert.equal(data.github,'TON618-Q');assert.equal(data.email,'juan@x')});
for(const github of ['ana','ton618-q']) check('Autor líder '+github+' puede entregar su PR',()=>assert.equal(firmaDelLider({autor:{usuario:github},aprobaron:[]},data).valida,true));
for(const github of ['ana','ton618-q']) check('Aprobación de '+github+' es válida',()=>assert.equal(firmaDelLider({autor:{usuario:'dev'},aprobaron:[{usuario:github}]},data).valida,true));
check('Desarrollador no adquiere permiso de líder',()=>assert.equal(esElLider(data,{github:'dev',correo:'dev@x'}),false));
check('Aprobación ajena sigue rechazada',()=>assert.equal(firmaDelLider({autor:{usuario:'dev'},aprobaron:[{usuario:'otra'}]},data).valida,false));
check('No se mezclan correo del segundo con GitHub del primero',()=>{const second=data.leaders.find(x=>x.name==='Juan');assert.equal(esElLider(second,{github:'ana'}),false)});
check('CODEOWNERS registra todos y preserva reglas específicas',()=>assert.equal(codeownersConLider('* @viejo\nsrc/ @frontend\n',['ana','TON618-Q']),'* @ana @TON618-Q\nsrc/ @frontend\n'));
for (const eol of ['\n','\r\n']) {
 check('Párrafo multilínea se reemplaza completo '+JSON.stringify(eol),()=>{
  const old=['# Proyecto','- Líder técnico: anterior','  - Ana vieja','  - Otro viejo','- Prefijo de ítems: FC','','## Stack','No tocar'].join(eol);
  const expected=['# Proyecto',lineaLider(data),'- Prefijo de ítems: FC','','## Stack','No tocar'].join(eol);
  assert.equal(agentsConLider(old,data),expected);
  assert.equal(agentsConLider(expected,data),expected);
 });
 check('Línea actual correcta no conserva continuación vieja '+JSON.stringify(eol),()=>{
  const old=[lineaLider(data),'  Persona anterior','','Texto propio'].join(eol);
  assert.equal(agentsConLider(old,data),[lineaLider(data),'','Texto propio'].join(eol));
 });
}
check('Sin párrafo de líderes no cambia el documento',()=>assert.equal(agentsConLider('# Otro\n',data),'# Otro\n'));
const request={type:'SOLICITUD',seal:'plano',fields:{},raw:''};
for(const name of ['Ana <ana@x>','Juan <juan@x>']) check('Firma de plano reconocida: '+name,()=>assert.notEqual(statusOf([request,{type:'APROBADO',seal:'plano',fields:{Valida:name},raw:''}],'a',data).status,'firma inválida'));
check('Sin líderes no se concede acceso',()=>assert.equal(esElLider({leaders:[]},{github:'ana'}),false));
const dir=mkdtempSync(path.join(os.tmpdir(),'sn-leaders-'));const guard=fileURLToPath(new URL('../plugin/hooks/guard.mjs',import.meta.url));
try {
 mkdirSync(path.join(dir,'.sn/state'),{recursive:true});mkdirSync(path.join(dir,'bin'));
 writeFileSync(path.join(dir,'.sn/connectors.json'),JSON.stringify({connectors:[{kind:'altum',project_id:'p',key_env:'SN_LEAD_TEST_UNUSED',base_url:'http://127.0.0.1:9'}]}));
 writeFileSync(path.join(dir,'.sn/state/altum-lider.json'),JSON.stringify({...data,leaders_version:2,project_id:'p',at:Date.now()}));
 writeFileSync(path.join(dir,'bin/gh'),'#!/bin/sh\necho "$SN_TEST_LOGIN"\n',{mode:0o755});
 for(const login of ['ana','TON618-Q','dev']) check('Guard merge para '+login,()=>{
  const r=spawnSync(process.execPath,[guard],{cwd:dir,encoding:'utf8',input:JSON.stringify({cwd:dir,tool_name:'Bash',tool_input:{command:'gh pr merge 1'}}),env:{...process.env,PATH:path.join(dir,'bin')+':'+process.env.PATH,SN_TEST_LOGIN:login}});assert.equal(r.status,login==='dev'?2:0,r.stderr);
 });
}finally{rmSync(dir,{recursive:true,force:true})}
console.log(`\nRESULTADO: ${ok} OK · ${fallas} fallas`);process.exitCode=fallas?1:0;
