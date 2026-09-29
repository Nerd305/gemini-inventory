import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lightbulb } from 'lucide-react';

interface NextStepHintProps {
  children: ReactNode;
  to?: string;
  cta?: string;
}

/** One-line "what to do next" strip used at the top of setup pages. */
export function NextStepHint({ children, to, cta }: NextStepHintProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
      <span className="flex items-start gap-2">
        <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-teal-600" />
        <span>{children}</span>
      </span>
      {to && cta && (
        <Link to={to} className="inline-flex items-center font-semibold text-teal-800 hover:text-teal-900 whitespace-nowrap">
          {cta} <ArrowRight className="h-4 w-4 ml-1" />
        </Link>
      )}
    </div>
  );
}
