import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data', 'todotime.sqlite');
if (fs.existsSync(file)) fs.unlinkSync(file);
console.log('Database reset:', file);
