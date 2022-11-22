import { spawnSync } from 'child_process';
import { SecretsManager } from 'aws-sdk';
import { DEFAULTS as clients } from '../src/clients';

jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}));
jest.mock('aws-sdk', () => ({
  SecretsManager: jest.fn(),
}));


describe('Error handling', () => {
  beforeEach(() => {
    // @ts-expect-error We've mocked this submodule at top of file.
    spawnSync.mockImplementation(function (_a: any, _b: any, options: any) {
      const actual = jest.requireActual('child_process');
      return actual.spawnSync('node', ['--eval', "throw new Error('Nope');"], options);
    });

    // @ts-expect-error We've mocked this submodule at top of file.
    SecretsManager.mockImplementation(function () {
      return {
        getSecretValue: function () {
          return {
            promise: async () => Promise.reject(new Error('Nope')),
          };
        },
      };
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('throws error, when .getRepositoryName() sub-process throws an error', () => {
    expect(
      () => clients.getRepositoryName(),
    ).toThrowError('Failed to get repository name');
  });

  test('throws error, when .storeSecret() sub-process throws an error', () => {
    expect(
      () => clients.storeSecret('repo', 'name', 'value'),
    ).toThrowError("Failed to store secret 'name' in repository 'repo'");
  });

  test('throws error, when .listSecrets() sub-process throws an error', () => {
    expect(
      () => clients.listSecrets('repo'),
    ).toThrowError("Failed to list secrets in repository 'repo'");
  });

  test('throws error, when .removeSecret() sub-process throws an error', () => {
    expect(
      () => clients.removeSecret('repo', 'key'),
    ).toThrowError("Failed to remove secret 'key' from repository 'repo'");
  });

  test('throws error, when SecretsManager.removeSecret() throws an error', async () => {
    return expect(async () => {
      return clients.getSecret('secretId');
    }).rejects.toThrow("Failed to retrieve secret 'secretId' from SecretsManager: Error: Nope");
  });
});
