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
   * AWS region to query.
   * @default - default region (e.g. set by `AWS_REGION`).
   */
  readonly region?: string;

  /**
   * Use a profile in the shared credentials file.
   * @default - default credential resolution
   */
  readonly profile?: string;

  /**
   * The full name of the github repository.
   * @default - the current repository
   */
  readonly repository?: string;

  /**
   * The secret keys to update. To update all keys, set `all` to `true` and leave `keys` empty.
   *
   * @example `['GITHUB_TOKEN', 'GITHUB_TOKEN_SECRET']`
   * @default []
   */
  readonly keys?: string[];

  /**
   * Update all keys. If this is set to `true`, `keys` will be ignored.
   * @default false
   */
  readonly allKeys?: boolean;

  /**
   * Display a confirmation prompt before updating the secrets.
   * @default true
   */
  readonly confirm?: boolean;

  /**
   * Delete any secrets from the repository that don't correspond to secret keys
   * in the updated secret. This effectively makes sure that the repo only includes
   * secrets that come from AWS Secrets Manager.
   * @default false
   */
  readonly prune?: boolean;
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
  const secret = await c.getSecret(options.secret, { region, profile: options.profile });
  const keys = options.keys ?? [];
  const prune = options.prune ?? false;

  if (typeof(secret.json) !== 'object') {
    throw new Error(`Secret "${secret.arn}" is not an object`);
  }

  if (options.allKeys === undefined && options.keys === undefined) {
    throw new Error('Either `all` or `keys` must be set');
  }

  if (options.allKeys) {
    if (keys.length > 0) {
      throw new Error('Cannot set both `all` and `keys`');
    }

    // remove "*" and replace with all the keys from the secret
    keys.push(...Object.keys(secret.json));
  }

  if (keys.length === 0) {
    throw new Error('No keys to update');
  }

  // verify that all the keys exist in the secret
  for (const requiredKey of keys) {
    if (!(requiredKey in secret.json)) {
      throw new Error(`Secret "${secretId}" does not contain key "${requiredKey}"`);
    }
  }

  // find all the secrets in the repo that don't correspond to keys in the secret
  const existingKeys = c.listSecrets(repository);
  const oldKeys = existingKeys.filter(key => !keys.includes(key));

  c.log(`FROM  : ${secret.arn}`);
  c.log(`REPO  : ${repository}`);
  c.log(`UDPATE: ${keys.join(',')}`);

  if (oldKeys.length > 0) {
    if (prune) {
      c.log(`REMOVE: ${oldKeys.join(',')}`);
    } else {
      c.log(`SKIP  : ${oldKeys.join(',')} (use --prune to remove)`);
    }
  }

  c.log();

  // ask user to confirm
  const confirm = options.confirm ?? true;
  if (confirm && !await c.confirmPrompt()) {
    c.log('Cancelled by user');
    return;
  }

  for (const [key, value] of Object.entries(secret.json)) {
    if (keys.length > 0 && !keys.includes(key)) {
      continue; // skip if key is not in "keys"
    }

    c.storeSecret(repository, key, value);
  }

  // prune keys that are not in the secret
  if (prune) {
    for (const key of oldKeys) {
      c.removeSecret(repository, key);
    }
  }
}
