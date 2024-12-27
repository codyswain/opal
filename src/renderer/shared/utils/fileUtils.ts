import fs from 'fs';

export function createDirectoryIfNotExists(dirPath: string){
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
