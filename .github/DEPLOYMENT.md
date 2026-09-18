# Deployment workflows were not generated

- Deployment platform: Lovable
- Deployment method: platform-managed

Lovable manages deployment automatically. A generated workflow would be a second deployer racing the platform.

Nothing in this package deploys, and nothing in CI reports a deployment that did not happen.
Production deployment must stay downstream of an approved Canon run — whatever performs it
should verify the commit first:

```yaml
      - run: node .canon/release.mjs verify --sha "${{ github.sha }}"
```

To have Canon compile deploy workflows, open the flow in Canon → **Flow settings → Environments**
and set the deployment method to GitHub Actions or a custom command.
