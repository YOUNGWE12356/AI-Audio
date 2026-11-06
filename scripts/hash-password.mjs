import { randomBytes, scryptSync } from 'node:crypto';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';

if (!process.stdin.isTTY) {
  console.error('Run this command in a terminal to enter a password without echoing it.');
  process.exit(1);
}
process.stderr.write('Password (at least 16 characters): ');
const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const input = createInterface({ input: process.stdin, output: hidden, terminal: true });
input.question('', password => {
  input.close(); process.stderr.write('\n');
  if (password.length < 16 || password.length > 1024) {
    console.error('Password must contain 16–1024 characters.'); process.exitCode = 1; return;
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  console.log(`scrypt$${salt.toString('hex')}$${hash.toString('hex')}`);
});
