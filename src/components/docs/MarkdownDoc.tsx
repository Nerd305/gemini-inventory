import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';

import { GITHUB_REPO_URL } from '../../lib/links';

/**
 * Links inside the markdown are written for GitHub (relative to docs/). In the app we route the
 * API reference to its page and send everything else to the GitHub blob view.
 */
function resolveHref(href: string): { to?: string; href?: string; external: boolean } {
  if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) return { href, external: true };
  if (href.startsWith('#')) return { href, external: false };
  const clean = href.replace(/^\.\//, '');
  if (/(^|\/)API\.md(#.*)?$/.test(clean)) return { to: '/api-docs', external: false };
  const repoPath = clean.startsWith('../') ? clean.slice(3) : `docs/${clean}`;
  return { href: `${GITHUB_REPO_URL}/blob/main/${repoPath}`, external: true };
}

const components: Components = {
  a: ({ node: _node, href, children, ...props }) => {
    const r = resolveHref(href ?? '');
    if (r.to) {
      return (
        <Link to={r.to} className="text-teal-700 underline underline-offset-2 hover:text-teal-900">
          {children}
        </Link>
      );
    }
    return (
      <a
        href={r.href}
        target={r.external ? '_blank' : undefined}
        rel={r.external ? 'noreferrer' : undefined}
        className="text-teal-700 underline underline-offset-2 hover:text-teal-900"
        {...props}
      >
        {children}
      </a>
    );
  },
  h1: ({ node: _node, ...p }) => <h1 className="text-2xl font-bold text-gray-900 mt-1 mb-3" {...p} />,
  h2: ({ node: _node, ...p }) => <h2 className="text-lg font-semibold text-gray-900 mt-7 mb-2 pb-1 border-b border-gray-200" {...p} />,
  h3: ({ node: _node, ...p }) => <h3 className="text-base font-semibold text-gray-900 mt-5 mb-1.5" {...p} />,
  p: ({ node: _node, ...p }) => <p className="text-sm text-gray-700 leading-relaxed mb-3" {...p} />,
  ul: ({ node: _node, className, ...p }) => (
    <ul className={`${className?.includes('contains-task-list') ? 'list-none pl-0' : 'list-disc pl-5'} mb-3 space-y-1 text-sm text-gray-700`} {...p} />
  ),
  ol: ({ node: _node, ...p }) => <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm text-gray-700" {...p} />,
  li: ({ node: _node, className, ...p }) => <li className={className?.includes('task-list-item') ? 'flex items-start gap-2' : ''} {...p} />,
  input: ({ node: _node, ...p }) => <input className="mt-1 h-3.5 w-3.5 shrink-0 accent-teal-600" {...p} readOnly />,
  table: ({ node: _node, ...p }) => (
    <div className="overflow-x-auto mb-4 rounded-md border border-gray-200">
      <table className="w-full text-sm border-collapse" {...p} />
    </div>
  ),
  thead: ({ node: _node, ...p }) => <thead className="bg-gray-50" {...p} />,
  th: ({ node: _node, ...p }) => <th className="border-b border-gray-200 px-2.5 py-1.5 text-left font-semibold text-gray-800 align-top" {...p} />,
  td: ({ node: _node, ...p }) => <td className="border-b border-gray-100 px-2.5 py-1.5 text-gray-700 align-top" {...p} />,
  code: ({ node: _node, className, children, ...p }) => {
    const isBlock = typeof className === 'string' && className.startsWith('language-');
    if (isBlock) {
      return (
        <code className={`${className} font-mono`} {...p}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.85em] font-mono text-gray-800" {...p}>
        {children}
      </code>
    );
  },
  pre: ({ node: _node, ...p }) => <pre className="bg-gray-900 text-gray-100 text-xs rounded-md p-3 overflow-x-auto mb-4 leading-relaxed" {...p} />,
  hr: ({ node: _node, ...p }) => <hr className="my-6 border-gray-200" {...p} />,
  strong: ({ node: _node, ...p }) => <strong className="font-semibold text-gray-900" {...p} />,
  blockquote: ({ node: _node, ...p }) => <blockquote className="border-l-4 border-teal-300 pl-3 text-gray-600 italic mb-3" {...p} />,
};

interface MarkdownDocProps {
  markdown: string;
  className?: string;
}

/** Renders one of the docs/*.md files with GitHub-flavored markdown (tables, task lists). */
export default function MarkdownDoc({ markdown, className }: MarkdownDocProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
