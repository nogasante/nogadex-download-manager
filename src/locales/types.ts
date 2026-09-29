import en from './en';

/**
 * Every locale must satisfy this type: it is the English source of truth, so a
 * missing or misspelled key in any translation is a compile error, not a
 * runtime "undefined" rendered into the UI.
 */
export type TranslatedStrings = typeof en;
