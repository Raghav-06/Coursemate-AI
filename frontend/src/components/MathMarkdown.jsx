import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Markdown with LaTeX (KaTeX). Loaded lazily by Markdown.jsx, only for text
// that contains maths, so KaTeX stays out of the main bundle.
const KATEX = [[rehypeKatex, { throwOnError: false, strict: false }]];

export default function MathMarkdown({ children, components, gfm = true }) {
  return (
    <ReactMarkdown remarkPlugins={gfm ? [remarkGfm, remarkMath] : [remarkMath]} rehypePlugins={KATEX} components={components}>
      {children}
    </ReactMarkdown>
  );
}
