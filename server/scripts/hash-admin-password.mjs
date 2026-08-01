/* ========================================================================
   Generate an ADMIN_PASSWORD_HASH for .env
   ------------------------------------------------------------------------
   Usage:  node scripts/hash-admin-password.mjs

   Reads the password from a hidden prompt so it never lands in your shell
   history, hashes it with scrypt + a random salt, and prints the line to
   paste into .env. The plain password is never written to disk by this
   script — only the hash, and only by you, into a gitignored file.
   ======================================================================== */

import readline from 'node:readline';
import { hashPassword } from '../adminAuth.js';

const MIN_LENGTH = 12;
const isTTY = process.stdin.isTTY === true;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: isTTY,
});

/* Lines are queued as they arrive rather than pulled one-per-question.
   With piped input readline emits every line as fast as it can read them,
   so a second question() registered later would otherwise wait forever
   for input that has already been and gone. */
const pending = [];
const waiting = [];
let closed = false;

rl.on('line', (line) => {
  const next = waiting.shift();
  if (next) next(line);
  else pending.push(line);
});

rl.on('close', () => {
  closed = true;
  while (waiting.length) waiting.shift()(null);
});

/* Swallow echoed keystrokes while a password is typed, keeping the prompt
   visible. Only meaningful on a real terminal — piped input echoes
   nothing to hide. */
let muted = false;
if (isTTY && typeof rl._writeToOutput === 'function') {
  const realWrite = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (chunk) => {
    if (!muted) realWrite(chunk);
  };
}

function nextLine() {
  if (pending.length) return Promise.resolve(pending.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
}

async function askHidden(question) {
  process.stdout.write(question);
  muted = true;
  const answer = await nextLine();
  muted = false;
  if (isTTY) process.stdout.write('\n');
  return answer;
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  rl.close();
  process.exit(1);
}

console.log('');
console.log('  VERIDIC — admin password setup');
console.log('  ─────────────────────────────────────────────');
console.log('  This creates the hash for ADMIN_PASSWORD_HASH in .env.');
console.log('  Nothing is written to disk — copy the output yourself.');
console.log('');

const password = (await askHidden('  New admin password: ') ?? '').trim();
if (!password) fail('No password entered.');
if (password.length < MIN_LENGTH) fail(`Too short — use at least ${MIN_LENGTH} characters.`);

const confirm = (await askHidden('  Confirm password:   ') ?? '').trim();
if (!confirm) fail('Confirmation was not entered.');
if (password !== confirm) fail('The two entries did not match.');

rl.close();

const hash = hashPassword(password);

console.log('');
console.log('  ─────────────────────────────────────────────');
console.log('  Add this line to server/.env :');
console.log('');
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log('');
console.log('  Then restart the server and sign in at /admin.html');
console.log('');
console.log('  Deploying to Render? Add the SAME line as an environment');
console.log('  variable in the Render dashboard. Never commit .env to git.');
console.log('');
