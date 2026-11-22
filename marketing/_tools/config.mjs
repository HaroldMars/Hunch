import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..'); // the Hunch project folder
export const MARKETING = path.resolve(here, '..');
export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const API = process.env.HUNCH_API || 'http://localhost:5050/api';
export const CLIENT = process.env.HUNCH_CLIENT || 'http://localhost:5173';
export const ADMIN = process.env.HUNCH_ADMIN || 'http://localhost:3000';
export const PASSWORD = 'Hunch@2026';
