/**
 * Global style configuration for the file explorer
 * These values can be connected to user preferences in the future
 */
const explorerStyles = {
  // Spacing and sizing
  indentationWidth: 16,
  indentationOffset: 8,
  itemHeight: 6,        // Increased from 5 to 6 for better vertical spacing
  itemPaddingY: 0.5,    // Increased from 0.25 to 0.5 for better vertical padding
  itemPaddingX: 1,      // Increased from 0.5 to 1 for better horizontal padding
  iconSize: 4,          // w-4 h-4
  iconMargin: 1.5,      // Increased from 1 to 1.5 for better spacing
  
  // Text sizes
  itemTextSize: 'sm',   // Increased from xs to sm for better legibility
  headerTextSize: 'sm', // text-sm
  
  // Colors (Now using theme variables via Tailwind classes)
  lineColorClass: 'border-[hsl(var(--border)_/_0.4)]', // Using border color with opacity
  selectedBgColorClass: 'bg-accent', // Using accent color for selected background
  selectedTextColorClass: 'text-accent-foreground', // Using accent foreground for selected text
  hoverBgColorClass: 'hover:bg-accent/50', // Using accent color with opacity for hover
  loadingTextColorClass: 'text-muted-foreground', // Using muted foreground for loading
  errorTextColorClass: 'text-destructive', // Using destructive color for errors
  mountedColorClass: 'text-primary', // Using primary color for mounted status
};

export default explorerStyles; 