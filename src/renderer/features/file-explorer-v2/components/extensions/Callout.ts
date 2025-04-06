import { Node, mergeAttributes } from '@tiptap/core';

export interface CalloutOptions {
  HTMLAttributes: Record<string, string>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /**
       * Toggle a callout
       */
      setCallout: (attributes?: { type: string }) => ReturnType;
      /**
       * Toggle a callout
       */
      toggleCallout: (attributes?: { type: string }) => ReturnType;
      /**
       * Unset a callout
       */
      unsetCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: 'callout',
  
  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },
  
  content: 'block+',
  
  group: 'block',
  
  defining: true,
  
  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
      },
    ];
  },
  
  renderHTML({ HTMLAttributes }) {
    const type = HTMLAttributes.type || 'info';
    
    return [
      'div',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          'data-type': 'callout',
          'data-callout-type': type,
          class: `callout callout-${type}`,
        },
      ),
      ['div', { class: 'callout-content' }, 0],
    ];
  },
  
  addCommands() {
    return {
      setCallout:
        (attributes = { type: 'info' }) =>
          ({ commands }) => {
            return commands.setNode(this.name, attributes);
          },
      toggleCallout:
        (attributes = { type: 'info' }) =>
          ({ commands }) => {
            return commands.toggleNode(this.name, 'paragraph', attributes);
          },
      unsetCallout:
        () =>
          ({ commands }) => {
            return commands.lift(this.name);
          },
    };
  },
}); 