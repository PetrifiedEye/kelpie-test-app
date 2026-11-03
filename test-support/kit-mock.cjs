const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

function startKitMock(kitDirectory) {
  const directory = mkdtempSync(join(tmpdir(), 'kelpie-mock-'));
  const statePath = join(directory, 'state.json');
  const moduleUrl = pathToFileURL(join(kitDirectory, 'mock-server.mjs')).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import { createMockServer } from ${JSON.stringify(moduleUrl)};
        const server = createMockServer({ statePath: ${JSON.stringify(statePath)} });
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          process.stdout.write(JSON.stringify({ port: address.port }) + '\\n');
        });
      `,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const stderr = [];
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`Mock server did not start.\n${stderr.join('')}`));
    }, 10000);

    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const line = buffer.split(/\r?\n/).find((entry) => entry.startsWith('{'));
      if (!line || settled) return;
      settled = true;
      clearTimeout(timer);
      const { port } = JSON.parse(line);
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        directory,
        async stop() {
          if (child.exitCode !== null || child.signalCode !== null) return;
          await new Promise((done) => {
            child.once('exit', () => done());
            child.kill();
          });
        },
      });
    });
    child.on('error', fail);
    child.on('exit', (code) => {
      if (!settled) fail(new Error(`Mock server exited with ${code}.\n${stderr.join('')}`));
    });
  });
}

module.exports = { startKitMock };
