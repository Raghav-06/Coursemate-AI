// Plain text of an answer for copy/export: drop citation markers.
export function stripCitations(text) {
  return (text ?? "").replace(/\s?\[\d+(?:\s*,\s*\d+)*\](?!\()/g, "");
}
