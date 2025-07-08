import { spawnSync, SpawnSyncReturns } from 'child_process';
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
   * Maximum number of retry attempts.
   * @default 5
   */
  readonly maxRetries?: number;

  /**
   * Initial backoff time in milliseconds.
   * @default 60000 (60 seconds)
   */
  readonly initialBackoff?: number;

  /**
   * Maximum backoff time in milliseconds.
   * @default 600000 (10 minutes)
   */
  readonly maxBackoff?: number;

  /**
   * Backoff factor for exponential backoff.
   * @default 2
   */
  readonly backoffFactor?: number;

  /**
   * Maximum time to keep retrying in milliseconds.
   * If specified, this takes precedence over maxRetries.
   * @default undefined (use maxRetries instead)
   */
  readonly deadline?: number | undefined;
}

/**
 * Default retry options.
 *
 * Based on GitHub API rate limit documentation:
 * - For secondary rate limits, wait at least 60 seconds (1 minute) before retrying
 * - Use exponential backoff for persistent rate limit issues
 */
const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 5,
  initialBackoff: 60_000, // 60 seconds (1 minute) as recommended by GitHub for secondary rate limits
  maxBackoff: 6_000_000, // 100 minutes maximum backoff
  backoffFactor: 3, // Exponential backoff factor
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
  storeSecret(repository: string, key: string, value: string): Promise<void>;
  listSecrets(repository: string): Promise<string[]>;
  removeSecret(repository: string, key: string): Promise<void>;
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
  const result = await executeWithRetry(() => spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { stdio: ['ignore', 'pipe', 'inherit'] }));
  const output = result.stdout.toString('utf-8');

  try {
    const repo = JSON.parse(output);
    return repo.nameWithOwner;
  } catch (e) {
    throw new Error(`Unable to determine repository name: ${output}`);
  }
}

async function storeSecret(repository: string, name: string, value: string): Promise<void> {
  const args = ['secret', 'set', '--repo', repository, name];
  await executeWithRetry(() => spawnSync('gh', args, { input: value, stdio: ['pipe', 'inherit', 'inherit'] }));
}

async function listSecrets(repository: string): Promise<string[]> {
  const args = ['secret', 'list', '--repo', repository];
  const result = await executeWithRetry(() => spawnSync('gh', args, { stdio: ['ignore', 'pipe', 'inherit'] }));
  const stdout = result.stdout.toString('utf-8').trim();
  if (!stdout) {
    return [];
  }
  return stdout.split('\n').map((line: string) => line.split('\t')[0]);
}

async function removeSecret(repository: string, key: string): Promise<void> {
  const args = ['secret', 'remove', '--repo', repository, key];
  await executeWithRetry(() => spawnSync('gh', args, { stdio: ['ignore', 'inherit', 'inherit'] }));
}

/**
 * Execute a command with exponential backoff and retries.
 *
 * @param command Function that executes a command and returns the result
 * @param options Retry options
 * @returns The result of the command
 */
export async function executeWithRetry<T extends SpawnSyncReturns<Buffer>>(
  command: () => T,
  options: RetryOptions = {},
): Promise<T> {
  const retryOpts = {
    maxRetries: options.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
    initialBackoff: options.initialBackoff ?? DEFAULT_RETRY_OPTIONS.initialBackoff,
    maxBackoff: options.maxBackoff ?? DEFAULT_RETRY_OPTIONS.maxBackoff,
    backoffFactor: options.backoffFactor ?? DEFAULT_RETRY_OPTIONS.backoffFactor,
    deadline: options.deadline,
  };

  let lastError: Error | undefined;
  let attempt = 0;
  const startTime = Date.now();

  // Continue until we reach max retries or deadline
  while (true) {
    try {
      const result = command();
      return assertSuccess(result);
    } catch (error) {
      lastError = error as Error;
      attempt++;

      // Check if we've reached the deadline
      if (retryOpts.deadline && Date.now() - startTime >= retryOpts.deadline) {
        console.error(`GitHub API request failed: deadline of ${retryOpts.deadline}ms reached after ${attempt} attempts`);
        throw lastError;
      }

      // Check if we've exhausted all retries
      if (!retryOpts.deadline && attempt > retryOpts.maxRetries) {
        throw lastError;
      }

      // Calculate backoff time with exponential increase
      const backoffTime = Math.min(
        retryOpts.initialBackoff * Math.pow(retryOpts.backoffFactor, attempt - 1),
        retryOpts.maxBackoff,
      );

      // Log retry attempt
      if (retryOpts.deadline) {
        const timeLeft = retryOpts.deadline - (Date.now() - startTime);
        console.error(`Command failed (attempt ${attempt}, ${Math.round(timeLeft / 1000)}s left). Retrying in ${Math.round(backoffTime / 1000)}s...`);
      } else {
        console.error(`Command failed (attempt ${attempt}/${retryOpts.maxRetries}). Retrying in ${Math.round(backoffTime / 1000)}s...`);
      }
      console.error(`Error: ${lastError.message}`);

      // Wait for backoff time before retrying
      await new Promise(resolve => setTimeout(resolve, backoffTime));
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
  if (x.error) {
    throw x.error;
  }
  if (x.signal) {
    throw new Error(`Process exited with signal ${x.signal}`);
  }
  if (x.status != null && x.status > 0) {
    throw new Error(`Process exited with code ${x.status}`);
  }
  return x;
}
