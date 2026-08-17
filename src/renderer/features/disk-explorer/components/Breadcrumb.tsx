import React, { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { segmentsWithinRoot } from '@/common/pathSegments';
import { useDiskStore } from '../store/diskStore';

export const Breadcrumb: React.FC<{ dirPath: string }> = ({ dirPath }) => {
  const roots = useDiskStore((state) => state.roots);
  const select = useDiskStore((state) => state.select);

  // A path belongs to exactly one root; find the one that contains it.
  const segments = useMemo(() => {
    for (const root of roots) {
      const trail = segmentsWithinRoot(root, dirPath);
      if (trail.length > 0) return trail;
    }
    return [];
  }, [roots, dirPath]);

  if (segments.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="breadcrumb"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto px-3 py-1.5"
    >
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <React.Fragment key={segment.path}>
            {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />}
            <button
              type="button"
              onClick={() => select(segment.path)}
              aria-current={isLast ? 'page' : undefined}
              data-testid={`crumb-${segment.path}`}
              className={`whitespace-nowrap rounded px-2 py-1 text-2xs transition-colors duration-100 ${
                isLast ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {segment.name}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
};
