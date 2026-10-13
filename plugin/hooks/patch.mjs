// Formato apply_patch del runtime Codex/ChatGPT local. No ejecuta ni modifica archivos.
export function archivosPatch(command) {
  const files=[];let current;
  for(const line of String(command||'').split(/\r?\n/)) {
    const header=line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if(header){current={file_path:header[2],kind:header[1],added:0,removed:0};files.push(current);continue;}
    if(!current)continue;
    if(line.startsWith('*** Move to: ')){current.move=line.slice(13);continue;}
    if(line.startsWith('+'))current.added++;
    if(line.startsWith('-'))current.removed++;
  }
  return files;
}
