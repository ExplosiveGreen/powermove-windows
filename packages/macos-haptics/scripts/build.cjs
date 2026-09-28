'use strict';

if (process.platform !== 'darwin') process.exit(0);

const { spawnSync } = require('node:child_process');

const result = spawnSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild'], {
  cwd: require('node:path').resolve(__dirname, '..'),
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
