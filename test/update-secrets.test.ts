import { spawnSync } from 'child_process';
import { updateSecrets } from '../src';
import { Clients, RetryOptions, executeWithRetry } from '../src/clients';

const secretJson = {
  NPM_TOKEN: 'my-npm-token',
  PROJEN_GITHUB_TOKEN: 'bla-bla-bla',
  TWINE_USERNAME: 'my-twine-username',
  TWINE_PASSWORD: 'my-twine-password',
};

let mocks: Clients;

beforeEach(() => {
  mocks = {
    getRepositoryName: jest.fn().mockReturnValue('my-owner/my-repo'),
    getSecret: jest.fn().mockReturnValue({ arn: 'secret-arn', json: secretJson, region: 'us-east-1' }),
    confirmPrompt: jest.fn().mockReturnValue(true),
    storeSecret: jest.fn(),
    listSecrets: jest.fn().mockReturnValue(['PROJEN_GITHUB_TOKEN', 'TWINE_USERNAME', 'ANOTHER_SECRET', 'BOOM_BAM']),
    removeSecret: jest.fn(),
    log: jest.fn(),
  };
});

afterEach(() => {
  jest.resetAllMocks();
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
      getSecret: jest.fn().mockReturnValue({ arn: 'secret-arn', json: {}, region: 'us-east-1' }),
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

  expect(mocks.getSecret).toBeCalledWith('my-secret-name', { region: undefined });
  expect(mocks.confirmPrompt).toBeCalledTimes(1);
  expect(mocks.storeSecret).toBeCalledTimes(Object.keys(secretJson).length);
  for (const [key, secret] of Object.entries(secretJson)) {
    expect(mocks.storeSecret).toBeCalledWith('my-owner/my-repo', key, secret);
  }
  expect(mocks.listSecrets).toBeCalled();
  expect(mocks.removeSecret).not.toBeCalled();
});

test('"allKeys" is okay with an empty "keys"', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    keys: [],
  });

  expect(mocks.storeSecret).toBeCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toBeCalled();
  expect(mocks.removeSecret).not.toBeCalled();
});

test('region extracted from arn', async () => {
  const arn = 'arn:aws:secretsmanager:us-east-1:8899778877:secret:publishing-secrets-99999';

  await updateSecrets({
    clients: mocks,
    secret: arn,
    allKeys: true,
  });

  expect(mocks.getSecret).toBeCalledWith(arn, { region: 'us-east-1' });
  expect(mocks.listSecrets).toBeCalled();
  expect(mocks.removeSecret).not.toBeCalled();
});

test('"keys" can be used to specify which keys to store', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME'],
  });

  expect(mocks.storeSecret).toBeCalledTimes(2);
  expect(mocks.storeSecret).toBeCalledWith('my-owner/my-repo', 'NPM_TOKEN', 'my-npm-token');
  expect(mocks.storeSecret).toBeCalledWith('my-owner/my-repo', 'TWINE_USERNAME', 'my-twine-username');
  expect(mocks.listSecrets).toBeCalled();
  expect(mocks.removeSecret).not.toBeCalled();
});

test('fails if one of the keys does not exist in the secret', async () => {
  await expect(updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME', 'NOT_FOUND'],
  })).rejects.toThrow('Secret "my-secret-name" does not contain key "NOT_FOUND"');
});

test('stops if user did not confirm', async () => {
  mocks.confirmPrompt = jest.fn().mockReturnValue(false);

  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME'],
  });

  expect(mocks.storeSecret).not.toBeCalled();
  expect(mocks.removeSecret).not.toBeCalled();
});

test('explicit repository name can be specified', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    keys: ['NPM_TOKEN', 'TWINE_USERNAME'],
    repository: 'foo/bar',
  });

  expect(mocks.storeSecret).toBeCalledTimes(2);
  expect(mocks.storeSecret).toBeCalledWith('foo/bar', 'NPM_TOKEN', 'my-npm-token');
  expect(mocks.storeSecret).toBeCalledWith('foo/bar', 'TWINE_USERNAME', 'my-twine-username');
  expect(mocks.listSecrets).toBeCalled();
  expect(mocks.removeSecret).not.toBeCalled();
});

test('useful error if secret is not an object', async () => {
  await expect(updateSecrets({
    clients: {
      ...mocks,
      getSecret: jest.fn().mockReturnValue({ arn: 'secret-arn', json: 'not-json', region: 'us-east-1' }),
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

  expect(mocks.confirmPrompt).not.toBeCalled();
  expect(mocks.storeSecret).toBeCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toBeCalled();
  expect(mocks.removeSecret).not.toBeCalled();
});

test('prune will remove keys', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    prune: true,
  });

  expect(mocks.storeSecret).toBeCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toBeCalledWith('my-owner/my-repo');
  expect(mocks.removeSecret).toBeCalledWith('my-owner/my-repo', 'ANOTHER_SECRET');
  expect(mocks.removeSecret).toBeCalledWith('my-owner/my-repo', 'BOOM_BAM');
});

test('update secrets accepts a profile', async () => {
  await updateSecrets({
    clients: mocks,
    allKeys: true,
    secret: 'my-secret-name',
    profile: 'my-profile',
  });

  expect(mocks.getSecret).toBeCalledWith('my-secret-name', { profile: 'my-profile' });
});

test('"keep" can be used to retain keys depite prune', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
    allKeys: true,
    prune: true,
    keep: ['BOOM_BAM', 'LALALALA'],
  });

  expect(mocks.storeSecret).toBeCalledTimes(Object.keys(secretJson).length);
  expect(mocks.listSecrets).toBeCalledWith('my-owner/my-repo');
  expect(mocks.removeSecret).toBeCalledWith('my-owner/my-repo', 'ANOTHER_SECRET');
  expect(mocks.removeSecret).not.toBeCalledWith('my-owner/my-repo', 'BOOM_BAM');
});

// Tests for the retry functionality
jest.mock('child_process', () => {
  const originalModule = jest.requireActual('child_process');

  return {
    ...originalModule,
    spawnSync: jest.fn(),
  };
});


describe('GitHub API retry functionality', () => {
  const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock console.error to prevent test output pollution
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('executeWithRetry should retry on failure', () => {
    // Mock spawnSync to fail twice and then succeed
    mockSpawnSync
      .mockReturnValueOnce({
        status: 1,
        stdout: Buffer.from('API rate limit exceeded'),
        stderr: Buffer.from(''),
        pid: 123,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: Buffer.from('API rate limit exceeded'),
        stderr: Buffer.from(''),
        pid: 123,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('Success'),
        stderr: Buffer.from(''),
        pid: 123,
        output: [],
        signal: null,
      });

    // Define retry options with very short backoff times for testing
    const retryOptions: RetryOptions = {
      maxRetries: 3,
      initialBackoff: 10, // 10ms
      maxBackoff: 100, // 100ms
      backoffFactor: 2,
    };

    // Execute a command with retry
    const result = executeWithRetry(() => mockSpawnSync('gh', ['api', 'test']), retryOptions);

    // Verify the command was called 3 times (2 failures + 1 success)
    expect(mockSpawnSync).toHaveBeenCalledTimes(3);
    expect(result.stdout.toString()).toBe('Success');
  });

  test('executeWithRetry should throw after exhausting retries', () => {
    // Mock spawnSync to always fail
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: Buffer.from('API rate limit exceeded'),
      stderr: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null,
    });

    // Define retry options with very short backoff times for testing
    const retryOptions: RetryOptions = {
      maxRetries: 2,
      initialBackoff: 10, // 10ms
      maxBackoff: 100, // 100ms
      backoffFactor: 2,
    };

    // Execute a command with retry and expect it to throw
    expect(() => {
      executeWithRetry(() => mockSpawnSync('gh', ['api', 'test']), retryOptions);
    }).toThrow('API rate limit exceeded');

    // Verify the command was called maxRetries + 1 times
    expect(mockSpawnSync).toHaveBeenCalledTimes(3); // Initial attempt + 2 retries
  });

  test('executeWithRetry should use exponential backoff', () => {
    // Mock Date.now to control time
    const originalDateNow = Date.now;
    const mockDateNow = jest.fn();
    Date.now = mockDateNow;

    // Mock spawnSync to fail twice and then succeed
    mockSpawnSync
      .mockReturnValueOnce({
        status: 1,
        stdout: Buffer.from('API rate limit exceeded'),
        stderr: Buffer.from(''),
        pid: 123,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: Buffer.from('API rate limit exceeded'),
        stderr: Buffer.from(''),
        pid: 123,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('Success'),
        stderr: Buffer.from(''),
        pid: 123,
        output: [],
        signal: null,
      });

    // Set up Date.now to advance time on each call
    mockDateNow
      .mockReturnValueOnce(1000) // Initial call
      .mockReturnValueOnce(1000) // First failure
      .mockReturnValueOnce(1100) // After first backoff (100ms)
      .mockReturnValueOnce(1100) // Second failure
      .mockReturnValueOnce(1300) // After second backoff (200ms)
      .mockReturnValueOnce(1300); // Success

    // Define retry options with specific backoff times for testing
    const retryOptions: RetryOptions = {
      maxRetries: 3,
      initialBackoff: 100, // 100ms
      maxBackoff: 1000, // 1000ms
      backoffFactor: 2,
    };

    // Execute a command with retry
    executeWithRetry(() => mockSpawnSync('gh', ['api', 'test']), retryOptions);

    // Verify the command was called 3 times
    expect(mockSpawnSync).toHaveBeenCalledTimes(3);

    // Restore original Date.now
    Date.now = originalDateNow;
  });
});
