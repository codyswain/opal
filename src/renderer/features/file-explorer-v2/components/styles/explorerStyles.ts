/**
 * Global style configuration for the file explorer
 * These values can be connected to user preferences in the future
 */
const explorerStyles = {
  // Spacing and sizing
  indentationWidth: 10,
  indentationOffset: 8,
  itemHeight: 6.5,        // Tailwind height units (h-6)
  itemPaddingY: 1,      // Tailwind py-1
  itemPaddingX: 1.5,    // Tailwind px-1.5
  iconSize: 4.5,        // w-4.5 h-4.5
  iconMargin: 1.5,      // mr-1.5
  
  // Text sizes
  itemTextSize: 'sm',   // text-xs
  headerTextSize: 'sm', // text-sm
  
  // Colors
  lineColor: 'border-gray-300 dark:border-gray-600',
  selectedBgColor: 'bg-blue-100 dark:bg-blue-900',
  hoverBgColor: 'hover:bg-gray-100 dark:hover:bg-gray-800',
  loadingTextColor: 'text-gray-500',
  errorTextColor: 'text-red-500',
};

export default explorerStyles; 