// Lee un comando de shell como lo haría bash, lo justo para decidir si es peligroso.
//
// Antes se buscaban palabras con expresiones sobre el texto entero: un mensaje de commit que decía
// "no usar git push --force" se bloqueaba, y "git push -fu origin x" pasaba. Aquí cada comando de la
// cadena (&&, ||, ;, |, saltos de línea, subshells) se separa SIN cortar dentro de comillas, se le
// quitan las comillas a cada palabra y se salta el texto de los heredoc (<<EOF … EOF). Las reglas
// miran QUÉ programa se corre y con qué argumentos.
//
// Es prevención de accidentes, no un encierro: quien quiera saltárselo a propósito puede. Lo que
// importa es que el agente no haga por error algo que no se puede deshacer.

// Dentro de comillas simples "$" no se expande: se marca distinto para que no parezca una variable.
const DOLAR_LITERAL = '\u0000';

// Cada comando sale con "siguiente": qué lo separó del que viene después ('|' si su salida alimenta
// a otro programa, cualquier otra cosa si no). Sirve para no tratar como "impreso en pantalla" lo
// que en realidad se le pasa a otro comando (p. ej. "echo $CLAVE | gh secret set X").
export function comandos(texto) {
  const s = String(texto ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lista = [];
  let palabras = [];
  let palabra = '';
  let hay = false;
  const pendientes = [];   // terminadores de heredoc que empiezan en la próxima línea
  const cerrarPalabra = () => { if (hay) palabras.push(palabra); palabra = ''; hay = false; };
  const cerrarComando = (siguiente = '') => {
    cerrarPalabra();
    if (palabras.length) lista.push({ palabras, siguiente });
    palabras = [];
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] !== '\n') { palabra += s[i + 1]; hay = true; }
      i += 2;
    } else if (c === "'") {
      const fin = s.indexOf("'", i + 1);
      const j = fin < 0 ? s.length : fin;
      palabra += s.slice(i + 1, j).replace(/\$/g, DOLAR_LITERAL); hay = true; i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        // "\$" dentro de comillas dobles es un "$" literal (bash no lo expande): se marca distinto
        // para que "usa \$SN_ALTUM_KEY" no parezca una referencia viva a la variable.
        if (s[j] === '\\' && j + 1 < s.length) { palabra += s[j + 1] === '$' ? DOLAR_LITERAL : s[j + 1]; j += 2; } else { palabra += s[j]; j += 1; }
      }
      hay = true; i = j + 1;
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] === '<') {
      // Here-string (<<<palabra): consume una palabra, no abre un cuerpo de varias líneas. Sin este
      // caso, se confundía con un heredoc y se tragaba todo lo que seguía hasta encontrar esa palabra
      // sola en una línea (pasaba con "$(( 1 << 2 ))" y con "cat <<< texto").
      cerrarPalabra();
      i += 3;
      while (s[i] === ' ' || s[i] === '\t') i += 1;
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i];
        const fin = s.indexOf(q, i + 1);
        i = fin < 0 ? s.length : fin + 1;
      } else {
        while (i < s.length && !' \t\n;|&()'.includes(s[i])) i += 1;
      }
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      cerrarPalabra();
      let j = i + 2;
      if (s[j] === '-') j += 1;
      while (s[j] === ' ' || s[j] === '\t') j += 1;
      // "\EOF" o '\EOF' (variantes de heredoc citado): la barra no es parte del terminador.
      const m = s.slice(j).match(/^\\?(['"]?)([A-Za-z0-9_.-]+)\1/);
      if (m) pendientes.push(m[2]);
      i = m ? j + m[0].length : i + 2;
    } else if (c === '\n') {
      cerrarComando();
      i += 1;
      // El cuerpo de cada heredoc es texto, no comandos: se salta hasta su línea de cierre.
      while (pendientes.length) {
        const fin = pendientes.shift();
        while (i < s.length) {
          const k = s.indexOf('\n', i);
          const linea = s.slice(i, k < 0 ? s.length : k);
          i = k < 0 ? s.length : k + 1;
          if (linea.replace(/^\t+/, '').trim() === fin) break;
        }
      }
    } else if (c === '&' && (palabra.endsWith('>') || s[i + 1] === '>')) {
      palabra += c; hay = true; i += 1;   // 2>&1, &>archivo: es una redirección, no un separador
    } else if (c === '|' && s[i + 1] !== '|') {
      cerrarComando('|');
      i += 1;
    } else if (';|&()`'.includes(c)) {
      cerrarComando();
      i += (c === '&' || c === '|') && s[i + 1] === c ? 2 : 1;
    } else if (c === ' ' || c === '\t') {
      cerrarPalabra(); i += 1;
    } else {
      palabra += c; hay = true; i += 1;
    }
  }
  cerrarComando();
  return lista;
}

// ---- Qué programa se corre ----
// Palabras que solo abren o cierran un bloque de control: nunca son el programa. Sin esto,
// "if true; then git push --force; fi" dejaba pasar el push porque "then" parecía el comando.
const PALABRAS_DE_CONTROL = new Set(['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'case', 'esac', '{', '}', '!']);
const ENVOLTORIOS = new Set(['command', 'exec', 'nohup', 'builtin']);
// Envoltorios que sí pueden tapar un comando peligroso detrás de sus propias banderas.
const ENVOLTORIO_CON_VALOR = {
  sudo: new Set(['-u', '-g', '-p', '-r', '-t', '-h', '-C', '--user', '--group']),
  nice: new Set(['-n', '--adjustment']),
  xargs: new Set(['-I', '-L', '-n', '-P', '-d', '-E', '-s']),
};
const ASIGNACION = /^[A-Za-z_][A-Za-z0-9_]*=/;
const OPCIONES_DE_ENV_CON_VALOR = new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']);
const SHELLS_CON_C = new Set(['bash', 'sh', 'zsh', 'ksh', 'dash']);

const nombre = (p) => String(p || '').split(/[\\/]/).pop().replace(/\.(exe|cmd)$/i, '').toLowerCase();

// Quita "sudo", "VAR=x", "env -u X", "if"/"then"/… y similares: lo que importa es el programa real.
// "env" solo (o con opciones, sin programa) IMPRIME todas las variables: ese caso se marca.
// "bash -c '…'", "sh -c '…'" y "eval '…'" esconden un comando entero dentro de un solo argumento:
// se devuelve ese texto en "anidado" para que quien llama lo vuelva a pasar por comandos().
export function programa(palabras) {
  let k = 0;
  let envSolo = false;
  while (k < palabras.length) {
    const p = palabras[k];
    if (ASIGNACION.test(p) || PALABRAS_DE_CONTROL.has(p)) { k += 1; continue; }
    const base = nombre(p);
    if (base === 'env') {
      k += 1;
      while (k < palabras.length && (palabras[k].startsWith('-') || ASIGNACION.test(palabras[k]))) {
        k += OPCIONES_DE_ENV_CON_VALOR.has(palabras[k]) ? 2 : 1;
      }
      envSolo = k >= palabras.length;
      continue;
    }
    if (base === 'timeout') {
      k += 1;
      while (k < palabras.length && palabras[k].startsWith('-')) k += 1; // sus banderas (-s, -k…)
      if (k < palabras.length) k += 1; // la duración
      continue;
    }
    if (ENVOLTORIOS.has(base) || ENVOLTORIO_CON_VALOR[base]) {
      k += 1;
      const conValor = ENVOLTORIO_CON_VALOR[base];
      while (conValor && k < palabras.length && palabras[k].startsWith('-')) k += conValor.has(palabras[k]) ? 2 : 1;
      continue;
    }
    if (SHELLS_CON_C.has(base) && palabras.includes('-c')) {
      const j = palabras.indexOf('-c', k);
      return { cmd: base, args: palabras.slice(k + 1), envSolo: false, anidado: palabras[j + 1] || '' };
    }
    if (base === 'eval') {
      return { cmd: base, args: palabras.slice(k + 1), envSolo: false, anidado: palabras.slice(k + 1).join(' ') };
    }
    break;
  }
  return { cmd: nombre(palabras[k]), args: palabras.slice(k + 1), envSolo };
}

// ---- Reglas ----
const PROTEGIDAS = new Set(['main', 'master', 'production']);
const RAICES = new Set([
  '/', '/*', '~', '~/', '~/*', '$home', '$home/', '$home/*', '${home}', '${home}/', '${home}/*',
  '.', './', '..', '../', '*', './*', '.git', 'c:\\', 'c:/', '%userprofile%',
]);   // en minúsculas: se compara así
const ES_ENV = (p) => {
  const base = String(p).split(/[\\/]/).pop().toLowerCase();
  if (/^\.env\*/.test(base)) return true;   // el glob ".env*" (sin expandir) también cuenta
  return /^\.env(\..+)?$/.test(base) && !/\.(example|sample|template|dist|defaults)$/.test(base);
};
// Otros archivos de credenciales, además de .env: llaves SSH/AWS, tokens de npm/git/gh guardados.
const ES_CREDENCIAL = (p) => {
  const n = String(p).replace(/\\/g, '/').toLowerCase();
  return /(^|\/)\.ssh\//.test(n) || /(^|\/)\.aws\//.test(n) || /\.pem$/.test(n)
    || /(^|\/)\.npmrc$/.test(n) || /(^|\/)\.netrc$/.test(n) || /(^|\/)\.git-credentials$/.test(n)
    || /(^|\/)\.config\/gh\/hosts\.yml$/.test(n);
};
// Comandos cuyo primer argumento normalmente LEE un archivo (no es su patrón/script de búsqueda).
const LECTORES = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'nl', 'strings', 'xxd', 'od', 'grep', 'rg', 'egrep', 'awk', 'sed', 'cut', 'sort', 'uniq', 'base64', 'type', 'get-content', 'gc', 'tac', 'diff']);
// grep/awk/sed llevan primero su patrón o script: eso no es un archivo, aunque el texto diga ".env".
const CON_PATRON_PRIMERO = new Set(['grep', 'rg', 'egrep', 'awk', 'sed']);
// "${VAR:+algo}" imprime "algo" SOLO SI VAR está puesta, no su valor: no es una fuga. "${VAR:-def}"
// y el resto de formas SÍ pueden imprimir el valor real, así que se siguen bloqueando.
const SECRETO = /\$\{?(SN_[A-Z0-9_]*(TOKEN|SECRET|KEY|PAT)|[A-Z][A-Z0-9_]*(TOKEN|SECRET|PASSWORD|_PAT)|[A-Z][A-Z0-9_]*_KEY)\b(?!:\+)/;
const NOMBRE_SECRETO = /^(SN_[A-Z0-9_]*(TOKEN|SECRET|KEY|PAT)|[A-Z][A-Z0-9_]*(TOKEN|SECRET|PASSWORD|_PAT)|[A-Z][A-Z0-9_]*_KEY)$/;
const CLIENTES_SQL = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'supabase', 'prisma', 'mongosh']);

const banderasCortas = (args) => args.filter((a) => /^-[A-Za-z]+$/.test(a)).join('');
const posicionales = (args, conValor = new Set()) => {
  const out = [];
  for (let k = 0; k < args.length; k += 1) {
    if (args[k] === '--') { out.push(...args.slice(k + 1)); break; }
    if (args[k].startsWith('-')) { if (conValor.has(args[k])) k += 1; continue; }
    out.push(args[k]);
  }
  return out;
};
// Lo que este comando lee como ARCHIVO (quitando, para grep/sed/awk, su patrón o script).
function archivosLeidos(cmd, args) {
  const pos = posicionales(args, new Set(['-e', '--regexp', '-f', '--file']));
  if (CON_PATRON_PRIMERO.has(cmd) && !args.some((a) => a === '-e' || a === '-f' || a.startsWith('--regexp=') || a.startsWith('--file='))) {
    return pos.slice(1);
  }
  return pos;
}

// -R/--repo antes del subcomando de gh no debe tapar qué subcomando es ("gh -R o/r pr merge 1").
function sinGlobalesDeGh(args) {
  const out = [];
  for (let k = 0; k < args.length; k += 1) {
    if (args[k] === '-R' || args[k] === '--repo') { k += 1; continue; }
    out.push(args[k]);
  }
  return out;
}

// Todo lo que este comando ESCRIBE, lo mejor que se puede saber sin ejecutar nada: redirecciones
// (>, >>, pegadas o sueltas), y el destino de comandos que escriben por su naturaleza (cp, mv, sed -i,
// tee, truncate, dd, rm). Sirve para una sola regla: "no se toca ese archivo a ciegas", en vez de
// bloquear cualquier comando que apenas MENCIONE el nombre (un commit, un test -f, un grep).
function destinosDeEscritura(palabras, cmd, args) {
  const destinos = [];
  for (let k = 0; k < palabras.length; k += 1) {
    const p = palabras[k];
    if (p === '>' || p === '>>' || p === '>|') { if (palabras[k + 1]) destinos.push(palabras[k + 1]); continue; }
    const m = p.match(/^\d*(>>?\|?)(.+)$/);
    if (m && m[2] && !m[2].startsWith('&')) destinos.push(m[2]);
  }
  if (cmd === 'tee') destinos.push(...posicionales(args).filter((a) => a !== '-a'));
  if (cmd === 'dd') { const of = args.find((a) => a.startsWith('of=')); if (of) destinos.push(of.slice(3)); }
  if ((cmd === 'cp' || cmd === 'mv') && posicionales(args).length >= 2) destinos.push(posicionales(args).pop());
  if (cmd === 'sed' && args.some((a) => a === '-i' || a.startsWith('-i'))) destinos.push(...posicionales(args).slice(1));
  if (cmd === 'truncate') destinos.push(...posicionales(args));
  if (cmd === 'rm') destinos.push(...posicionales(args));
  return destinos;
}

const GIT_GLOBAL_CON_VALOR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
function subcomandoGit(args) {
  let k = 0;
  while (k < args.length && args[k].startsWith('-')) k += GIT_GLOBAL_CON_VALOR.has(args[k]) ? 2 : 1;
  return { sub: args[k] || '', resto: args.slice(k + 1) };
}

function revisarPush(resto, ramaActual) {
  const largos = resto.filter((a) => a.startsWith('--'));
  if (largos.includes('--dry-run')) return '';   // no empuja nada: solo muestra qué haría
  if (largos.some((a) => /^--(force|force-with-lease|force-if-includes)\b/.test(a)) || banderasCortas(resto).includes('f')) {
    return 'git push --force está prohibido (reescribe la historia de otros). Abre un PR.';
  }
  if (largos.includes('--mirror') || largos.includes('--all')) return 'git push --mirror/--all empuja también las ramas protegidas. Empuja solo tu rama y abre un PR.';
  const [, ...refspecs] = posicionales(resto, new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']));
  if (refspecs.some((r) => r.startsWith('+'))) return 'Un "+" en la rama es un push forzado. Abre un PR.';
  const destino = (r) => r.split(':').pop().replace(/^refs\/heads\//, '');
  // Solo es un BORRADO si el lado de origen queda vacío (":rama" o "origin :rama"). "HEAD:main" es
  // un push normal con mapeo explícito, no un borrado, aunque también tenga ":".
  const esBorrado = (r) => r.startsWith(':');
  const protegidaBorrada = refspecs.some((r) => esBorrado(r) && PROTEGIDAS.has(r.split(':')[0].replace(/^refs\/heads\//, '')))
    || (largos.includes('--delete') || banderasCortas(resto).includes('d')) && posicionales(resto).some((r) => PROTEGIDAS.has(r));
  if (protegidaBorrada) return 'Eso borraría una rama protegida en el remoto. Pide confirmación humana.';
  if (refspecs.some((r) => !esBorrado(r) && (PROTEGIDAS.has(destino(r)) || (destino(r) === 'HEAD' && PROTEGIDAS.has(ramaActual()))))) {
    return 'Push directo a una rama protegida. Usa un PR.';
  }
  if (!refspecs.length && !largos.includes('--tags') && PROTEGIDAS.has(ramaActual())) {
    return `Estás en ${ramaActual()}: "git push" iría directo a la rama protegida. Crea tu rama y abre un PR.`;
  }
  return '';
}

function revisarGit(args, ramaActual) {
  const { sub, resto } = subcomandoGit(args);
  if (sub === 'push') return revisarPush(resto, ramaActual);
  if (sub === 'reset' && resto.includes('--hard')) return 'git reset --hard destruye trabajo. Pide confirmación humana.';
  if (sub === 'clean') {
    const cortas = banderasCortas(resto);
    if ((cortas.includes('f') || resto.includes('--force')) && !cortas.includes('n') && !resto.includes('--dry-run')) {
      return 'git clean borra para siempre los archivos que no están en git. Pide confirmación humana.';
    }
  }
  if (sub === 'branch' && (resto.includes('-D') || (resto.includes('--delete') && (resto.includes('-f') || resto.includes('--force'))))) {
    return 'git branch -D fuerza borrar una rama local con cambios sin fusionar. Pide confirmación humana.';
  }
  if (sub === 'checkout' && (resto.includes('.') || resto.includes('--') || resto.includes('-f') || resto.includes('--force'))) {
    return 'Eso descarta cambios sin guardar en archivos del repositorio. Pide confirmación humana.';
  }
  if (sub === 'switch' && (resto.includes('-f') || resto.includes('--discard-changes') || resto.includes('--force'))) {
    return 'git switch -f descarta cambios sin guardar. Pide confirmación humana.';
  }
  if (sub === 'restore' && !resto.includes('--staged')) {
    return 'git restore descarta cambios sin guardar en archivos del repositorio. Pide confirmación humana.';
  }
  if (sub === 'stash' && (resto[0] === 'clear' || resto[0] === 'drop')) {
    return 'Eso borra trabajo guardado en el stash para siempre. Pide confirmación humana.';
  }
  if ((sub === 'reflog' && resto[0] === 'expire') || (sub === 'gc' && resto.includes('--prune=now'))) {
    return 'Eso borra commits sueltos para siempre (ya no se pueden recuperar). Pide confirmación humana.';
  }
  if (sub === 'tag' && (resto.includes('-d') || resto.includes('--delete'))) {
    return 'git tag -d borra un tag. Si ya se publicó, pide confirmación humana.';
  }
  if (sub === 'worktree' && resto[0] === 'remove' && resto.includes('--force')) {
    return 'git worktree remove --force puede borrar cambios sin guardar en esa copia. Pide confirmación humana.';
  }
  if (sub === 'submodule' && resto[0] === 'deinit' && (resto.includes('-f') || resto.includes('--force'))) {
    return 'git submodule deinit -f descarta cambios sin guardar en el submódulo. Pide confirmación humana.';
  }
  if (sub === 'clone') {
    const pos = posicionales(resto, new Set(['-b', '--branch', '-o', '--origin', '-c', '--config', '--depth', '--shallow-since', '--shallow-exclude', '--reference', '--separate-git-dir', '-j', '--jobs', '--filter', '-u', '--upload-pack', '--template']));
    if (pos.length === 1 && /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/i.test(pos[0])) {
      return 'git clone sin carpeta de destino: la deja donde estés. Pregúntale a la persona DÓNDE la quiere '
        + '(carpeta madre o ruta exacta) y clona con "node scripts/sn/sn-sync.mjs clone <proyecto> --in <carpeta> | --into <ruta>", '
        + 'o con "git clone <url> <ruta>" si el repositorio no está en Altum.';
    }
  }
  return '';
}

function revisarGh(argsCrudos) {
  const args = sinGlobalesDeGh(argsCrudos);
  if (args[0] === 'release' && args[1] === 'delete') return 'gh release delete borra un release (y su tag) para siempre. Pide confirmación humana.';
  if (args[0] === 'repo' && args[1] === 'delete') return 'gh repo delete borra el repositorio para siempre. Solo el tech lead.';
  if (args[0] === 'repo' && args[1] === 'archive') return 'Archivar el repositorio lo deja de solo lectura. Solo el tech lead.';
  if (args[0] === 'repo' && args[1] === 'edit' && args.includes('--visibility')) return 'Cambiar la visibilidad del repositorio es del tech lead.';
  if (args[0] === 'secret' && args[1] === 'delete') return 'Borrar un secreto puede romper el CI. Solo el tech lead.';
  if (args[0] === 'issue' && args[1] === 'delete') return 'gh issue delete borra el issue para siempre. Pide confirmación humana.';
  if (args[0] === 'auth' && args[1] === 'token') return 'Eso imprime el token de tu sesión de GitHub. No hace falta verlo.';
  if (args[0] === 'api') {
    const metodo = (args.includes('-X') ? args[args.indexOf('-X') + 1] : args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET').toUpperCase();
    if (metodo === 'DELETE') return 'Una llamada DELETE a la API de GitHub puede borrar algo para siempre. Pide confirmación humana.';
  }
  return '';
}

function revisarSecretos(cmd, args, envSolo) {
  if (envSolo) return 'Imprimir todas las variables expone las claves en la conversación.';
  if ((cmd === 'echo' || cmd === 'printf') && args.some((a) => SECRETO.test(a))) return 'Imprimir un token o secreto lo expone en la conversación.';
  if (cmd === 'printenv' && (!args.length || args.some((a) => NOMBRE_SECRETO.test(a)))) return 'Imprimir un token o secreto lo expone en la conversación.';
  if (cmd === 'set' && !args.length) return 'Imprimir todas las variables expone las claves en la conversación.';
  if ((cmd === 'export' || cmd === 'declare' || cmd === 'typeset') && (!args.length || args.every((a) => /^-[px]+$/.test(a)))) {
    return 'Imprimir todas las variables expone las claves en la conversación.';
  }
  if (cmd === 'security' && args[0] === 'find-generic-password' && args.some((a) => a === '-w' || a === '-g')) {
    return 'Eso imprime una clave guardada en el Llavero. El plugin la lee solo; no hace falta verla.';
  }
  return '';
}

// Devuelve el motivo para bloquear este comando, o '' si puede pasar.
// ramaActual: función (perezosa) que dice en qué rama está el repositorio.
// pipedOut: true si la salida de este comando se le pasa a otro (no queda impresa en la conversación).
export function motivoParaBloquear(palabras, { ramaActual = () => '', pipedOut = false } = {}) {
  const { cmd, args, envSolo, anidado } = programa(palabras);
  if (anidado !== undefined) {
    // "bash -c '…'", "sh -c '…'" o "eval '…'": el comando de verdad está ADENTRO de ese texto.
    for (const seg of comandos(anidado)) {
      const motivo = motivoParaBloquear(seg.palabras, { ramaActual, pipedOut: seg.siguiente === '|' });
      if (motivo) return motivo;
    }
    return '';
  }
  // Lo que se va a otro programa no queda impreso en la conversación: no es una fuga.
  if (!pipedOut) {
    const secreto = revisarSecretos(cmd, args, envSolo);
    if (secreto) return secreto;
  }
  if (!cmd) return '';
  if (cmd === 'rm') {
    const recursivo = /r/i.test(banderasCortas(args)) || args.includes('--recursive');
    if (recursivo && posicionales(args).some((a) => RAICES.has(a.toLowerCase()))) return 'Borrado recursivo de raíz, home o directorio actual.';
  }
  if (cmd === 'find' && args.includes('-delete') && posicionales(args).some((a) => RAICES.has(a.toLowerCase()))) {
    return 'find -delete sobre la raíz, home o el directorio actual borra todo sin confirmar. Pide confirmación humana.';
  }
  if (['rmdir', 'rd'].includes(cmd) && args.some((a) => /^\/s$/i.test(a))) return 'Eso borra la carpeta y todo su contenido sin confirmar.';
  if (cmd === 'del' && args.some((a) => /^\/s$/i.test(a))) return 'Eso borra archivos de toda una carpeta sin confirmar.';
  if (cmd === 'remove-item' && args.some((a) => /^-recurse$/i.test(a)) && args.some((a) => /^-force$/i.test(a))) {
    return 'Remove-Item -Recurse -Force borra sin confirmar y sin papelera.';
  }
  if (cmd === 'git') {
    const motivo = revisarGit(args, ramaActual);
    if (motivo) return motivo;
  }
  if (cmd === 'gh') {
    const motivo = revisarGh(args);
    if (motivo) return motivo;
    const sinGlobales = sinGlobalesDeGh(args);
    if (sinGlobales[0] === 'repo' && sinGlobales[1] === 'clone' && posicionales(sinGlobales.slice(2)).length === 1) {
      return 'gh repo clone sin carpeta de destino: la deja donde estés. Pregunta primero dónde la quiere la persona.';
    }
  }
  if (cmd === 'supabase' && args[0] === 'db' && ['reset', 'push'].includes(args[1]) && args.includes('--linked')) {
    return 'Operación sobre la base de datos remota enlazada. Solo el tech lead.';
  }
  if (CLIENTES_SQL.has(cmd) && /\b(drop\s+(table|schema|database)|truncate\s+table)\b/i.test(args.join(' '))) {
    return 'DDL destructivo. Crea una migración y pide revisión R3.';
  }
  if (LECTORES.has(cmd) && archivosLeidos(cmd, args).some((a) => ES_ENV(a) || ES_CREDENCIAL(a))) {
    return 'Leer un archivo de credenciales expone secretos al contexto del agente. Usa .env.example.';
  }
  if (palabras.some((p, k) => (p === '<' && (ES_ENV(palabras[k + 1] || '') || ES_CREDENCIAL(palabras[k + 1] || ''))) || (p.startsWith('<') && (ES_ENV(p.slice(1)) || ES_CREDENCIAL(p.slice(1)))))) {
    return 'Leer un archivo de credenciales expone secretos al contexto del agente. Usa .env.example.';
  }
  if (cmd === 'vercel' && args.includes('--prod')) return 'Deploy a producción manual. Producción sale solo por pipeline.';
  if (['npm', 'pnpm', 'yarn'].includes(cmd) && !args.includes('--dry-run')) {
    const pos = posicionales(args, new Set(['--registry', '--tag', '--access', '--otp', '--filter', '-F']));
    if (pos.includes('publish')) return 'Publicar paquetes requiere aprobación humana.';
    if (cmd === 'npm' && pos.includes('unpublish')) return 'npm unpublish borra una versión publicada. Requiere aprobación humana.';
  }
  const destinos = destinosDeEscritura(palabras, cmd, args);
  if (destinos.some((d) => ES_ENV(d) || ES_CREDENCIAL(d))) {
    return 'Eso escribiría en un archivo de credenciales. Usa .env.example.';
  }
  if (destinos.some((d) => /(^|\/)(supabase\/migrations|prisma\/migrations|migrations)\/.+\.sql$/.test(String(d).replace(/\\/g, '/')))) {
    return 'No se editan migraciones existentes. Crea una migración nueva.';
  }
  if (destinos.some((d) => /(^|\/)\.github\/workflows\//.test(String(d).replace(/\\/g, '/')) && !/\/plantillas\//.test(String(d)))) {
    return 'Cambiar CI es R4. Requiere tech lead.';
  }
  if (destinos.some((d) => /(^|\/)\.sn\/state\/altum-lider\.json$/.test(String(d).replace(/\\/g, '/')))) {
    return 'Quién es el líder lo dice Altum: ese archivo lo escribe el plugin (sn-sync lead), no se edita a mano.';
  }
  return '';
}

// ¿Este comando une un PR? (gh pr merge, la API de merge de GitHub, o completar el PR en Azure DevOps)
// Programas que consumen su entrada sin volverla a imprimir (portapapeles, el secreto de un CI…).
// Pipear un secreto hacia uno de estos no lo deja en la conversación; hacia cualquier otro (grep,
// cat, tee…) sí puede volver a aparecer.
const SUMIDEROS = new Set(['pbcopy', 'xclip', 'xsel', 'clip', 'clip.exe']);
export function esSumidero(palabras) {
  const { cmd, args } = programa(palabras);
  if (SUMIDEROS.has(cmd)) return true;
  if (cmd === 'gh' && sinGlobalesDeGh(args)[0] === 'secret' && sinGlobalesDeGh(args)[1] === 'set') return true;
  return false;
}

export function uneUnPr(palabras) {
  const { cmd, args } = programa(palabras);
  const a = cmd === 'gh' ? sinGlobalesDeGh(args) : args;
  if (cmd === 'gh' && a[0] === 'pr' && a[1] === 'merge') return true;
  if (cmd === 'gh' && a[0] === 'api' && a.some((x) => /\/pulls\/\d+\/merge\b/.test(x))) return true;
  if (cmd === 'az' && args[0] === 'repos' && args[1] === 'pr' && args[2] === 'update') {
    const valor = (op) => args[args.indexOf(op) + 1] || '';
    return (args.includes('--status') && valor('--status') === 'completed') || (args.includes('--auto-complete') && valor('--auto-complete') !== 'false');
  }
  return false;
}

export function abreUnPr(palabras) {
  const { cmd, args } = programa(palabras);
  const a = cmd === 'gh' ? sinGlobalesDeGh(args) : args;
  return (cmd === 'gh' && a[0] === 'pr' && a[1] === 'create') || (cmd === 'az' && args[0] === 'repos' && args[1] === 'pr' && args[2] === 'create');
}
