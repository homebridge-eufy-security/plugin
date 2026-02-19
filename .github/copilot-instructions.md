# Copilot Instructions — homebridge-eufy-security

## Git Workflow

```bash
# Create dedicated branch from beta
git checkout beta && git pull origin beta
git checkout -b fix/<short-description>

# Stage and commit each change individually (concise, single-line, spirit-based)
git add <file>
git commit -m "fix: <concise description of what changed and why>"

# Push and create PR
git push -u origin fix/<short-description>
gh pr create --base beta --title "<concise title>" --body-file /tmp/pr-body.md
```

### Commit message rules
- One line, no line breaks mid-sentence
- Describe the **spirit** of the change, not the code diff

### PR body
- Write to `/tmp/pr-body-<branch>.md`
- Reference the issue: `Closes #<number>`
- Describe the **spirit** of the change, not the code diff
- Concise description of the problem and fix

### Issue comments
- Use `gh issue comment <number> --repo homebridge-plugins/homebridge-eufy-security --body "<message>"`
- Use first person ("I")
- Thank the user by @mention
- Be formal and concise

## Dependency Updates — `eufy-security-client`

When updating the `eufy-security-client` version in `package.json`:

1. Check the upstream changelog and README at https://github.com/bropat/eufy-security-client/blob/master/README.md
2. Identify breaking changes, new features, or device support changes
3. Summarize the impact concisely in the **PR body** so end users understand what changed and why the update matters (e.g. new device support, bug fixes, API changes)
4. If there are breaking changes, note any required code adjustments in this plugin

## Linting & Building

- Run `npm run lint` before committing to ensure zero warnings/errors
- The lint script runs: `eslint 'src/**/*.ts' --max-warnings=0`
- `@typescript-eslint/no-explicit-any` is globally disabled — do **not** add `eslint-disable` comments for it
- Fix all warnings; the build enforces `--max-warnings=0`
- Run `npm run build` before pushing to ensure the project compiles without errors
