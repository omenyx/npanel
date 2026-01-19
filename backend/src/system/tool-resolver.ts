import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { buildSafeExecEnv } from './exec-env';

export type ToolResolutionMethod = 'command_v' | 'which' | 'fallback';

export class ToolNotFoundError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly methods: ToolResolutionMethod[],
    public readonly packageHint?: string,
  ) {
    super(`Tool ${toolName} not found`);
    this.name = 'ToolNotFoundError';
  }
}

type ToolCacheEntry = {
  name: string;
  path: string;
  method: ToolResolutionMethod;
};

function isSafeToolName(name: string): boolean {
  return /^[a-zA-Z0-9._+-]+$/.test(name);
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildSafeExecEnv(),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

export class ToolResolver {
  private readonly cache = new Map<string, ToolCacheEntry>();

  async resolve(
    binaryName: string,
    options?: { refresh?: boolean; packageHint?: string },
  ): Promise<string> {
    const key = binaryName;
    const refresh = options?.refresh === true;
    if (!refresh) {
      const cached = this.cache.get(key);
      if (cached) {
        return cached.path;
      }
    }

    const methods: ToolResolutionMethod[] = [];

    if (binaryName.includes('/')) {
      const ok = await this.isExecutable(binaryName);
      methods.push('fallback');
      if (ok) {
        const entry: ToolCacheEntry = {
          name: binaryName,
          path: binaryName,
          method: 'fallback',
        };
        this.cache.set(key, entry);
        return entry.path;
      }
    }

    if (!binaryName.includes('/') && isSafeToolName(binaryName)) {
      methods.push('command_v');
      const commandV = await this.resolveViaCommandV(binaryName);
      if (commandV && (await this.isExecutable(commandV))) {
        const entry: ToolCacheEntry = {
          name: binaryName,
          path: commandV,
          method: 'command_v',
        };
        this.cache.set(key, entry);
        return entry.path;
      }

      methods.push('which');
      const whichPath = await this.resolveViaWhich(binaryName);
      if (whichPath && (await this.isExecutable(whichPath))) {
        const entry: ToolCacheEntry = {
          name: binaryName,
          path: whichPath,
          method: 'which',
        };
        this.cache.set(key, entry);
        return entry.path;
      }
    }

    methods.push('fallback');
    const fallbackDirs = [
      '/usr/sbin',
      '/usr/bin',
      '/sbin',
      '/bin',
      '/usr/local/sbin',
      '/usr/local/bin',
    ];
    for (const dir of fallbackDirs) {
      const candidate = `${dir}/${binaryName}`;
      if (await this.isExecutable(candidate)) {
        const entry: ToolCacheEntry = {
          name: binaryName,
          path: candidate,
          method: 'fallback',
        };
        this.cache.set(key, entry);
        return entry.path;
      }
    }

    throw new ToolNotFoundError(binaryName, methods, options?.packageHint);
  }

  async statusFor(
    binaryName: string,
    options?: { refresh?: boolean; packageHint?: string },
  ): Promise<{
    name: string;
    available: boolean;
    path?: string;
    method?: ToolResolutionMethod;
    error?: string;
    packageHint?: string;
    methodsTried?: ToolResolutionMethod[];
  }> {
    try {
      const path = await this.resolve(binaryName, options);
      const cached = this.cache.get(binaryName);
      return {
        name: binaryName,
        available: true,
        path,
        method: cached?.method,
      };
    } catch (err) {
      if (err instanceof ToolNotFoundError) {
        return {
          name: binaryName,
          available: false,
          error: err.message,
          packageHint: err.packageHint ?? this.defaultPackageHint(binaryName),
          methodsTried: err.methods,
        };
      }
      return {
        name: binaryName,
        available: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private async isExecutable(path: string): Promise<boolean> {
    try {
      await access(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveViaCommandV(binaryName: string): Promise<string | null> {
    const shell = process.env.SHELL || '/bin/sh';
    const result = await runCommand(shell, ['-lc', `command -v ${binaryName}`]);
    if (result.code !== 0) {
      return null;
    }
    const out = result.stdout.trim();
    if (!out) {
      return null;
    }
    const firstLine = out.split('\n')[0] ?? '';
    return firstLine.trim() || null;
  }

  private async resolveViaWhich(binaryName: string): Promise<string | null> {
    const result = await runCommand('which', [binaryName]);
    if (result.code !== 0) {
      return null;
    }
    const out = result.stdout.trim();
    if (!out) {
      return null;
    }
    const firstLine = out.split('\n')[0] ?? '';
    return firstLine.trim() || null;
  }

  private defaultPackageHint(binaryName: string): string | undefined {
    if (binaryName === 'rndc' || binaryName === 'named') {
      return 'bind or bind-utils package';
    }
    if (binaryName === 'pdnsutil') {
      return 'pdns-server and pdns-backend package';
    }
    if (binaryName === 'nginx') {
      return 'nginx package';
    }
    if (binaryName === 'php-fpm' || binaryName.startsWith('php-fpm')) {
      return 'php-fpm package';
    }
    if (binaryName === 'mysql' || binaryName === 'mysqladmin') {
      return 'mysql-server or mariadb-server package';
    }
    if (binaryName === 'quota' || binaryName === 'quotacheck') {
      return 'quota package';
    }
    if (
      binaryName === 'useradd' ||
      binaryName === 'usermod' ||
      binaryName === 'userdel'
    ) {
      return 'shadow-utils or passwd package';
    }
    return undefined;
  }
}
