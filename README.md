# aws-secrets-github-sync

> Updates GitHub secrets from AWS Secrets Manager.

---

> **Beta**: This project is under active development and is not recommended to
> use in production environments.

This utility reads a secret from AWS Secrets Manager and stores the keys from
this secret to GitHub repository secrets.

It is useful to maintain a set of keys across multiple repositories, handle
rotation, etc.

## Install

This tool is published as an npm module, so it can be either installed locally
or globally via:

```shell
npm i -g aws-secrets-github-sync
```

Or any other npm package manager such as yarn, pnpm, etc.

## Prerequisites

* GitHub CLI, logged into your account.
* AWS credentials configured in your environment

## Usage

### Store your secret in AWS Secrets Manager

Use the AWS CLI or AWS Console to create a secret in AWS Secrets Manager that
includes keys that map to GitHub secret names.

For example, say our AWS Secrets Manager secret looks like this:

```json
{
  "NPM_TOKEN": "<my npm token>",
  "FOOBAR": "<some other secret>"
}
```

## Updating Secrets

Now that you have a secret in AWS Secrets Manager, you can use this tool to read
it and store it in your GitHub repository.

This can be either done via a config file or via the command line.

```shell
aws-secrets-github-sync -s SECRET [OPTIONS]
```

Options:

* `--help` Show help
* `-s`, `--secret` - The secret ID or ARN of the AWS Secrets Manager secret
* `-k`, `--keys` (array) - The set of keys to update. Can be invoked multiple
  times (e.g. `-k NPM_TOKEN -k FOOBAR`). If not specified, all keys from the
  secret will be stored in the repository.
* `--prune` - Will delete any secret keys from the repository that are not in
  AWS Secrets Manager (and not specified in `--keep`). If this is not set, old
  keys will be retained.
* `--keep` - Keys to keep instead of pruning (can appear multiple times).
* `--yes` - Don't ask for user confirmation before the update.
* `-r`, `--repo` - The GitHub full repository name (e.g.
  `cdklabs/aws-secrets-github-sync`). If this is not specified, we will try to resolve the
  repo from the current git settings.
* `-e`, `--environment` - GitHub environment name to sync secrets to. If specified,
  secrets will be synced to environment secrets instead of repository secrets.
* `-R`, `--region` - The AWS region to read the secret from. If this is not
  specified, `AWS_REGION` will be used. If the secret is an ARN, we will resolve
  the region from the ARN.
* `--profile` - specify AWS credentials profile to use.

You can also specify all options via a configuration file. Here's an example
`secrets.json`:

```json
{
  "secret": "publishing-secrets",
  "environment": "production",
  "region": "us-east-1",
  "prune": true,
  "keys": [
    "NPM_TOKEN",
    "PROJEN_GITHUB_TOKEN"
  ]
}
```

And then, execute:

```shell
aws-secrets-github-sync -C secrets.json
```

### Environment Secrets

To sync secrets to a GitHub environment instead of repository secrets, use the
`--environment` (or `-e`) option:

```shell
aws-secrets-github-sync -s SECRET -e production --all
```

This will sync all keys from the AWS Secrets Manager secret to the "production"
environment secrets in your GitHub repository.

## Auditing

All AWS Secrets Manager activity is [recorded in AWS
CloudTrail](https://docs.aws.amazon.com/secretsmanager/latest/userguide/monitoring.html).
Requests from aws-secrets-github-sync are tagged with a user-agent of
`aws-secrets-github-sync/$version` so it is possible to find them as needed.

## Contributing

See our [Contribution Guide](CONTRIBUTING.md) for more information.

## Security

See [Security Issue Notification](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
