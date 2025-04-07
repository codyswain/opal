import { rebuild as electronRebuild } from '@electron/rebuild';

module.exports = async (forgeConfig, packageJSON, electronVersion, platform, arch, buildPath) => {
  // Add more logging
  console.log('--- Running @electron/rebuild hook ---');
  console.log(`  Electron Version: ${electronVersion}`);
  console.log(`  Platform: ${platform}`);
  console.log(`  Architecture: ${arch}`);
  console.log(`  Build Path: ${buildPath}`);
  console.log('--------------------------------------');
  
  try {
    await electronRebuild({
      buildPath,
      electronVersion,
      arch,
      // mode: 'sequential', // Try without specifying mode first
      // onlyModules: ['better-sqlite3'], // Try rebuilding all native modules first
      force: true // Force rebuilding even if not strictly necessary
    });
    console.log('--- @electron/rebuild hook completed successfully ---');
  } catch (error) {
    console.error('--- @electron/rebuild hook failed ---');
    console.error(error);
    console.error('-------------------------------------');
    // Re-throw the error to potentially halt the build process
    throw error; 
  }
};
