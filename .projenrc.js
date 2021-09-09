const { TypeScriptProject } = require('projen');
const project = new TypeScriptProject({
  defaultReleaseBranch: 'main',
  name: 'sm2gh-secrets',
  minNodeVersion: '14.17.0',
});
project.synth();