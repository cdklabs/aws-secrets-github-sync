import { DEFAULTS as clients } from '../src/clients';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    spawnSync: (_a: any, _b: any, options: any) => {
      return actual.spawnSync('node', ['--eval', "throw new Error('Nope');"], options);
    },
  };
});

afterEach(() => {
  jest.resetAllMocks();
});

test('throws error when, getRepositoryName() sub process fails', async () => {
  expect(
    () => clients.getRepositoryName(),
  ).toThrowError(/Failed to get repository name: .*/);
});

test('throws error when, storeSecret() sub process fails', async () => {
  expect(
    () => clients.storeSecret('repo', 'name', 'value'),
  ).toThrowError(/Failed to store secret 'name' in repository 'repo': .*/);
});

test('throws error when, listSecrets() sub process fails', async () => {
  expect(
    () => clients.listSecrets('repo'),
  ).toThrowError(/Failed to list secrets in repository 'repo': .*/);
});

test('throws error when, removeSecret() sub process fails', async () => {
  expect(
    () => clients.removeSecret('repo', 'key'),
  ).toThrowError(/Failed to remove secret 'key' from repository 'repo': .*/);
});
