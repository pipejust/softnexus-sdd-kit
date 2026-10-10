// ¿Quién es el líder? La misma persona aparece con identidades distintas según dónde firme:
//   - el correo de la empresa en Altum        (jtoro@softnexus.io)
//   - su correo personal, con el que commitea (juand1360@gmail.com)
//   - su usuario de GitHub, con el que aprueba (TON618-Q)
// Cualquiera de las tres vale, porque todas salen de Altum: el correo y el usuario de GitHub de su
// ficha, y los correos alternos que Altum devuelva. Lo que NO vale es la firma de otra persona.
const minus = (t) => String(t || '').trim().toLowerCase();

export function correosDelLider(lider) {
  return [lider?.email, ...(lider?.emails || [])].map(minus).filter(Boolean);
}

// De una línea "Nombre <correo> · GitHub @usuario" saca las dos identidades que traiga.
export function identidadFirmante(texto) {
  const linea = String(texto || '');
  // El correo se quita antes de buscar el usuario de GitHub: si no, la "@" del correo gana.
  const sinCorreo = linea.replace(/<[^>]*>/g, ' ').replace(/[\w.+-]+@[\w.-]+/g, ' ');
  return {
    correo: minus(linea.match(/<([^>]+@[^>]+)>/)?.[1]),
    github: minus(sinCorreo.match(/@([A-Za-z0-9][A-Za-z0-9-]*)/)?.[1]),
  };
}

export function esElLider(lider, identidad) {
  if (!lider) return false;
  const github = minus(lider.github);
  if (github && identidad.github && identidad.github === github) return true;
  return Boolean(identidad.correo) && correosDelLider(lider).includes(identidad.correo);
}

// Cómo se identifica el líder, para explicarlo cuando una firma no coincide.
export function comoSeIdentifica(lider) {
  const correos = correosDelLider(lider);
  return [correos.length ? correos.join(' o ') : null, lider?.github ? `GitHub @${lider.github}` : null]
    .filter(Boolean).join(' · ');
}

// La regla general "* @usuario" de CODEOWNERS es la del líder. Si ya existe una regla "*", se cambia
// solo esa; si no, se agrega al principio. Las demás reglas del archivo (carpetas con dueños propios)
// NO se tocan: antes se reemplazaba el archivo entero y se perdían.
export function codeownersConLider(texto, github) {
  const linea = `* @${github}`;
  const lineas = String(texto || '').split('\n');
  if (lineas.some((x) => x.trim() === linea)) return texto;
  const general = lineas.findIndex((x) => /^\*\s+@/.test(x.trim()));
  if (general >= 0) return lineas.map((x, i) => (i === general ? linea : x)).join('\n');
  const cabecera = '# Revisor general: el líder del proyecto según Altum (lo mantiene el plugin Softnexus).';
  return `${cabecera}\n${linea}\n${texto ? `\n${texto.replace(/^\n+/, '')}` : ''}`;
}
