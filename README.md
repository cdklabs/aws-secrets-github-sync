# sm2gh-secrets

> Updates GitHub secrets from AWS Secrets Manager.

This utility reads a secret from AWS Secrets Manager and stores the keys from
this secret to GitHub repository secrets.

It is useful to maintain a set of keys across multiple repositories, handle
rotation, etc.

## Install

This tool is published as an npm module, so it can be either installed locally
or globally via:

```shell
npm i -g sm2gh-secrets
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
sm2gh-secrets -s SECRET [OPTIONS]
```

Options:

* `--help` Show help
* `-s`, `--secret` - The secret ID or ARN of the AWS Secrets Manager secret
* `-r`, `--repo` - The GitHub full repository name (e.g. `cdklabs/sm2gh-secrets`). If this is not specified, we will try to resolve the repo from the current git settings.
* `-R`, `--region` - The AWS region to read the secret from. If this is not specified, `AWS_REGION` will be used. If the secret is an ARN, we will resolve the region from the ARN.
* `-k`, `--keys` (array) - The set of keys to update. Can be invoked multiple times (e.g. `-k NPM_TOKEN -k FOOBAR`). If not specified, all keys from the secret will be stored in the repository.

You can also specify all options via a configuration file. Here's an example `secrets.json`:

```json
{
  "secret": "publishing-secrets",
  "region": "us-east-1",
  "keys": [
    "NPM_TOKEN",
    "PROJEN_GITHUB_TOKEN"
  ],
}
```

And then, execute:

```shell
sm2gh-secrets -C secrets.json
```

## Contributing

See our [Contribution Guide](CONTRIBUTING.md) for more information.

## Security

See [Security Issue Notification](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
