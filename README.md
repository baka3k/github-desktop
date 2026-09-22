# [GitHub Desktop](https://desktop.github.com)

[GitHub Desktop](https://desktop.github.com/) is an open-source [Electron](https://www.electronjs.org/)-based
GitHub app. It is written in [TypeScript](https://www.typescriptlang.org) and
uses [React](https://reactjs.org/).

<picture>
  <source
    srcset="https://user-images.githubusercontent.com/634063/202742848-63fa1488-6254-49b5-af7c-96a6b50ea8af.png"
    media="(prefers-color-scheme: dark)"
  />
  <img
    width="1072"
    src="https://user-images.githubusercontent.com/634063/202742985-bb3b3b94-8aca-404a-8d8a-fd6a6f030672.png"
    alt="A screenshot of the GitHub Desktop application showing changes being viewed and committed with two attributed co-authors"
  />
</picture>

## Where can I get it?

Download the official installer for your operating system:

 - [macOS](https://central.github.com/deployments/desktop/desktop/latest/darwin)
 - [macOS (Apple silicon)](https://central.github.com/deployments/desktop/desktop/latest/darwin-arm64)
 - [Windows](https://central.github.com/deployments/desktop/desktop/latest/win32)
 - [Windows machine-wide install](https://central.github.com/deployments/desktop/desktop/latest/win32?format=msi)

Linux is not officially supported; however, you can find installers created for Linux from a fork of GitHub Desktop in the [Community Releases](https://github.com/desktop/desktop#community-releases) section.

### Beta Channel

Want to test out new features and get fixes before everyone else? Install the
beta channel to get access to early builds of Desktop:

 - [macOS](https://central.github.com/deployments/desktop/desktop/latest/darwin?env=beta)
 - [macOS (Apple silicon)](https://central.github.com/deployments/desktop/desktop/latest/darwin-arm64?env=beta)
 - [Windows](https://central.github.com/deployments/desktop/desktop/latest/win32?env=beta)
 - [Windows (ARM64)](https://central.github.com/deployments/desktop/desktop/latest/win32-arm64?env=beta)

The release notes for the latest beta versions are available [here](https://desktop.github.com/release-notes/?env=beta).

### Past Releases
You can find past releases at https://desktop.githubusercontent.com. After installation of a past version, the auto update functionality will attempt to download the latest version.

### Community Releases

There are several community-supported package managers that can be used to
install GitHub Desktop:
 - Windows users can install using [winget](https://docs.microsoft.com/en-us/windows/package-manager/winget/) `c:\> winget install github-desktop` or [Chocolatey](https://chocolatey.org/) `c:\> choco install github-desktop`
 - macOS users can install using [Homebrew](https://brew.sh/) package manager:
      `$ brew install --cask github`

Installers for various Linux distributions can be found on the
[`shiftkey/desktop`](https://github.com/shiftkey/desktop) fork.

## Is GitHub Desktop right for me? What are the primary areas of focus?

[This document](https://github.com/desktop/desktop/blob/development/docs/process/what-is-desktop.md) describes the focus of GitHub Desktop and who the product is most useful for.

## I have a problem with GitHub Desktop

Note: The [GitHub Desktop Code of Conduct](https://github.com/desktop/desktop/blob/development/CODE_OF_CONDUCT.md) applies in all interactions relating to the GitHub Desktop project.

First, please search the [open issues](https://github.com/desktop/desktop/issues?q=is%3Aopen)
and [closed issues](https://github.com/desktop/desktop/issues?q=is%3Aclosed)
to see if your issue hasn't already been reported (it may also be fixed).

There is also a list of [known issues](https://github.com/desktop/desktop/blob/development/docs/known-issues.md)
that are being tracked against Desktop, and some of these issues have workarounds.

If you can't find an issue that matches what you're seeing, open a [new issue](https://github.com/desktop/desktop/issues/new/choose),
choose the right template and provide us with enough information to investigate
further.

## The issue I reported isn't fixed yet. What can I do?

If nobody has responded to your issue in a few days, you're welcome to respond to it with a friendly ping in the issue. Please do not respond more than a second time if nobody has responded. The GitHub Desktop maintainers are constrained in time and resources, and diagnosing individual configurations can be difficult and time consuming. While we'll try to at least get you pointed in the right direction, we can't guarantee we'll be able to dig too deeply into any one person's issue.

## How can I contribute to GitHub Desktop?

The [CONTRIBUTING.md](./.github/CONTRIBUTING.md) document will help you get setup and
familiar with the source. The [documentation](docs/) folder also contains more
resources relevant to the project.

If you're looking for something to work on, check out the [help wanted](https://github.com/desktop/desktop/issues?q=is%3Aissue+is%3Aopen+label%3A%22help%20wanted%22) label.

## Building Desktop

The repo ships a top-level `Makefile` that wraps the `yarn` build scripts in
`package.json`. After cloning the repo, the standard developer loop is:

```shellsession
$ make install   # install dependencies
$ make build     # production build (output in out/)
$ make start     # launch a development build with hot reload
```

### Available `make` targets

Run `make help` to see the full list. The most common ones:

| Command                 | What it does                                                                |
|-------------------------|-----------------------------------------------------------------------------|
| `make help`             | List every available target.                                                |
| `make install`          | Run `yarn install` to fetch JS dependencies.                                |
| `make build`            | Production build (`yarn build:prod`). Output goes to `out/`.                |
| `make build:dev`        | Development build (`yarn build:dev`). Faster, debug-friendly.               |
| `make start`            | Launch the app from a dev build with hot reload.                            |
| `make start:prod`       | Launch the app from a production build.                                     |
| `make package`          | Re-run only the packaging step (assumes `make build` has already run).      |
| `make test`             | Run unit tests (alias for `make test:unit`).                                |
| `make test:script`      | Run tests under `script/`.                                                  |
| `make test:e2e`         | Run the end-to-end Playwright suite (builds first, then runs).              |
| `make lint`             | Run `prettier --check` + `eslint` over the source tree.                     |
| `make lint:fix`         | Auto-fix prettier and eslint issues.                                        |
| `make markdownlint`     | Lint Markdown files.                                                        |
| `make validate`         | Aggregate check: `lint` + `markdownlint` + `test:script`.                   |
| `make clean`            | Remove the `out/` directory only.                                           |
| `make clean:all`        | Remove `out/`, root `node_modules/`, and `app/node_modules/`.               |
| `make rebuild-hard:dev` | `make clean:all` + `make build:dev` — full clean rebuild.                   |
| `make rebuild-hard:prod`| `make clean:all` + `make build` — full clean production rebuild.            |
| `make ci`               | Composite target: `install` + `lint` + `test:script` + `build`.             |
| `make version-check`    | Validate Node / Yarn / Electron versions match `.tool-versions`.            |

Set `VERBOSE=1` to print every command as it runs (`VERBOSE=1 make build`).

The `Makefile` is intentionally a thin wrapper around `yarn` — every target
mirrors a script in `package.json`. If you prefer, you can call `yarn build:prod`
or any other script directly. See [`setup.md`](./docs/contributing/setup.md) for
first-time developer setup, including platform-specific prerequisites.

### What `make build` actually does

`make build` runs `yarn build:prod`, which:

1. Webpack-compiles the renderer and main process bundles in production mode
   (with `--max_old_space_size=4096` so large dependency graphs fit in memory).
2. Invokes `script/build.ts`, which:
   - Cleans the previous distribution from `out/`.
   - Copies static resources, emoji, license dumps, and the Copilot SDK runtime.
   - Runs `@electron/packager` to produce a platform-specific app bundle
     (macOS `.app`, Windows `.exe`, Linux unpacked dir, depending on host).
3. On macOS, signs the bundle with the developer certificate configured in your
   local keychain. On CI, this step is skipped unless `CSC_LINK` / `CSC_KEY_PASSWORD`
   are set.

Artifacts land in `out/`. To launch them directly, run `make start:prod` (which
uses `script/start.ts` to run the packaged binary with the current source tree).

## AI agents and LLM configuration

GitHub Desktop uses [GitHub Copilot](https://github.com/features/copilot) as the
default AI agent for commit message suggestions, merge conflict resolution, and
other in-app assistance. The Copilot SDK ships as a bundled native runtime
(`@github/copilot-sdk-*`) so the app works without any extra setup once you sign
in.

You are not limited to Copilot's hosted models — Desktop also lets you plug in
your own LLM provider and pick a different model per feature.

### Built-in Copilot

1. Open **Preferences → Copilot** and sign in with your GitHub account.
2. Pick a Copilot model in the dropdown for each feature (commit messages,
   conflict resolution, summaries).
3. Your selection is remembered per feature.

### Bring Your Own Key (BYOK)

If you want to use your own model, open **Preferences → Copilot → Custom
Providers** and add a provider. Secrets (API keys / bearer tokens) are stored
in the OS keychain, never in `localStorage`.

| Provider                | Base URL pattern                          | Auth             | Wire API                  |
|-------------------------|-------------------------------------------|------------------|---------------------------|
| OpenAI / OpenAI-compatible | `https://<your-endpoint>/v1`          | API key or bearer| Chat completions / Responses (GPT-5) |
| Azure OpenAI            | `https://<resource>.openai.azure.com/`    | API key          | Chat completions          |
| Anthropic               | `https://api.anthropic.com`               | API key          | Anthropic native          |
| Ollama (local)          | `http://localhost:11434/v1`               | **None**         | Chat completions          |

Adding a local Ollama model:

```shellsession
$ ollama serve                  # start the local server on :11434
$ ollama pull llama3.1          # pull the model you want Desktop to use
```

Then in Desktop add a **Custom Provider** with type `Ollama (local)`,
base URL `http://localhost:11434/v1`, authentication `None`, and the model IDs
you pulled (e.g. `llama3.1`). The model will appear in every Copilot feature's
model picker alongside the hosted Copilot models.

Because any **OpenAI-compatible** endpoint works, you can also point the BYOK
configuration at other gateways — LM Studio, vLLM, OpenRouter, Groq, Together,
and similar — without code changes. Pick **OpenAI / OpenAI-compatible** as the
provider type and enter their base URL.

### Picking a different AI agent per feature

For each Copilot-powered feature you can pick a different model — mixing hosted
Copilot models and your own BYOK providers:

1. Open **Preferences → Copilot**.
2. Choose the feature (e.g. *Commit messages*, *Conflict resolution*).
3. Pick a model from the dropdown. The list contains every Copilot model and
   every model from each configured BYOK provider.
4. Save. The selection is remembered per feature.

Typical combinations:

- **Hosted Copilot everywhere** — simplest setup, sign in once.
- **Anthropic Claude for commit messages, OpenAI GPT-5 for conflict resolution**
  — use the model that is best at each task.
- **Local Ollama for sensitive work, hosted Copilot for everything else** — keep
  private code on your machine while still benefiting from Copilot on public
  repos.

## More Resources

See [desktop.github.com](https://desktop.github.com) for more product-oriented
information about GitHub Desktop.

See our [getting started documentation](https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop) for more information on how to set up, authenticate, and configure GitHub Desktop.

## License

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo
designs. GitHub reserves all trademark and copyright rights in and to all
GitHub trademarks. GitHub's logos include, for instance, the stylized
Invertocat designs that include "logo" in the file title in the following
folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's
Trademarks or registered Trademarks. When using GitHub's logos, be sure to
follow the GitHub [logo guidelines](https://github.com/logos).