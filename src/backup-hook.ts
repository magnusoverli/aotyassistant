import { connect } from 'node:net';
import { backupSocket } from './backup.js';

const command = process.argv[2];
if (command !== 'freeze' && command !== 'thaw') {
  console.error('Expected freeze or thaw.'); process.exitCode = 1;
} else {
  const socket = connect(backupSocket); let reply = '';
  const fail = () => { console.error('Backup coordination failed. Wait for active uploads to finish and retry; restart the app if a failed backup left writes paused.'); process.exitCode = 1; socket.destroy(); };
  socket.setTimeout(20_000, fail);
  socket.on('error', fail);
  socket.once('connect', () => socket.write(`${command}\n`));
  socket.on('data', chunk => { reply += chunk.toString(); if (reply.length > 32) fail(); });
  socket.once('end', () => { if (reply !== 'ok\n') fail(); });
}
