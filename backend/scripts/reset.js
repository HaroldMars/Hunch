// Deletes the local database and uploaded files. Next start re-seeds the initial admin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
for (const f of fs.readdirSync(path.join(root, 'uploads'))) if (f !== '.gitkeep') fs.rmSync(path.join(root, 'uploads', f), { force: true });
console.log('Hunch data reset.');
