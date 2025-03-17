# File Explorer

A feature module for browsing and interacting with files and notes.

## Directory Structure

```
file-explorer-v2/
├── components/         # UI components
│   ├── elements/       # Reusable UI elements
│   ├── styles/         # Component styles
│   └── ...             # Individual component files
├── context/            # React context for state sharing
├── hooks/              # Custom React hooks
├── store/              # State management (Zustand)
├── index.ts            # Public API exports
└── README.md           # This documentation
```

## Usage

```tsx
import { Explorer, FileExplorerProvider } from '@/renderer/features/file-explorer-v2';

// In your component:
const MyComponent = () => {
  return (
    <Explorer 
      isLeftSidebarOpen={true}
      isRightSidebarOpen={false}
      setIsLeftSidebarOpen={setLeftOpen}
      setIsRightSidebarOpen={setRightOpen}
    />
  );
};
```

## Architecture

This feature follows a clean architecture pattern:

1. **Components**: UI elements that render the explorer interface
2. **Context**: Provides state and operations to components
3. **Hooks**: Custom logic for data fetching and state management
4. **Store**: Global state management using Zustand

All internal implementation details are hidden, with only necessary components and hooks exported via the main `index.ts` file. 