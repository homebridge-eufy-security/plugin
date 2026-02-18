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
- Write to `/tmp/pr-body.md`
- Reference the issue: `Closes #<number>`
- Describe the **spirit** of the change, not the code diff
- Concise description of the problem and fix

### Issue comments
- Use `gh issue comment <number> --repo homebridge-plugins/homebridge-eufy-security --body "<message>"`
- Use first person ("I")
- Thank the user by @mention
- Be formal and concise
