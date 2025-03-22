import { Node, mergeAttributes } from '@tiptap/core';

export interface FrontMatterOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    frontMatter: {
      /**
       * Set a YAML frontmatter block
       */
      setFrontMatter: (content: string) => ReturnType;
      /**
       * Toggle a YAML frontmatter block
       */
      toggleFrontMatter: () => ReturnType;
    };
  }
}

export const FrontMatter = Node.create<FrontMatterOptions>({
  name: 'frontMatter',
  
  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },
  
  content: 'text*',
  
  marks: '',
  
  group: 'block',
  
  code: true,
  
  defining: true,
  
  isolating: true,
  
  parseHTML() {
    return [
      {
        tag: 'pre[data-type="frontmatter"]',
      },
    ];
  },
  
  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          'data-type': 'frontmatter',
          class: 'frontmatter',
        },
      ),
      ['code', {}, 0],
    ];
  },
  
  addCommands() {
    return {
      setFrontMatter:
        (content = '') =>
          ({ commands }) => {
            return commands.setNode(this.name, { content });
          },
      toggleFrontMatter:
        () =>
          ({ commands }) => {
            return commands.toggleNode(this.name, 'paragraph', { content: '---\ntitle: Untitled\ndate: ' + new Date().toISOString().split('T')[0] + '\ntags: []\n---' });
          },
    };
  },
  
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-y': () => this.editor.commands.toggleFrontMatter(),
    };
  },
}); 