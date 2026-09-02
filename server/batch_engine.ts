export interface NumericBatchOptions {
  type: 'numeric';
  from: number;
  to: number;
  step?: number;
  leadingZeros?: number; // e.g. 2 -> 01, 02
}

export interface AlphaBatchOptions {
  type: 'alpha';
  from: string; // 'a' or 'A'
  to: string;   // 'z' or 'Z'
  step?: number;
}

export type BatchPatternOptions = NumericBatchOptions | AlphaBatchOptions;

export interface ParsedBatchResult {
  urls: string[];
  total: number;
  errors: string[];
}

export class BatchEngine {
  /**
   * Expands an asterisk wildcard (*) pattern into a list of URLs based on options.
   * Example: "https://example.com/file_*.zip" with [1..5] -> 5 URLs.
   */
  public static expandPattern(urlPattern: string, options: BatchPatternOptions): ParsedBatchResult {
    const urls: string[] = [];
    const errors: string[] = [];

    if (!urlPattern || typeof urlPattern !== 'string') {
      return { urls: [], total: 0, errors: ['Pattern URL is empty or invalid.'] };
    }

    if (!urlPattern.includes('*')) {
      return { urls: [], total: 0, errors: ['Pattern URL must contain an asterisk wildcard (*)'] };
    }

    if (!urlPattern.startsWith('http://') && !urlPattern.startsWith('https://')) {
      return { urls: [], total: 0, errors: ['Pattern URL must start with http:// or https://'] };
    }

    if (options.type === 'numeric') {
      const { from, to, step = 1, leadingZeros = 0 } = options;
      if (isNaN(from) || isNaN(to)) {
        return { urls: [], total: 0, errors: ['Numeric range limits must be valid numbers.'] };
      }
      if (step <= 0) {
        return { urls: [], total: 0, errors: ['Step must be a positive number greater than 0.'] };
      }
      if (from > to) {
        return { urls: [], total: 0, errors: ['"From" cannot be greater than "To" in sequential range.'] };
      }

      // Safeguard max items to 500 per batch
      const count = Math.floor((to - from) / step) + 1;
      if (count > 500) {
        return { urls: [], total: 0, errors: [`Batch size (${count}) exceeds safe maximum of 500 items.`] };
      }

      for (let num = from; num <= to; num += step) {
        let numStr = num.toString();
        if (leadingZeros > 1) {
          numStr = numStr.padStart(leadingZeros, '0');
        }
        const expanded = urlPattern.replace('*', numStr);
        urls.push(expanded);
      }
    } else if (options.type === 'alpha') {
      const { from, to, step = 1 } = options;
      if (!from || !to || from.length !== 1 || to.length !== 1) {
        return { urls: [], total: 0, errors: ['Alpha range limits must be single characters.'] };
      }

      const startCode = from.charCodeAt(0);
      const endCode = to.charCodeAt(0);

      if (startCode > endCode) {
        return { urls: [], total: 0, errors: ['"From" character cannot come after "To" in alphabet.'] };
      }

      const isLower = startCode >= 97 && endCode <= 122;
      const isUpper = startCode >= 65 && endCode <= 90;

      if (!isLower && !isUpper) {
        return { urls: [], total: 0, errors: ['Alphabet range must be purely a-z or A-Z.'] };
      }

      for (let code = startCode; code <= endCode; code += step) {
        const char = String.fromCharCode(code);
        const expanded = urlPattern.replace('*', char);
        urls.push(expanded);
      }
    }

    return {
      urls,
      total: urls.length,
      errors
    };
  }

  /**
   * Parses a multi-line plain text list of URLs, stripping comments, whitespace,
   * deduplicating, and validating protocol.
   */
  public static parseMultiUrlList(rawText: string): ParsedBatchResult {
    const urls: string[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    if (!rawText || typeof rawText !== 'string') {
      return { urls: [], total: 0, errors: [] };
    }

    const lines = rawText.split(/[\r\n]+/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      if (!line.startsWith('http://') && !line.startsWith('https://')) {
        errors.push(`Line ${i + 1}: Invalid URL protocol (must be http/https) -> "${line.slice(0, 40)}"`);
        continue;
      }

      try {
        const parsed = new URL(line);
        const normalized = parsed.toString();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      } catch {
        errors.push(`Line ${i + 1}: Malformed URL -> "${line.slice(0, 40)}"`);
      }
    }

    return {
      urls,
      total: urls.length,
      errors
    };
  }
}
