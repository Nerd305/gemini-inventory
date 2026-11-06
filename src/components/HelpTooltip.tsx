import React from 'react';
import { HelpCircle } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';

interface HelpTooltipProps {
  content: string | React.ReactNode;
  iconSize?: number;
  className?: string;
}

/**
 * The "?" help icon. It opens on tap or click (a hover-only tooltip never opens on a phone or with a
 * stylus), and closes when you tap anywhere else.
 */
export function HelpTooltip({ content, iconSize = 16, className }: HelpTooltipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`text-gray-400 hover:text-blue-500 focus:outline-none transition-colors inline-flex align-middle ml-1.5 ${className || ''}`}
          aria-label="Help"
          onClick={(e) => e.stopPropagation()}
        >
          <HelpCircle size={iconSize} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-w-[280px] rounded-md bg-gray-900 p-3 text-sm leading-relaxed text-white shadow-xl outline-none"
        >
          {content}
          <Popover.Arrow className="fill-gray-900" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
