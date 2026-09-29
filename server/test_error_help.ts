/**
 * Checks pickHelpGuideForError() against the exact humanized error strings
 * the engine writes into item.error (server/engine.ts humanizeError).
 */
import { pickHelpGuideForError } from '../src/utils/errorHelp';

let fail = 0;
function expect(label: string, errorText: string | undefined, wantGuide: string) {
  const got = pickHelpGuideForError(errorText).guideId;
  if (got === wantGuide) {
    console.log(`[PASS] ${label} -> ${got}`);
  } else {
    fail++;
    console.log(`[FAIL] ${label} -> ${got}, want ${wantGuide}`);
  }
}

expect('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:9', 'pause-resume');
expect(
  '403 refusal',
  'Server refused this automated download. Refresh the link in your browser or use a server that permits download managers.',
  'logins'
);
expect(
  '401 expired',
  'Download authorization expired. Refresh the link or recapture it from your signed-in browser.',
  'logins'
);
expect('404 not found', 'File not found on remote server.', 'logins');
expect('timeout', 'Server response timed out. Click Retry to reconnect.', 'pause-resume');
expect('ENOTFOUND (dns)', 'Server address not found. Please check internet connection.', 'pause-resume');
expect('connection dropped', 'Network connection dropped by server. Auto-reconnecting...', 'pause-resume');
expect(
  'protocol violation (other)',
  'Error: Protocol Violation: HTTP 200 during segmented request',
  'pause-resume'
);
expect('empty error', undefined, 'pause-resume');

if (fail > 0) {
  console.log(`${fail} mismatches`);
  process.exit(1);
}
console.log('ALL CLASSIFICATIONS OK');
process.exit(0);
