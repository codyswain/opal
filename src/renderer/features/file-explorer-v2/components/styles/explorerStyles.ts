/**
 * Global style configuration for the file explorer
 * These values can be connected to user preferences in the future
 */
const explorerStyles = {
  // Spacing and sizing
  indentationWidth: 16,
  indentationOffset: 8,
  itemHeight: 5,        // Tailwind height units (h-5)
  itemPaddingY: 0.25,   // Tailwind py-0.25
  itemPaddingX: 0.5,    // Tailwind px-0.5
  iconSize: 4,          // w-4 h-4
  iconMargin: 1,        // mr-1
  
  // Text sizes
  itemTextSize: 'xs',   // text-xs
  headerTextSize: 'sm', // text-sm
  
  // Colors
  lineColor: 'border-gray-700 dark:border-gray-700',
  selectedBgColor: 'bg-blue-800 dark:bg-blue-800',
  hoverBgColor: 'hover:bg-gray-700/30 dark:hover:bg-gray-700/30',
  loadingTextColor: 'text-gray-500',
  errorTextColor: 'text-red-500',
};

export default explorerStyles; 