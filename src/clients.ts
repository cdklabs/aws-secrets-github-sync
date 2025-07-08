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
   */
  readonly maxRetries: number;

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
}

/**
 * Default retry options.
 *
 * Based on GitHub API rate limit documentation:
 * - For secondary rate limits, wait at least 60 seconds (1 minute) before retrying
 * - Use exponential backoff for persistent rate limit issues
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
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
  getRepositoryName(): string;
  storeSecret(repository: string, key: string, value: string): void;
  listSecrets(repository: string): string[];
  removeSecret(repository: string, key: string): void;
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

function getRepositoryName(): string {
  const result = executeWithRetry(() => spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { stdio: ['ignore', 'pipe', 'inherit'] }));
  const output = result.stdout.toString('utf-8');

  try {
    const repo = JSON.parse(output);
    return repo.nameWithOwner;
  } catch (e) {
    throw new Error(`Unable to determine repository name: ${output}`);
  }
}

function storeSecret(repository: string, name: string, value: string): void {
  const args = ['secret', 'set', '--repo', repository, name];
  executeWithRetry(() => spawnSync('gh', args, { input: value, stdio: ['pipe', 'inherit', 'inherit'] }));
}

function listSecrets(repository: string): string[] {
  const args = ['secret', 'list', '--repo', repository];
  const result = executeWithRetry(() => spawnSync('gh', args, { stdio: ['ignore', 'pipe', 'inherit'] }));
  const stdout = result.stdout.toString('utf-8').trim();
  if (!stdout) {
    return [];
  }
  return stdout.split('\n').map(line => line.split('\t')[0]);
}

function removeSecret(repository: string, key: string): void {
  const args = ['secret', 'remove', '--repo', repository, key];
  executeWithRetry(() => spawnSync('gh', args, { stdio: ['ignore', 'inherit', 'inherit'] }));
}

/**
 * Execute a command with exponential backoff and retries.
 *
 * @param command Function that executes a command and returns the result
 * @param options Retry options
 * @returns The result of the command
 */
function executeWithRetry<T extends SpawnSyncReturns<Buffer>>(
  command: () => T,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS,
): T {
  const retryOpts = options;

  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= retryOpts.maxRetries) {
    try {
      const result = command();
      return assertSuccess(result);
    } catch (error) {
      lastError = error as Error;
      attempt++;

      // If we've exhausted all retries, throw the last error
      if (attempt > retryOpts.maxRetries) {
        throw lastError;
      }

      // Calculate backoff time with exponential increase
      const backoffTime = Math.min(
        retryOpts.initialBackoff * Math.pow(retryOpts.backoffFactor, attempt - 1),
        retryOpts.maxBackoff,
      );

      // Log retry attempt
      console.error(`GitHub API request failed (attempt ${attempt}/${retryOpts.maxRetries}). Retrying in ${Math.round(backoffTime / 1000)}s...`);
      console.error(`Error: ${lastError.message}`);

      // Wait for backoff time before retrying
      const startTime = Date.now();
      while (Date.now() - startTime < backoffTime) {
        // Busy wait to avoid using setTimeout which would require async/await
      }
    }
  }

  // This should never be reached due to the throw in the loop, but TypeScript needs it
  throw new Error('Unexpected error in retry logic');
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
    // Check for GitHub API rate limit error - use the original error message
    if (x.stdout) {
      const output = x.stdout.toString('utf-8');
      if (output.includes('API rate limit exceeded')) {
        throw new Error(output.trim());
      }
    }
    throw new Error(`Process exited with code ${x.status}`);
  }
  return x;
}
