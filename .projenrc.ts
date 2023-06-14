import { typescript, JsonFile } from 'projen';

const PROJEN_UPGRADE_SECRET = 'PROJEN_GITHUB_TOKEN';

const project = new typescript.TypeScriptProject({
  defaultReleaseBranch: 'main',
  name: 'aws-secrets-github-sync',
  projenrcTs: true,
  repository: 'https://github.com/cdklabs/aws-secrets-github-sync.git',
  authorEmail: 'aws-cdk-dev@amazon.com',
  authorName: 'Amazon Web Services',
  authorOrganization: true,
  description: 'Update GitHub repository secrets from an AWS SecretsManager secret',
  deps: ['aws-sdk', 'yargs@17.1.1'],
  minNodeVersion: '14.17.0',
  releaseToNpm: true,
  workflowBootstrapSteps: [
    {
      name: 'Install Semgrep',
      run: 'python3 -m pip install semgrep',
    },
  ],
  autoApproveUpgrades: true,
  autoApproveOptions: { allowedUsernames: ['cdklabs-automation'] },
});

//----------------------------------------------------
// very meta (should be part of projen)

const secretsConfig = 'sm2gh.json';
new JsonFile(project, secretsConfig, {
  obj: {
    secret: 'publishing-secrets',
    region: 'us-east-1',
    prune: true,
    keys: ['NPM_TOKEN', PROJEN_UPGRADE_SECRET],
  },
});

project.addTask('secrets:update', {
  description: 'Update this GitHub repository\'s secrets from AWS SecretsManager',
  exec: `bin/aws-secrets-github-sync --config ${secretsConfig}`,
});

//----------------------------------------------------

const semgrep = project.addTask('semgrep', {
  description: 'Static analysis',
  exec: 'semgrep --config p/typescript',
  condition: 'which semgrep', // only run if semgrep is installed
});

project.postCompileTask.spawn(semgrep);

project.synth();
