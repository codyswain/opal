import * as React from 'react';
import { cn } from '@/renderer/shared/utils';

interface SegmentedControlOption<Value extends string> {
  value: Value;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<Value extends string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  label: string;
  options: readonly SegmentedControlOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  size?: 'compact' | 'default';
}

function SegmentedControl<Value extends string>({
  className,
  label,
  onValueChange,
  options,
  size = 'compact',
  value,
  ...props
}: SegmentedControlProps<Value>) {
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const fallbackIndex = options.findIndex((option) => !option.disabled);
  const selectedCanReceiveFocus =
    selectedIndex >= 0 && !options[selectedIndex]?.disabled;
  const tabStopIndex = selectedCanReceiveFocus ? selectedIndex : fallbackIndex;

  const findEnabled = (from: number, direction: 1 | -1) => {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (from + direction * offset + options.length) % options.length;
      if (!options[index]?.disabled) return index;
    }
    return from;
  };

  const selectAt = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    itemRefs.current[index]?.focus();
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = findEnabled(index, 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = findEnabled(index, -1);
    } else if (event.key === 'Home') {
      nextIndex = fallbackIndex;
    } else if (event.key === 'End') {
      nextIndex = [...options]
        .map((option, optionIndex) => ({ option, optionIndex }))
        .reverse()
        .find(({ option }) => !option.disabled)?.optionIndex ?? null;
    }

    if (nextIndex === null || nextIndex < 0) return;
    event.preventDefault();
    selectAt(nextIndex);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-control bg-surface-hover p-0.5',
        className
      )}
      {...props}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            disabled={option.disabled}
            tabIndex={index === tabStopIndex ? 0 : -1}
            className={cn(
              'inline-flex items-center justify-center gap-1 rounded-row px-2',
              'text-control text-foreground-secondary outline-none',
              'transition-hover',
              'hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus',
              'disabled:pointer-events-none disabled:opacity-40',
              size === 'compact' ? 'h-6' : 'h-control-compact',
              selected &&
                'bg-surface-lift text-foreground shadow-control'
            )}
            onClick={() => selectAt(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
export type { SegmentedControlOption, SegmentedControlProps };
