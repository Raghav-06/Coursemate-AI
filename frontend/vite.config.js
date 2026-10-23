import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The backend runs on :3000 by default; set BACKEND_URL to proxy elsewhere
// (e.g. BACKEND_URL=http://localhost:3100 npm run dev).
const backend = process.env.BACKEND_URL || "http://localhost:3000";

// Vendor code in its own long-cached chunks (Rolldown's manual chunk groups;
// the successor of Rollup's manualChunks): React, the Markdown pipeline
// (react-markdown, remark/rehype, micromark…) and KaTeX with the maths-only
// plugins, which load only with text that has maths. A group takes only the
// modules it matches, so shared Markdown utilities stay in "markdown" and the
// eager chunks never import KaTeX. Pages and course tools use React.lazy.
const MATH = /[\\/]node_modules[\\/](katex|remark-math|rehype-katex|micromark-extension-math|mdast-util-math|hast-util-from-html-isomorphic|hast-util-from-dom|hast-util-from-html|hast-util-to-text)[\\/]/;
const MARKDOWN =
  /[\\/]node_modules[\\/](react-markdown|remark-[^\\/]+|rehype-[^\\/]+|micromark[^\\/]*|mdast-[^\\/]+|hast-[^\\/]+|hastscript|unist-[^\\/]+|unified|vfile[^\\/]*|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities[^\\/]*|html-url-attributes|devlop|bail|trough|zwitch|ccount|markdown-table|longest-streak|estree-util-[^\\/]+|style-to-[^\\/]+|inline-style-parser|trim-lines|is-plain-obj|web-namespaces|html-void-elements|parse5|entities|escape-string-regexp|extend|@ungap[\\/][^\\/]+)[\\/]/;

const vendorChunks = {
  // A group takes only the modules its test matches (by default it would also take their dependencies).
  includeDependenciesRecursively: false,
  groups: [
    { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
    { name: "katex", test: MATH, priority: 20 },
    { name: "markdown", test: (id) => MARKDOWN.test(id) && !MATH.test(id), priority: 10 },
  ],
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: { output: { codeSplitting: vendorChunks } },
  },
  server: {
    // Proxying keeps API calls same-origin in dev.
    proxy: {
      "/api": backend,
      "/health": backend,
      // Google OAuth start + callback, so the session cookie is set on this origin.
      "/auth": backend,
    },
  },
});
