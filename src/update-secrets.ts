import * as clients from './clients';

/**
 * Options for `updateSecrets`.
 */
export interface UpdateSecretsOptions {
  /**
   * Clients.
   */
  readonly clients?: clients.Clients;

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
  const secretId = options.secret;
  const c = options.clients ?? clients.DEFAULTS;

  // if the secret id is an arn, extract the region from it
  let region = options.region;
  if (!region && secretId.startsWith('arn:')) {
    region = secretId.split(':')[3];
  }

  const repository: string = options.repository ?? c.getRepositoryName();
  const secret = await c.getSecret(options.secret, { region });

  // if `keys` is specified, make sure all the keys exist before
  // actually performing any updates.
  let keys = options.keys ?? [];
  if (keys.length > 0) {
    for (const requiredKey of keys) {
      if (!(requiredKey in secret.json)) {
        throw new Error(`Secret "${secretId}" does not contain key "${requiredKey}"`);
      }
    }
  } else {
    keys = Object.keys(secret.json);
  }

  c.log(`FROM: ${secret.arn}`);
  c.log(`REPO: ${repository}`);
  c.log(`KEYS: ${keys.join(',')}`);
  c.log();

  // ask user to confirm
  if (!await c.confirmPrompt()) {
    c.log('Cancelled by user');
    return;
  }

  for (const [key, value] of Object.entries(secret.json)) {
    if (keys.length > 0 && !keys.includes(key)) {
      continue; // skip if key is not in "keys"
    }

    c.storeSecret(repository, key, value);
  }
}
