# Contributing Guidelines

Thank you for contributing to `html-to-pdf-lite-module`!

To maintain code quality, maintainable releases, and clean automated changelogs, this project strictly adheres to **Semantic Versioning (SemVer 2.0.0)** and **Conventional Commits 1.0.0**.

---

## 📌 Semantic Versioning (SemVer 2.0.0)

Versions are structured as `MAJOR.MINOR.PATCH`:

- **MAJOR** (`x.0.0`): Incompatible API changes or breaking changes.
- **MINOR** (`0.x.0`): Backward-compatible new features.
- **PATCH** (`0.0.x`): Backward-compatible bug fixes or minor adjustments.

---

## 📝 Conventional Commits Format

Every commit message (and Pull Request title) must conform to the standard structure:

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Commit Types

| Type | Purpose | SemVer Bump |
| :--- | :--- | :--- |
| `feat` | A new feature | **MINOR** |
| `fix` | A bug fix | **PATCH** |
| `docs` | Documentation changes only | None |
| `style` | Formatting, missing semi-colons, etc. | None |
| `refactor` | Code change that neither fixes a bug nor adds a feature | None |
| `perf` | Code change that improves performance | **PATCH** |
| `test` | Adding missing tests or correcting existing tests | None |
| `build` | Build system or external dependencies changes | None |
| `ci` | Changes to CI configuration files and scripts | None |
| `chore` | Other changes that don't modify src or test files | None |

### Breaking Changes

Breaking changes **must** be indicated either by:
1. Appending `!` after the type/scope (e.g. `feat!: change return type of generatePdf`), OR
2. Including `BREAKING CHANGE: <explanation>` in the commit footer.

This triggers a **MAJOR** version increment.

---

## 🛠️ Commit Linting

We enforce Conventional Commits locally and in GitHub Actions via `@commitlint/cli` and `amannn/action-semantic-pull-request`.

You can test commit messages locally using:
```bash
npm run commitlint
```

---

## 🚀 Release Lifecycle & Changelog

1. **Changelog**: Generated on demand using `npm run changelog` (or previewed via `npm run changelog:check`).
2. **Version Bump**: Follows Semantic Versioning (`MAJOR.MINOR.PATCH`).
3. **Release & Tagging**:
   - Create a release commit: `git commit -am "chore(release): vX.Y.Z"`
   - Tag the release: `git tag vX.Y.Z`
   - Push to GitHub: `git push origin main --tags`
4. **Publishing**: `npm publish` (runs `prepublishOnly` to typecheck and build distribution).

---

## 📦 Dependency Updates (Dependabot)

- Dependabot checks for dependency updates **monthly**.
- Updates are grouped into combined PRs for `dependencies`, `devDependencies`, and `github-actions` to prevent pull request clutter.
- Dependabot PR titles follow conventional commit prefixes (`build(deps)`, `build(deps-dev)`, `ci(deps)`).
