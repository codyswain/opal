const fs = require('fs');
const path = require('path');

// Paths
const sourcePath = path.resolve(__dirname, '.vite', 'build', 'main.js');
const destDirRoot = path.resolve(__dirname, 'out');

// Check if main.js exists after direct build
if (!fs.existsSync(sourcePath)) {
  console.error(`Source file not found: ${sourcePath}`);
  process.exit(1);
}

console.log(`Source file exists: ${sourcePath}`);

// Find all directories in "out" that might contain the app
if (!fs.existsSync(destDirRoot)) {
  console.log('Output directory not found yet, this must be run after packaging');
  process.exit(0);
}

// Find app.asar or app directory in each build output
const builds = fs.readdirSync(destDirRoot);
let targetDirectories = [];

builds.forEach(build => {
  const buildPath = path.join(destDirRoot, build);
  if (fs.statSync(buildPath).isDirectory()) {
    const appPath = path.join(buildPath, 'Opal.app', 'Contents', 'Resources', 'app');
    const asarPath = path.join(buildPath, 'Opal.app', 'Contents', 'Resources', 'app.asar');
    
    if (fs.existsSync(appPath)) {
      targetDirectories.push({
        path: appPath,
        type: 'directory'
      });
      console.log(`Found app directory: ${appPath}`);
    }
    
    if (fs.existsSync(asarPath)) {
      targetDirectories.push({
        path: asarPath,
        type: 'asar'
      });
      console.log(`Found app.asar: ${asarPath}`);
    }
  }
});

if (targetDirectories.length === 0) {
  console.log('No target directories found');
  process.exit(0);
}

// Copy main.js to each non-asar directory (we can't modify asar files directly)
targetDirectories.forEach(target => {
  if (target.type === 'directory') {
    const destDir = path.join(target.path, '.vite', 'build');
    const destPath = path.join(destDir, 'main.js');
    
    // Ensure destination directory exists
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    // Copy the file
    fs.copyFileSync(sourcePath, destPath);
    console.log(`Copied main.js to: ${destPath}`);
  } else {
    console.log(`Skipping asar file: ${target.path} (cannot modify directly)`);
  }
});

console.log('Build fix completed'); 