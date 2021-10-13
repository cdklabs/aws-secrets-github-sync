import * as yargs from 'yargs';
import { updateSecrets } from './update-secrets';

async function main() {
  const argv = yargs
    .usage('$0 -s SECRET [OPTIONS]')
    .usage('$0 -C secrets.json')
    .option('secret', { alias: 's', describe: 'Secrets Manager secret ID or ARN', type: 'string', required: true })
    .option('repo', { alias: 'r', describe: 'GitHub repository owner/name (default is derived from current git repository)', type: 'string' })
    .option('region', { alias: 'R', describe: 'AWS region (if --secret is an ARN, region is not required)', type: 'string' })
    .option('keys', { alias: 'k', describe: 'Which keys to update (to update all keys use --all)', type: 'array' })
    .option('all', { alias: 'A', describe: 'Update all keys', type: 'boolean' })
    .option('config', { alias: 'c', describe: 'Reads options from a configuration file' })
    .option('debug', { type: 'boolean', describe: 'Show debugging information', default: false })
    .option('prune', { type: 'boolean', describe: 'Remove old keys from GitHub', default: false })
    .option('yes', { type: 'boolean', describe: 'Skip confirmation prompt', default: false, alias: 'y' })
    .example('$0 -s my-secrets --all', 'Updates all secrets from AWS Secrets Manager to the current github repository (region can be omitted by specifying an ARN)')
    .example('$0 -s my-secrets -k TWINE_USERNAME -k TWINE_PASSWORD', 'Only updates two secrets')
    .example('$0 -c sm2gh.json', 'Read settings from sm2gh.json')
    .array('keys')
    .string('keys')
    .config('config') // allow reading from a config file
    .argv;

  if (argv.debug) {
    console.error({ argv });
  }

  await updateSecrets({
    secret: argv.secret,
    region: argv.region,
    repository: argv.repo,
    allKeys: argv.all,
    keys: argv.keys,
    confirm: !argv.yes,
    prune: argv.prune,
  });
}

main().catch((e: Error) => {
  console.error(e.stack);
  process.exit(1);
});