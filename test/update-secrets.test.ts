import * as child_process from 'child_process';
import { updateSecrets } from '../src';
import { Clients, spawnWithRetry } from '../src/clients';

jest.useFakeTimers();

const secretJson = {
  NPM_TOKEN: 'my-npm-token',
  PROJEN_GITHUB_TOKEN: 'bla-bla-bla',
  TWINE_USERNAME: 'my-twine-username',
  TWINE_PASSWORD: 'my-twine-password',
};

let mocks: Clients;

beforeEach(() => {
  jest.resetAllMocks();
  mocks = {
    getRepositoryName: jest.fn().mockResolvedValue('my-owner/my-repo'),
    getSecret: jest.fn().mockResolvedValue({ arn: 'secret-arn', json: secretJson, region: 'us-east-1' }),
    confirmPrompt: jest.fn().mockResolvedValue(true),
    storeSecret: jest.fn().mockResolvedValue(undefined),
    listSecrets: jest.fn().mockResolvedValue(['PROJEN_GITHUB_TOKEN', 'TWINE_USERNAME', 'ANOTHER_SECRET', 'BOOM_BAM']),
    removeSecret: jest.fn().mockResolvedValue(undefined),
    log: jest.fn(),
  };
});

test('fails if neither "allKeys" nor "keys" are specified', async () => {
  await expect(updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
  })).rejects.toThrow('Either `all` or `keys` must be set');
});

test('fails if keys is empty', async () => {
  await expect(updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: [],
  })).rejects.toThrow('No keys to update');
});

test('fails if there are no keys in the secret', async () => {
  await expect(updateSecrets({
    clients: {
      ...mocks,
      getSecret: jest.fn().mockResolvedValue({ arn: 'secret-arn', json: {}, region: 'us-east-1' }),
    },
    secret: 'my-secret-name',
    allKeys: true,
  })).rejects.toThrow('No keys to update');
});

test('fails if both "allKeys" and "keys" are specified', async () => {
  await expect(updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    keys: ['key1', 'key2'],
  })).rejects.toThrow('Cannot set both `all` and `keys`');
});

test('"allKeys" will update all secrets', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
  });

  expect(mocks.getSecret).toHaveBeenCalledWith('my-secret-name', { region: undefined });
  expect(mocks.confirmPrompt).toHaveBeenCalledTimes(1);
  expect(mocks.storeSecret).toHaveBeenCalledTimes(Object.keys(secretJson).length);
  for (const [key, secret] of Object.entries(secretJson)) {
    expect(mocks.storeSecret).toHaveBeenCalledWith('my-owner/my-repo', key, secret, undefined);
  }
  expect(mocks.listSecrets).toHaveBeenCalled();
  expect(mocks.removeSecret).not.toHaveBeenCalled();
});

test('"allKeys" is okay with an empty "keys"', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    keys: [],
  });

  expect(mocks.storeSecret).toHaveBeenCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toHaveBeenCalled();
  expect(mocks.removeSecret).not.toHaveBeenCalled();
});

test('region extracted from arn', async () => {
  const arn = 'arn:aws:secretsmanager:us-east-1:8899778877:secret:publishing-secrets-99999';

  await updateSecrets({
    clients: mocks,
    secret: arn,
    allKeys: true,
  });

  expect(mocks.getSecret).toHaveBeenCalledWith(arn, { region: 'us-east-1' });
  expect(mocks.listSecrets).toHaveBeenCalled();
  expect(mocks.removeSecret).not.toHaveBeenCalled();
});

test('"keys" can be used to specify which keys to store', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME'],
  });

  expect(mocks.storeSecret).toHaveBeenCalledTimes(2);
  expect(mocks.storeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'NPM_TOKEN', 'my-npm-token', undefined);
  expect(mocks.storeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'TWINE_USERNAME', 'my-twine-username', undefined);
  expect(mocks.listSecrets).toHaveBeenCalled();
  expect(mocks.removeSecret).not.toHaveBeenCalled();
});

test('fails if one of the keys does not exist in the secret', async () => {
  await expect(updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME', 'NOT_FOUND'],
  })).rejects.toThrow('Secret "my-secret-name" does not contain key "NOT_FOUND"');
});

test('stops if user did not confirm', async () => {
  mocks.confirmPrompt = jest.fn().mockResolvedValue(false);

  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME'],
  });

  expect(mocks.storeSecret).not.toHaveBeenCalled();
  expect(mocks.removeSecret).not.toHaveBeenCalled();
});

test('explicit repository name can be specified', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME'],
    repository: 'foo/bar',
  });

  expect(mocks.storeSecret).toHaveBeenCalledTimes(2);
  expect(mocks.storeSecret).toHaveBeenCalledWith('foo/bar', 'NPM_TOKEN', 'my-npm-token', undefined);
  expect(mocks.storeSecret).toHaveBeenCalledWith('foo/bar', 'TWINE_USERNAME', 'my-twine-username', undefined);
  expect(mocks.listSecrets).toHaveBeenCalled();
  expect(mocks.removeSecret).not.toHaveBeenCalled();
});

test('useful error if secret is not an object', async () => {
  await expect(updateSecrets({
    clients: {
      ...mocks,
      getSecret: jest.fn().mockResolvedValue({ arn: 'secret-arn', json: 'not-json', region: 'us-east-1' }),
    },
    secret: 'my-secret-name',
    allKeys: true,
  })).rejects.toThrow('Secret "secret-arn" is not an object');
});

test('confirm: false can disable interactive confirmation', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    confirm: false,
  });

  expect(mocks.confirmPrompt).not.toHaveBeenCalled();
  expect(mocks.storeSecret).toHaveBeenCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toHaveBeenCalled();
  expect(mocks.removeSecret).not.toHaveBeenCalled();
});

test('prune will remove keys', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    prune: true,
  });

  expect(mocks.storeSecret).toHaveBeenCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toHaveBeenCalledWith('my-owner/my-repo', undefined);
  expect(mocks.removeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'ANOTHER_SECRET', undefined);
  expect(mocks.removeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'BOOM_BAM', undefined);
});

test('update secrets accepts a profile', async () => {
  await updateSecrets({
    clients: mocks,
    allKeys: true,
    secret: 'my-secret-name',
    profile: 'my-profile',
  });

  expect(mocks.getSecret).toHaveBeenCalledWith('my-secret-name', { profile: 'my-profile' });
});

test('"keep" can be used to retain keys depite prune', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    prune: true,
    keep: ['BOOM_BAM', 'LALALALA'],
  });

  expect(mocks.storeSecret).toHaveBeenCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toHaveBeenCalledWith('my-owner/my-repo', undefined);
  expect(mocks.removeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'ANOTHER_SECRET', undefined);
  expect(mocks.removeSecret).not.toHaveBeenCalledWith('my-owner/my-repo', 'BOOM_BAM', undefined);
});

test('environment secrets: stores secrets to specified environment', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME'],
    environment: 'production',
  });

  expect(mocks.storeSecret).toHaveBeenCalledTimes(2);
  expect(mocks.storeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'NPM_TOKEN', 'my-npm-token', 'production');
  expect(mocks.storeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'TWINE_USERNAME', 'my-twine-username', 'production');
  expect(mocks.listSecrets).toHaveBeenCalledWith('my-owner/my-repo', 'production');
});

test('environment secrets: prunes environment secrets correctly', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    prune: true,
    environment: 'staging',
  });

  expect(mocks.storeSecret).toHaveBeenCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toHaveBeenCalledWith('my-owner/my-repo', 'staging');
  expect(mocks.removeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'ANOTHER_SECRET', 'staging');
  expect(mocks.removeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'BOOM_BAM', 'staging');
});

test('environment secrets: keep works with environment secrets', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    prune: true,
    keep: ['BOOM_BAM'],
    environment: 'development',
  });

  expect(mocks.storeSecret).toHaveBeenCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toHaveBeenCalledWith('my-owner/my-repo', 'development');
  expect(mocks.removeSecret).toHaveBeenCalledWith('my-owner/my-repo', 'ANOTHER_SECRET', 'development');
  expect(mocks.removeSecret).not.toHaveBeenCalledWith('my-owner/my-repo', 'BOOM_BAM', 'development');
});

test('environment secrets: works with custom repository', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN'],
    repository: 'custom/repo',
    environment: 'test',
  });

  expect(mocks.storeSecret).toHaveBeenCalledWith('custom/repo', 'NPM_TOKEN', 'my-npm-token', 'test');
  expect(mocks.listSecrets).toHaveBeenCalledWith('custom/repo', 'test');
});

// Tests for the retry functionality
jest.mock('child_process', () => {
  const originalModule = jest.requireActual('child_process');

  return {
    ...originalModule,
    spawnSync: jest.fn(),
    execSync: jest.fn(),
  };
});

describe('spawnWithRetry stdio', () => {
  let spawnSyncMock: jest.SpyInstance<any>;
  beforeEach(() => {
    // Mock child_process.spawnSync to capture how it's called
    spawnSyncMock = jest.spyOn(child_process, 'spawnSync').mockImplementation(() => {
      return successExit();
    });
  });
  test('stdin=pipe when input is provided', async () => {
    await spawnWithRetry(['gh', 'command'], { input: 'test-input' });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'gh',
      ['command'],
      expect.objectContaining({
        stdio: ['pipe', expect.anything(), expect.anything()],
        encoding: 'utf-8',
      }),
    );
  });

  test('stdin=ignore when no input is provided', async () => {
    await spawnWithRetry(['gh', 'command']);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'gh',
      ['command'],
      expect.objectContaining({
        stdio: ['ignore', expect.anything(), expect.anything()],
        encoding: 'utf-8',
      }),
    );
  });
});

describe('GitHub API retry functionality', () => {
  const mockSpawnSync = jest.spyOn(child_process, 'spawnSync');

  beforeEach(() => {
    // Mock console.error to prevent test output pollution
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('spawn is called capturing stderr, so we can read any error messages', async () => {
    mockSpawnSync
      .mockReturnValueOnce(successExit());

    // Execute a command with retry
    await runFakeTimers(spawnWithRetry(['gh', 'api', 'test']));

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'gh',
      ['api', 'test'],
      expect.objectContaining({
        stdio: [expect.anything(), expect.anything(), 'pipe'],
        encoding: 'utf-8',
      }),
    );
  });

  test('executeWithRetry should retry on failure', async () => {
    // Mock spawnSync to fail twice and then succeed
    mockSpawnSync
      .mockReturnValueOnce(errorExit('API rate limit exceeded'))
      .mockReturnValueOnce(errorExit('API rate limit exceeded'))
      .mockReturnValueOnce(successExit());

    // Execute a command with retry
    const result = await runFakeTimers(spawnWithRetry(['gh', 'api', 'test']));

    // Verify the command was called 3 times (2 failures + 1 success)
    expect(mockSpawnSync).toHaveBeenCalledTimes(3);
    expect(result.stdout.toString()).toBe('Success');
  });

  describe('with an eternally failing call', () => {
    beforeEach(() => {
      // Mock spawnSync to always fail
      mockSpawnSync.mockReturnValue(errorExit('API rate limit exceeded'));
    });

    test('executeWithRetry eventually fails', async () => {
      // Execute a command with retry and expect it to throw
      await runFakeTimers(expect(spawnWithRetry(['gh', 'api', 'test'])).rejects.toThrow(/API rate limit exceeded/)); // rejects.toThrow(/API rate limit exceeded/);
    });

    test('executeWithRetry does not fail before the deadline', async () => {
      const eventuallyFailingCall = spawnWithRetry(['gh', 'api', 'test']);
      const deadline = new Promise((resolve) => setTimeout(() => resolve('deadline reached'), 7_000_000)); // Slightly less than 2 hours

      // When we race these promises, the deadline will always win.
      await expect(
        runFakeTimers(Promise.race([eventuallyFailingCall, deadline])),
      ).resolves.toEqual('deadline reached');
    });
  });

  test('executeWithRetry only retries on throttles', async () => {
    // Mock spawnSync to fail with a non-rate-limit error and then succeed
    mockSpawnSync
      .mockReturnValueOnce(errorExit('Some other error'))
      .mockReturnValueOnce(successExit());

    await runFakeTimers(expect(spawnWithRetry(['gh', 'api', 'test'])).rejects.toThrow(/Some other error/));
  });
});

/**
 * Run the timers, then return the promise so you can chain these calls.
 *
 * To test for a rejection, put the `runFakeTimers` around the `expect`, not around
 * the promise going into `expect` (the `catch` needs to be attached to the promise
 * before the timers are run).
 */
async function runFakeTimers<T>(promise: Promise<T>): Promise<T> {
  await jest.runAllTimersAsync();
  return promise;
}

function errorExit(message: string) {
  return {
    status: 1,
    stderr: Buffer.from(message),
    stdout: Buffer.from(''),
    pid: 123,
    output: [],
    signal: null,
  };
}

function successExit() {
  return {
    status: 0,
    stderr: Buffer.from(''),
    stdout: Buffer.from('Success'),
    pid: 123,
    output: [],
    signal: null,
  };
}
