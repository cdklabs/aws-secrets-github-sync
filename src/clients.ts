import { spawnSync } from 'child_process';
import * as readline from 'readline';
import * as aws from 'aws-sdk';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PKG = require('../package.json');

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
  const spawn = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = spawn.stderr?.toString();
  if (stderr) {
    throw new Error(`Failed to get repository name: ${stderr}`);
  }
  const output = spawn.stdout.toString('utf-8');
  try {
    const repo = JSON.parse(output);
    return repo.nameWithOwner;
  } catch (e) {
    throw new Error(`Unable to determine repository name: ${output}`);
  }
}

function storeSecret(repository: string, name: string, value: string): void {
  const args = ['secret', 'set', '--repo', repository, name];
  const spawn = spawnSync('gh', args, { input: value, stdio: ['pipe', 'inherit', 'pipe'] });
  const stderr = spawn.stderr?.toString();
  if (stderr) {
    throw new Error(`Failed to store secret '${name}' in repository '${repository}': ${stderr}`);
  }
}

function listSecrets(repository: string): string[] {
  const args = ['secret', 'list', '--repo', repository];
  const spawn = spawnSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = spawn.stderr?.toString();
  if (stderr) {
    throw new Error(`Failed to list secrets in repository '${repository}': ${stderr}`);
  }
  return spawn.stdout.toString('utf-8').trim().split('\n').map(line => line.split('\t')[0]);
}

function removeSecret(repository: string, key: string): void {
  const args = ['secret', 'remove', '--repo', repository, key];
  const spawn = spawnSync('gh', args, { stdio: ['ignore', 'inherit', 'pipe'] });
  const stderr = spawn.stderr?.toString();
  if (stderr) {
    throw new Error(`Failed to remove secret '${key}' from repository '${repository}': ${stderr}`);
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

  let result;
  try {
    result = await client.getSecretValue({ SecretId: secretId }).promise();
  } catch (error) {
    throw new Error(`Failed to retrieve secret '${secretId}' from SecretsManager: ${error}`);
  }

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
