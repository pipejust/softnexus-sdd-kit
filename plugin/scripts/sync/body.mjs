// Texto de una tarea externa (issue de GitHub, descripción en Altum): historia + trazabilidad + marca oculta.
// La marca <!-- sn-item:ID --> permite encontrar la tarea sin guardar ids y evita duplicados entre computadores.
export const mark = (id) => `<!-- sn-item:${id} -->`;

export function findMark(text) {
  return (text || '').match(/<!-- sn-item:([^ ]+) -->/)?.[1] || '';
}

export function itemMarkdownBody(evt) {
  const { item } = evt;
  const commits = (item.commits || []).map((c) => `- \`${c.short}\` ${c.subject} — ${c.author} (${(c.date || '').slice(0, 10)})`);
  return [
    `**Etapa:** ${item.stage_label}${item.flag ? ` · ${item.flag}` : ''} · **Riesgo:** ${item.risk || '—'} · **Tamaño:** ${item.size || '—'}`,
    `**Responsable:** ${item.assignee || '—'}`, '',
    '## Historia', item.story || '_(ver archivo del ítem)_', '',
    '## Trazabilidad',
    `- Archivo: \`${item.file}\``,
    `- Rama: ${item.branch ? `\`${item.branch}\`` : '—'} · Plano: ${item.change ? `\`${item.change}\`` : '—'}`,
    `- Avance: ${item.tasks_total ? `${item.tasks_done}/${item.tasks_total} tareas` : '—'} · PR: ${item.pr_url || '—'}`,
    `- Commits (${item.commit_count ?? 0}):`, ...(commits.length ? commits : ['  - todavía no hay']), '',
    '_Actualizado automáticamente por Softnexus Spec Driven. No edites este texto: cambia el ítem en el repositorio._',
    mark(item.id),
  ].join('\n');
}


// Altum muestra la descripción como texto plano (no interpreta Markdown): sin asteriscos, comillas
// invertidas ni marca oculta (el enlace firme es external_ref).
export function itemPlainBody(evt) {
  return itemMarkdownBody(evt)
    .replace(`\n${mark(evt.item.id)}`, '')
    .replace(/\*\*|`/g, '')
    .replace(/^## (.*)$/gm, (_, heading) => heading.toUpperCase())
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2');
}
