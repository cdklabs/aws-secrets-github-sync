import { spawnSync, SpawnSyncOptionsWithBufferEncoding, SpawnSyncReturns } from 'child_process';
import * as readline from 'readline';
import * as aws from 'aws-sdk';
// reduce log pollution from SDK v3 upgrade messages
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PKG = require('../package.json');

/**
 * Options for retry mechanism.
 */
export interface RetryOptions {
  /**
   * Initial backoff time in milliseconds.
   */
  readonly initialBackoff: number;

  /**
   * Maximum backoff time in milliseconds.
   */
  readonly maxBackoff: number;

  /**
   * Backoff factor for exponential backoff.
   */
  readonly backoffFactor: number;

  /**
   * Maximum time to keep retrying in milliseconds.
   */
  readonly deadline: number;
}

/**
 * Default retry options.
 *
 * Based on GitHub API rate limit documentation:
 * - For secondary rate limits, wait at least 60 seconds (1 minute) before retrying
 * - Use exponential backoff for persistent rate limit issues
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  initialBackoff: 60_000, // 60 seconds (1 minute) as recommended by GitHub for secondary rate limits
  maxBackoff: 3_000_000, // 50 minutes maximum backoff
  backoffFactor: 2, // Exponential backoff factor
  deadline: 7_500_000, // 125 minutes default deadline
};

/**
 * Options for `getSecret`.
 */
export interface SecretOptions {
  /**
   * The AWS region to read the secret from.
   */
  readonly region?: string;
  /**
   * Credential profile to use.
   */
  readonly profile?: string;
}

export interface Clients {
  getSecret(secretId: string, options?: SecretOptions): Promise<Secret>;
  confirmPrompt(): Promise<boolean>;
  getRepositoryName(): Promise<string>;
  storeSecret(repository: string, key: string, value: string, environment?: string): Promise<void>;
  listSecrets(repository: string, environment?: string): Promise<string[]>;
  removeSecret(repository: string, key: string, environment?: string): Promise<void>;
  log(text?: string): void;
}

export const DEFAULTS: Clients = {
  getSecret,
  confirmPrompt,
  getRepositoryName,
  storeSecret,
  listSecrets,
  removeSecret,
  log,
};

function log(text: string = '') {
  console.error(text);
}

async function getRepositoryName(): Promise<string> {
  const result = await spawnWithRetry(['gh', 'repo', 'view', '--json', 'nameWithOwner']);
  const output = result.stdout;

  try {
    const repo = JSON.parse(output);
    return repo.nameWithOwner;
  } catch (e) {
    throw new Error(`Unable to determine repository name: ${output}`);
  }
}

async function storeSecret(repository: string, name: string, value: string, environment?: string): Promise<void> {
  const args = ['secret', 'set', '--repo', repository];
  if (environment) {
    args.push('--env', environment);
  }
  args.push(name);
  await spawnWithRetry(['gh', ...args], { input: value });
}

async function listSecrets(repository: string, environment?: string): Promise<string[]> {
  const args = ['secret', 'list', '--repo', repository];
  if (environment) {
    args.push('--env', environment);
  }
  const result = await spawnWithRetry(['gh', ...args]);
  const stdout = result.stdout.trim();
  if (!stdout) {
    return [];
  }
  return stdout.split('\n').map((line: string) => line.split('\t')[0]);
}

async function removeSecret(repository: string, key: string, environment?: string): Promise<void> {
  const args = ['secret', 'remove', '--repo', repository];
  if (environment) {
    args.push('--env', environment);
  }
  args.push(key);
  await spawnWithRetry(['gh', ...args]);
}

export async function spawnWithRetry(argv: string[], options: Omit<SpawnSyncOptionsWithBufferEncoding, 'stdio'> = {}, retryOptions?: RetryOptions) {
  return executeWithRetry(() => {
    const ret = spawnSync(argv[0], argv.slice(1), {
      ...(options.input ? { input: options.input } : {}),
      stdio: [
        options.input ? 'pipe' : 'ignore',
        'pipe',
        'pipe',
      ],
      encoding: 'utf-8',
    });

    // This is to retain compatiblity with behavior that was added in https://github.com/cdklabs/aws-secrets-github-sync/pull/1003,
    // where we made sure we print the output of the underlying tool.
    if (options.input) {
      process.stdout.write(ret.stdout);
    }
    process.stderr.write(ret.stderr);

    return ret;
  }, retryOptions);
}

/**
 * Execute a command with exponential backoff and retries.
 *
 * @param command Function that executes a command and returns the result
 * @param options Retry options
 * @returns The result of the command
 */
export async function executeWithRetry<T extends SpawnSyncReturns<string>>(
  command: () => T,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS,
): Promise<T> {
  const deadline = Date.now() + options.deadline;
  let sleepTime = options.initialBackoff;

  while (true) {
    try {
      const result = command();

      return assertSuccess(result);
    } catch (error) {
      if (error instanceof RetryableError && Date.now() < deadline) {
        // Sleep with jitter
        const backoff = Math.floor(Math.random() * sleepTime);
        sleepTime = Math.min(sleepTime * options.backoffFactor, options.maxBackoff);

        console.error(`Retryable error: ${error.message} (Retrying in ${Math.round(backoff / 1000)}s)`);
        await sleep(backoff);

        continue;
      }

      throw error;
    }
  }
}

function confirmPrompt(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(ok => {
    rl.question('Confirm (Y/N)? ', answer => {
      rl.close();
      if (answer.toUpperCase() === 'Y') {
        ok(true);
      } else {
        ok(false);
      }
    });
  });
}

async function getSecret(secretId: string, options: SecretOptions = {}): Promise<Secret> {
  const credentials = options.profile ? new aws.SharedIniFileCredentials({ profile: options.profile }) : undefined;
  const client = new aws.SecretsManager({
    region: options.region,
    credentials: credentials,
    customUserAgent: `${PKG.name}/${PKG.version}`,
  });

  const result = await client.getSecretValue({ SecretId: secretId }).promise();
  let json;
  try {
    json = JSON.parse(result.SecretString!);
  } catch (e) {
    throw new Error(`Secret "${secretId}" must be a JSON object`);
  }

  return {
    arn: result.ARN!,
    json: json,
  };
}

export interface Secret {
  readonly json: Record<string, string>;
  readonly arn: string;
}

/**
 * Throw an exception if a subprocess exited with an unsuccessful exit code
 */
function assertSuccess<A extends ReturnType<typeof spawnSync>>(x: A): A {
  if (x.stderr === undefined) {
    throw new Error('PRECONDITION FAILED! stderr is not being captured by the result of spawn');
  }

  if (x.error) {
    throw x.error;
  }
  if (x.signal) {
    throw new Error(`Process exited with signal ${x.signal}`);
  }
  if (x.status != null && x.status > 0) {
    if (x.stderr.includes('API rate limit exceeded')) {
      throw new RetryableError(`Process exited with code ${x.status}: ${String(x.stderr).trim()}`);
    }
    throw new Error(`Process exited with code ${x.status}: ${x.stderr}`);
  }
  return x;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


class RetryableError extends Error { }