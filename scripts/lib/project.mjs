import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_FOLDER = 'com.ulanzi.soundpad.ulanziPlugin';
export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const pluginDir = join(root, PLUGIN_FOLDER);
export const zipPath = join(root, 'dist', `${PLUGIN_FOLDER}.zip`);
