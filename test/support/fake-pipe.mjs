// Preloaded with --import so the plugin runs its real code against the simulated Soundpad. A
// connection to Soundpad's pipe goes to SOUNDPAD_SIM_PATH instead, or fails as if Soundpad were
// closed when that is unset. Living here instead of behind a setting means the shipped plugin has
// no way to talk to anything but Soundpad's own pipe.
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const PIPE = '\\\\.\\pipe\\sp_remote_control';
const realCreateConnection = net.createConnection;

net.createConnection = (target, ...rest) => {
  if (target !== PIPE) return realCreateConnection(target, ...rest);
  const path = process.env.SOUNDPAD_SIM_PATH;
  if (path) return realCreateConnection(path, ...rest);
  const socket = new net.Socket();
  setImmediate(() => socket.emit('error', Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' })));
  return socket;
};
syncBuiltinESMExports();
