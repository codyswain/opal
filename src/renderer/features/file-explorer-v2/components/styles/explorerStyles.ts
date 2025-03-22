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
  
  // Colors
  lineColor: 'border-gray-700 dark:border-gray-700',
  selectedBgColor: 'bg-blue-800 dark:bg-blue-800',
  hoverBgColor: 'hover:bg-gray-700/30 dark:hover:bg-gray-700/30',
  loadingTextColor: 'text-gray-500',
  errorTextColor: 'text-red-500',
};

export default explorerStyles; 