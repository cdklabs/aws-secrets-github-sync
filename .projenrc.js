const { TypeScriptProject, JsonFile } = require('projen');

const PROJEN_UPGRADE_SECRET = 'PROJEN_GITHUB_TOKEN';

const project = new TypeScriptProject({
  defaultReleaseBranch: 'main',
  name: 'sm2gh-secrets',
  description: 'Update GitHub repository secrets from an AWS SecretsManager secret',
  deps: ['aws-sdk', 'yargs'],
  minNodeVersion: '14.17.0',
  projenUpgradeSecret: PROJEN_UPGRADE_SECRET,
  releaseToNpm: false, // still private
});

//----------------------------------------------------
// very meta (should be part of projen)

const secretsConfig = 'secrets.json';
new JsonFile(project, secretsConfig, {
  obj: {
    secret: 'publishing-secrets',
    region: 'us-east-1',
    keys: ['NPM_TOKEN', PROJEN_UPGRADE_SECRET],
  },
});

project.addTask('secrets:update', {
  description: 'Update this GitHub repository\'s secrets from AWS SecretsManager',
  exec: `bin/sm2gh-secrets -C ${secretsConfig}`,
});

//----------------------------------------------------

project.synth();