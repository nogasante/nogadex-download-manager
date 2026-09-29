import packageJson from '../../package.json';

export const APP_NAME = 'Nogadex Download Manager';
export const APP_SHORT_NAME = 'NDM';
export const APP_VERSION = packageJson.version || '1.0.1';
export const APP_ARCH = '64-bit';
export const APP_BUILD = '2026.1';
export const APP_VERSION_LABEL = `${APP_SHORT_NAME} v${APP_VERSION} (${APP_ARCH})`;
export const APP_FULL_TITLE = `${APP_NAME} v${APP_VERSION}`;
export const APP_COPYRIGHT = 'Copyright © 2026 Nogadex Systems. All rights reserved.';
export const APP_DESCRIPTION = 'Fast, reliable multi-stream download manager for Windows — parallel segmented downloads, instant resume, scheduler, and built-in integrity verification.';

// System Default Fallback Paths (Dynamically populated by Electron / server os.homedir())
export const DEFAULT_DOWNLOAD_DIR = '';
export const DEFAULT_TEMP_DIR = '';

