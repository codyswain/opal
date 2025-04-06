/**
 * Development Helper Script
 * Resolves common issues in the development workflow.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Build paths
const mainBuildPath = path.join(__dirname, '.vite', 'build', 'main.js');
const preloadBuildPath = path.join(__dirname, '.vite', 'build', 'preload.js');
const rendererBuildPath = path.join(__dirname, '.vite', 'renderer', 'main_window', 'index.html');

// Check if builds exist
const mainExists = fs.existsSync(mainBuildPath);
const preloadExists = fs.existsSync(preloadBuildPath);
const rendererExists = fs.existsSync(rendererBuildPath);

console.log('=== Dev Helper ===');
console.log(`Main build exists: ${mainExists ? 'Yes' : 'No'}`);
console.log(`Preload build exists: ${preloadExists ? 'Yes' : 'No'}`);
console.log(`Renderer build exists: ${rendererExists ? 'Yes' : 'No'}`);

// Build what's missing
if (!mainExists) {
  console.log('\nBuilding main process...');
  execSync('npx vite build --config vite.main.config.ts', { stdio: 'inherit' });
}

if (!preloadExists) {
  console.log('\nBuilding preload process...');
  execSync('npx vite build --config vite.preload.config.ts', { stdio: 'inherit' });
}

if (!rendererExists) {
  console.log('\nBuilding renderer process...');
  execSync('npx vite build --config vite.renderer.config.ts', { stdio: 'inherit' });
}

// Start development server
console.log('\nStarting development server...');
execSync('electron-forge start', { stdio: 'inherit' }); 