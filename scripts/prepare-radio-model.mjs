import 'dotenv/config';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const python =
  process.env.RADIO_PYTHON_PATH ||
  (process.platform === 'win32'
    ? '.venv-radio/Scripts/python.exe'
    : '.venv-radio/bin/python');
const model = process.argv[2] || process.env.RADIO_MODEL || 'tiny';
const child = spawn(
  resolve(python),
  ['scripts/prepare-radio-model.py', model],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
  },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
