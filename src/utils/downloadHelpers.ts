/**
 * Download Status and Lifecycle Helper Utilities
 */

import { DownloadItem } from '../types/download';

export type DownloadStatus = DownloadItem['status'];

export function isDownloadActive(status?: string): boolean {
  return status === 'downloading' || status === 'probing';
}

export function isDownloadPausable(status?: string): boolean {
  return status === 'downloading' || status === 'probing' || status === 'queued';
}

export function isDownloadResumable(status?: string): boolean {
  return status === 'paused' || status === 'queued' || status === 'error';
}

export function isDownloadCompleted(status?: string): boolean {
  return status === 'completed';
}

export function isDownloadError(status?: string): boolean {
  return status === 'error';
}

export function isDownloadQueued(status?: string): boolean {
  return status === 'queued';
}
