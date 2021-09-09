import { updateSecrets } from '../src';
import { Clients } from '../src/clients';

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
    log: jest.fn(),
  };
});

afterEach(() => {
  jest.resetAllMocks();
});

test('just a secret name (all keys are stored)', async () => {
  await updateSecrets({
    clients: mocks,
    secret: 'my-secret-name',
  });

  expect(mocks.getSecret).toBeCalledWith('my-secret-name', { region: undefined });
  expect(mocks.confirmPrompt).toBeCalledTimes(1);
  expect(mocks.storeSecret).toBeCalledTimes(Object.keys(secretJson).length);
  for (const [key, secret] of Object.entries(secretJson)) {
    expect(mocks.storeSecret).toBeCalledWith('my-owner/my-repo', key, secret);
  }
});

test('region extracted from arn', async () => {
  const arn = 'arn:aws:secretsmanager:us-east-1:8899778877:secret:publishing-secrets-99999';

  await updateSecrets({
    clients: mocks,
    secret: arn,
  });

  expect(mocks.getSecret).toBeCalledWith(arn, { region: 'us-east-1' });
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
});