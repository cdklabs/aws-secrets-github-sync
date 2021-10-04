import { spawnSync } from 'child_process';
import * as readline from 'readline';
import * as aws from 'aws-sdk';

export interface SecretOptions {
  readonly region?: string;
}

export interface Clients {
  getSecret(secretId: string, options?: SecretOptions): Promise<Secret>;
  confirmPrompt(): Promise<boolean>;
  getRepositoryName(): string;
  storeSecret(repository: string, key: string, value: string): void;
  log(text?: string): void;
}

export const DEFAULTS: Clients = {
  getSecret,
  confirmPrompt,
  getRepositoryName,
  storeSecret,
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
  const client = new aws.SecretsManager({ region: options.region });
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