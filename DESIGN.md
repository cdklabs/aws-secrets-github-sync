# Design

## Architecture

┌───────────────────────────────────────────────────────┐           ┌───────────────────────────┐
│                                                       │           │                           │
│  AWS Secrets Manager                                  │           │   GitHub                  │
│                                                       │           │                           │
│ ┌───────────────────────────────────────────────────┐ │           │ ┌──────────────────────┐  │
│ │arn:aws:secretsmanager:...:secret:publishing-secret│ │           │ │ myorg/myrepository   │  │
│ ├───────────────────────────────────────────────────┤ │           │ ├──────────────────────┤  │
│ │                                                   │ │           │ │                      │  │
│ │                                                   │ │           │ │ ┌─────────────────┐  │  │
│ │                                                   │ │           │ │ │ SECRETS         │  │  │
│ │ {                                                 │ │           │ │ ├─────────────────┤  │  │
│ │   "MY_KEY1": "Asz9339839833",                     │ │           │ │ │ MY_KEY1         │  │  │
│ │    BOOM": "as89sx9@#@#",                          │ │           │ │ │ BOOM            │  │  │
│ │   "BAM": "a912n23873jdsj"                         │ │           │ │ │ OLD_SECRET      │  │  │
│ │ }                                                 │ │           │ │ └─────────▲───────┘  │  │
│ │                                                   │ │           │ │           │          │  │
│ └───────────▲───────────────────────────────────────┘ │           │ └───────────┼──────────┘  │
│             │                                         │           │             │             │
└─────────────┼─────────────────────────────────────────┘           └─────────────┴─────────────┘
              │                                                                (encrypted)
          (sigv4)                                                                 │
              │                                                                   │
              │                                                            $ gh secret set -R myorg/myrepository MY_KEY1
           aws-sdk-js                                                      $ gh secret set -R myorg/myrepository BOOM
        secretsmanager                                                     $ gh secret set -R myorg/myrepository BAM
        getSecretValue()                                                   $ gh secret remove -R myorg/myrepository OLD_SECRET
              ┼                                                                   ┼
         [CREDENTIALS: AWS]                                                   [CREDENTIALS: gh login]
              │                                                                   │
              │         ┌──────────────────────────────────────────────────┐      │
              │         │  $ sm2gh-secrets                                 │      │
              │         │      --secret arn:aws:...:publishing-secret      │      │
              └─────────┤      --all                                       ├──────┘
                        │      --prune                                     │
                        │      --repo myorg/myrepository                   │
                        └──────────────────────────────────────────────────┘
