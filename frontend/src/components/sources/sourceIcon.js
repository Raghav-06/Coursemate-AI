const FILE_ICONS = {
  pdf: ["picture_as_pdf", "text-red-600 dark:text-red-400"],
  docx: ["article", "text-blue-600 dark:text-blue-400"],
  pptx: ["slideshow", "text-orange-600 dark:text-orange-400"],
  txt: ["description", "text-ink-2"],
  md: ["description", "text-ink-2"],
  csv: ["table_chart", "text-emerald-600 dark:text-emerald-400"],
};

export function sourceIcon(source) {
  if (source.type === "url") {
    if (/arxiv\.org|\.pdf($|\?)/i.test(source.url ?? "")) return ["picture_as_pdf", "text-red-600 dark:text-red-400"];
    return ["language", "text-sky-600 dark:text-sky-400"];
  }
  if (source.type === "text") return ["content_paste", "text-violet-600 dark:text-violet-400"];
  if (source.type === "note") return ["sticky_note_2", "text-amber-600 dark:text-amber-400"];
  return FILE_ICONS[source.fileType] ?? FILE_ICONS[source.title?.split(".").pop()?.toLowerCase()] ?? ["description", "text-ink-2"];
}
