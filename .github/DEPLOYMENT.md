# Deployment automation was not generated

Canon does not ship placeholder deploy workflows. No deployment command is defined for:

- **staging**
- **production**

Canon compiles deploy workflows on its own for Vercel, Netlify and Lovable. This repository
shows no configuration for any of them, so it needs your command.

There is no workflow in this package that deploys to staging or production. Nothing in CI
will report a successful deployment that did not happen.

## To generate it

1. Open the flow in Canon → **Flow settings → Environments**.
2. Enter the exact shell command your project uses to deploy, for example:
   - `npm run deploy:production`
   - `aws s3 sync dist s3://your-bucket --delete`
3. Compile again. Canon emits `.github/workflows/deploy-*.yml` running that exact command.

## Until then

Deploy manually, or add your own workflow. Production deployment must stay downstream of
an approved Canon run — verify the commit first:

```yaml
      - run: node .canon/release.mjs verify --sha "${{ github.sha }}"
```

Store credentials as repository secrets and reference them in the command
(`$MY_TOKEN` with `env:`), never inline.
