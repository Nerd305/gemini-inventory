import React from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

interface HelpTooltipProps {
  content: string | React.ReactNode;
  iconSize?: number;
  className?: string;
}

export function HelpTooltip({ content, iconSize = 16, className }: HelpTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button 
            type="button" 
            className={`text-gray-400 hover:text-blue-500 focus:outline-none transition-colors inline-flex align-middle ml-1.5 ${className || ''}`}
            aria-label="Help"
            onClick={(e) => e.preventDefault()}
          >
            <HelpCircle size={iconSize} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] bg-gray-900 text-white p-3 text-sm shadow-xl leading-relaxed">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
