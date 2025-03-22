import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('slashCommand'),
        props: {
          handleKeyDown: (view, event) => {
            // This is a simplified implementation
            // A real implementation would show a floating menu with options
            if (event.key === '/') {
              // Simplified to just log - in a full implementation, this would show a menu
              console.log('Slash command triggered');
              
              // Return false to allow the slash character to be inserted
              return false;
            }
            
            return false;
          },
        },
      }),
    ];
  },
}); 