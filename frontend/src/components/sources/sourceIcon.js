export const IMAGE_TYPES = ["png", "jpg", "jpeg", "webp"];
export const AUDIO_TYPES = ["mp3", "m4a", "wav", "webm", "ogg"];
export const VIDEO_TYPES = ["mp4", "mov", "mkv"];

const FILE_ICONS = {
  pdf: ["picture_as_pdf", "text-red-600 dark:text-red-400"],
  docx: ["article", "text-blue-600 dark:text-blue-400"],
  pptx: ["slideshow", "text-orange-600 dark:text-orange-400"],
  txt: ["description", "text-ink-2"],
  md: ["description", "text-ink-2"],
  csv: ["table_chart", "text-emerald-600 dark:text-emerald-400"],
};
const IMAGE_ICON = ["image", "text-pink-600 dark:text-pink-400"];
const AUDIO_ICON = ["mic", "text-teal-600 dark:text-teal-400"];
const VIDEO_ICON = ["videocam", "text-indigo-600 dark:text-indigo-400"];
for (const ext of IMAGE_TYPES) FILE_ICONS[ext] = IMAGE_ICON;
for (const ext of AUDIO_TYPES) FILE_ICONS[ext] = AUDIO_ICON;
for (const ext of VIDEO_TYPES) FILE_ICONS[ext] = VIDEO_ICON;

/** "image" | "audio" | "video" for uploads that have a viewable original, else null. */
export function mediaKind(source) {
  if (source.type !== "file") return null;
  if (IMAGE_TYPES.includes(source.fileType)) return "image";
  if (AUDIO_TYPES.includes(source.fileType)) return "audio";
  if (VIDEO_TYPES.includes(source.fileType)) return "video";
  return null;
}

export function sourceIcon(source) {
  if (source.type === "url") {
    if (/arxiv\.org|\.pdf($|\?)/i.test(source.url ?? "")) return ["picture_as_pdf", "text-red-600 dark:text-red-400"];
    return ["language", "text-sky-600 dark:text-sky-400"];
  }
  if (source.type === "text") return ["content_paste", "text-violet-600 dark:text-violet-400"];
  if (source.type === "note") return ["sticky_note_2", "text-amber-600 dark:text-amber-400"];
  return FILE_ICONS[source.fileType] ?? FILE_ICONS[source.title?.split(".").pop()?.toLowerCase()] ?? ["description", "text-ink-2"];
}
