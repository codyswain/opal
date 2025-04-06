import { Extension } from '@tiptap/core';

export const KeyboardShortcuts = Extension.create({
  name: 'keyboardShortcuts',

  addKeyboardShortcuts() {
    return {
      // Formatting shortcuts
      'Mod-b': () => this.editor.commands.toggleBold(),
      'Mod-i': () => this.editor.commands.toggleItalic(),
      'Mod-u': () => this.editor.commands.toggleUnderline(),
      'Mod-`': () => this.editor.commands.toggleCode(),
      'Mod-Shift-h': () => this.editor.commands.toggleHighlight(),
      
      // List shortcuts
      'Mod-Shift-8': () => this.editor.commands.toggleBulletList(),
      'Mod-Shift-9': () => this.editor.commands.toggleOrderedList(),
      'Mod-Shift-t': () => this.editor.commands.toggleTaskList(),
      
      // Block shortcuts
      'Mod-Shift-b': () => this.editor.commands.toggleBlockquote(),
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock(),
      
      // Heading shortcuts
      'Mod-Alt-1': () => this.editor.commands.toggleHeading({ level: 1 }),
      'Mod-Alt-2': () => this.editor.commands.toggleHeading({ level: 2 }),
      'Mod-Alt-3': () => this.editor.commands.toggleHeading({ level: 3 }),
      'Mod-Alt-4': () => this.editor.commands.toggleHeading({ level: 4 }),
      'Mod-Alt-5': () => this.editor.commands.toggleHeading({ level: 5 }),
      'Mod-Alt-6': () => this.editor.commands.toggleHeading({ level: 6 }),
      
      // Link shortcuts
      'Mod-k': () => {
        const previousUrl = this.editor.getAttributes('link').href;
        const url = window.prompt('URL', previousUrl);
        
        // cancelled
        if (url === null) {
          return true;
        }
        
        // empty
        if (url === '') {
          this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
          return true;
        }
        
        // update link
        this.editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        return true;
      },
      
      // Special shortcuts
      'Mod-Enter': () => {
        // Toggle task completion if in a task list
        if (this.editor.isActive('taskItem')) {
          return this.editor.commands.toggleTaskList();
        }
        return false;
      },
      
      // Table navigation
      'Tab': ({ editor }) => {
        if (editor.isActive('table')) {
          return editor.commands.goToNextCell();
        }
        return false;
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('table')) {
          return editor.commands.goToPreviousCell();
        }
        return false;
      },
    };
  },
}); 