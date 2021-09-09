import { spawnSync } from 'child_process';
import * as readline from 'readline';
import * as aws from 'aws-sdk';

/**
 * Options for `updateSecrets`.
 */
export interface UpdateSecretsOptions {
  /**
   * The name/id/arn of the SecretsManager secret to use.
   */
  readonly secret: string;

  /**
   * AWS region to query,.
   * @default - default region (e.g. set by `AWS_REGION`).
   */
  readonly region?: string;

  /**
   * The full name of the github repository.
   * @default - the current repository
   */
  readonly repository?: string;


  /**
   * Only update the specified keys
   * @default [] Updates all the keys
   */
  readonly keys?: string[];
}

/**
 * Updates the secrets in the current repository from the given AWS SecretsManager secret.
 * @param options Options
 */
export async function updateSecrets(options: UpdateSecretsOptions) {
  // if the secret id is an arn, extract the region from it
  let region = options.region;
  if (!region && options.secret.startsWith('arn:')) {
    region = options.secret.split(':')[3];
  }

  const sm = new aws.SecretsManager({ region });
  let keys = options.keys ?? [];

  const describeResult = await sm.describeSecret({ SecretId: options.secret }).promise();
  const secretArn = describeResult.ARN!;

  const repository: string = (() => {
    if (options.repository) {
      return options.repository;
    }

    const repo = JSON.parse((spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'])).stdout);
    return repo.nameWithOwner;
  })();

  const secretValue = await sm.getSecretValue({ SecretId: options.secret }).promise();
  if (!secretValue.SecretString) {
    throw new Error('no response from secrets manager');
  }

  const secrets: Record<string, string> = JSON.parse(secretValue.SecretString);

  // if `keys` is specified, make sure all the keys exist before
  // actually performing any updates.
  if (keys.length > 0) {
    for (const requiredKey of keys) {
      if (!(requiredKey in secrets)) {
        throw new Error(`Cannot find key ${requiredKey} in ${secretArn}`);
      }
    }
  } else {
    keys = Object.keys(secrets);
  }

  console.error(`FROM: ${secretArn}`);
  console.error(`REPO: ${repository}`);
  console.error(`KEYS: ${keys.join(',')}`);
  console.error();

  // ask user to confirm
  if (!await confirmPrompt()) {
    console.error('Cancelled by user');
    return;
  }

  for (const [key, value] of Object.entries(secrets)) {
    if (keys.length > 0 && !keys.includes(key)) {
      continue; // skip if key is not in "keys"
    }

    const args = ['secret', 'set', '--repo', repository, key];
    spawnSync('gh', args, { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  }
}

async function confirmPrompt(): Promise<boolean> {
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