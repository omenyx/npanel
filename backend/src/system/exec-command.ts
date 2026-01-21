import { spawn } from 'node:child_process';
import { buildSafeExecEnv } from './exec-env';

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

export function execCommand(
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<ExecResult> {
  const timeoutMs =
    typeof opts?.timeoutMs === 'number'
      ? opts.timeoutMs
      : Number.parseInt(process.env.NPANEL_CMD_TIMEOUT_MS || '', 10) || 60000;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildSafeExecEnv(),
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const finish = (res: ExecResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(res);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            const killed = child.kill('SIGKILL');
            if (!killed) {
              child.kill();
            }
            finish({
              code: 124,
              stdout,
              stderr:
                stderr.length > 0
                  ? `${stderr}\ncommand_timeout`
                  : 'command_timeout',
              timedOut: true,
            });
          }, timeoutMs)
        : setTimeout(() => undefined, 0);

    child.on('close', (code) => {
      finish({ code: code ?? -1, stdout, stderr });
    });
  });
}
