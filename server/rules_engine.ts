import path from 'path';
import { CategoryRule } from './settings_store';

export type ConditionType = 'extension' | 'url_pattern' | 'hostname' | 'min_size' | 'max_size';

export interface RuleCondition {
  type: ConditionType;
  value: string | number;
}

export interface RuleAction {
  categoryId?: string;
  destinationFolder?: string;
  queueId?: string;
  priority?: 'high' | 'normal' | 'low';
  maxConnections?: number;
}

export interface DownloadRule {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  condition: RuleCondition;
  action: RuleAction;
}

export class RulesEngine {
  private rules: DownloadRule[] = [];

  constructor(initialRules: DownloadRule[] = []) {
    this.rules = [...initialRules].sort((a, b) => a.order - b.order);
  }

  public setRules(rules: DownloadRule[]): void {
    this.rules = [...rules].sort((a, b) => a.order - b.order);
  }

  public getRules(): DownloadRule[] {
    return JSON.parse(JSON.stringify(this.rules));
  }

  public evaluate(url: string, filename: string, sizeBytes?: number): RuleAction | null {
    const ext = this.extractExtension(filename || url);

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      let isMatch = false;
      const { type, value } = rule.condition;

      switch (type) {
        case 'extension': {
          const targetExts = String(value).toLowerCase().split(',').map(e => e.trim().replace(/^\./, ''));
          if (ext && targetExts.includes(ext.toLowerCase())) {
            isMatch = true;
          }
          break;
        }
        case 'hostname': {
          try {
            const parsedUrl = new URL(url);
            const host = parsedUrl.hostname.toLowerCase();
            const targetHost = String(value).toLowerCase().trim();
            if (targetHost.startsWith('*.')) {
              const rootDomain = targetHost.slice(2);
              if (host === rootDomain || host.endsWith('.' + rootDomain)) {
                isMatch = true;
              }
            } else if (host === targetHost) {
              isMatch = true;
            }
          } catch {}
          break;
        }
        case 'url_pattern': {
          try {
            const pattern = String(value);
            if (pattern.includes('*')) {
              const regexStr = '^' + pattern.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&').replace(/\\\*/g, '.*') + '$';
              const regex = new RegExp(regexStr, 'i');
              if (regex.test(url)) isMatch = true;
            } else if (url.toLowerCase().includes(pattern.toLowerCase())) {
              isMatch = true;
            }
          } catch {}
          break;
        }
        case 'min_size': {
          if (typeof sizeBytes === 'number' && sizeBytes >= Number(value)) {
            isMatch = true;
          }
          break;
        }
        case 'max_size': {
          if (typeof sizeBytes === 'number' && sizeBytes <= Number(value)) {
            isMatch = true;
          }
          break;
        }
      }

      if (isMatch) {
        return { ...rule.action };
      }
    }

    return null;
  }

  public resolveCategory(filename: string, categories: CategoryRule[], defaultDir: string): { categoryId: string; destinationFolder: string } {
    const ext = this.extractExtension(filename);
    if (!ext) {
      return { categoryId: 'other', destinationFolder: defaultDir };
    }

    const cleanExt = ext.toLowerCase();
    for (const cat of categories) {
      if (cat.extensions && cat.extensions.map(e => e.toLowerCase()).includes(cleanExt)) {
        return {
          categoryId: cat.id,
          destinationFolder: cat.defaultFolder || path.join(defaultDir, cat.name),
        };
      }
    }

    return { categoryId: 'other', destinationFolder: defaultDir };
  }

  private extractExtension(filenameOrUrl: string): string {
    try {
      const clean = filenameOrUrl.split('?')[0].split('#')[0];
      const basename = path.basename(clean);
      const dotIndex = basename.lastIndexOf('.');
      if (dotIndex > 0 && dotIndex < basename.length - 1) {
        return basename.slice(dotIndex + 1);
      }
    } catch {}
    return '';
  }
}
