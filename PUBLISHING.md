# Publishing and verification

The npm package is `@blockloads/n8n-nodes-sekential`. Its public source is
[`BlockLoads-SAS/n8n-nodes-sekential`](https://github.com/BlockLoads-SAS/n8n-nodes-sekential).
Releases publish through `.github/workflows/publish.yml` with provenance.
The workflow uses Node.js 24 and npm 11.21.0, which support npm trusted
publishing. Keep the repository public so npm can generate provenance and
n8n can review the source.

## Before releasing

1. Merge and deploy the matching Sekential backend. Confirm that the target
   tenant exposes `/api/n8n/connection` and `/api/n8n/subscriptions` and runs
   the delivery job.
2. Test the package in an n8n instance against that deployment: validate the
   credential, perform an action, receive a signed trigger, and confirm that
   unpublishing the workflow removes its subscription. Use a public HTTPS
   production webhook URL for the trigger.
3. Run `npm ci`, `npm run lint`, `npm run build`, and `npm test`. Inspect
   `npm pack --dry-run` to confirm that the configured nodes, credential,
   metadata, and icons are included.
4. Merge the package changes to `main` and wait for CI. Maintain the package
   version and `CHANGELOG.md` together.

## First npm publication

An npm maintainer needs permission to create public packages under the
`@blockloads` scope. The npm organization and GitHub organization are separate
accounts; check the npm scope and publishing rights first.

Trusted publishing needs an existing npm package. With npm 11.21.0 and an
interactive npm session with 2FA enabled, stage a disposable prerelease tarball
under a separate version and dist-tag:

```bash
npm stage publish <bootstrap-prerelease.tgz> --access public --tag bootstrap
```

For a new package, npm creates a public `0.0.0-stage` placeholder. The staged
tarball stays unpublished until approved. Configure the trusted publisher below
against that package and verify it with `npm trust list
@blockloads/n8n-nodes-sekential`. Complete the maintainer's personal 2FA check in
an ordinary browser tab. Keep the reviewed release version unchanged and leave
the disposable stage unapproved.

Release the prepared version from `main` by pushing its matching tag, such as
`0.2.0` for package version `0.2.0`. Tags with a `v` prefix are also accepted.
The workflow rejects a tag that differs from `package.json`, or a tagged
commit that has not reached `main`. It builds and tests, then uses the n8n
CLI to lint, rebuild, and publish with provenance.

The first real release uses the trusted publisher and GitHub Actions provenance.
After verifying that release, reject only the disposable stage with `npm stage
reject <stage-id>`, then log out of the temporary CLI session. This setup does
not require an `NPM_TOKEN` repository secret or a token that bypasses 2FA.

See npm's [staged publishing guide](https://docs.npmjs.com/staged-publishing/),
[trusted publisher prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
and [scoped public package publishing](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

## Subsequent releases with trusted publishing

In the npm package settings, add a GitHub Actions trusted publisher with:

| Setting           | Value                                       |
| ----------------- | ------------------------------------------- |
| Repository owner  | `BlockLoads-SAS`                            |
| Repository name   | `n8n-nodes-sekential`                       |
| Workflow filename | `publish.yml`                               |
| Environment name  | Leave blank                                 |
| Allowed action    | Enable direct publishing with `npm publish` |

New configurations must complete a successful publication within two days;
create this configuration when the next release is ready. npm does not
validate it when saving, so confirm the exact values. See
[npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

On a clean, current `main` checkout, run `npm run release`. The standard n8n
CLI release flow lints and builds, bumps the version, updates the changelog,
commits, tags, pushes, and creates a GitHub release. It needs GitHub release
access. The pushed tag triggers the Actions workflow, which publishes to npm
using OIDC without `NPM_TOKEN`.

Check the workflow result and npm provenance for every release. Users install
each published version in their n8n instance.

## Public installation and n8n Cloud

Publishing the public npm package enables installation by self-hosted n8n
Owners and Admins through **Settings → Community nodes**. Members can use the
installed nodes with a Sekential tenant and their own authorized credentials.

For discovery in the node picker and installation on n8n Cloud, submit the
published package to the [n8n Creator Portal](https://creators.n8n.io/nodes).
First check the [verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md),
including public MIT source, documentation, no runtime dependencies, passing
automated checks, and a GitHub Actions publication with provenance. Review
approval is separate from npm publication; update the README when approved.
See [n8n's submission guide](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md).
