import { loadConfig } from './config.js';
import { Application } from './app.js';
import { startServer } from './server.js';

try {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const config = loadConfig(configIndex >= 0 ? args[configIndex + 1] : undefined);
  const app = new Application(config, args.includes('--simulate'));
  const running = startServer(app);
  running.server.on('listening', () => {
    console.log(`Chat Knew · ${app.simulation ? 'SIMULATION · no external connections' : 'OFFLINE · adapters arrive in M2'}`);
    console.log(`Dashboard: http://127.0.0.1:${config.port}/dashboard?token=${running.token}`);
    console.log(`Overlay:   http://127.0.0.1:${config.port}/overlay?token=${running.token}`);
    console.log('Private pings are visual events only in M1. Press Ctrl+C to stop.');
  });
  running.server.on('error', (error) => { console.error(`Cannot start local server: ${error.message}`); running.close(); process.exitCode = 1; });
  process.on('SIGINT', () => running.close());
  process.on('SIGTERM', () => running.close());
} catch (error) {
  console.error(`Startup failed: ${error instanceof Error ? error.message : 'invalid configuration'}`);
  process.exitCode = 1;
}
