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
  const output = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { stdio: ['ignore', 'pipe', 'inherit'] }).stdout.toString('utf-8');

  try {
    const repo = JSON.parse(output);
    return repo.nameWithOwner;
  } catch (e) {
    throw new Error(`Unable to determine repository name: ${output}`);
  }
}

function storeSecret(repository: string, name: string, value: string): void {
  const args = ['secret', 'set', '--repo', repository, name];
  spawnSync('gh', args, { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
}

function listSecrets(repository: string): string[] {
  const args = ['secret', 'list', '--repo', repository];
  const stdout = spawnSync('gh', args, { stdio: ['ignore', 'pipe', 'inherit'] }).stdout.toString('utf-8').trim();
  return stdout.split('\n').map(line => line.split('\t')[0]);
}

function removeSecret(repository: string, key: string): void {
  const args = ['secret', 'remove', '--repo', repository, key];
  spawnSync('gh', args, { stdio: ['ignore', 'inherit', 'inherit'] });
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