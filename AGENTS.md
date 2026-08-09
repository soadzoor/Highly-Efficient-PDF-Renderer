# AGENTS.md

## General Instructions

- Do not commit changes.
- Do not create, amend, rebase, reset, squash, or otherwise modify git history.
- Do not run commands that alter git history or repository state beyond editing files needed for the task.
- You may inspect git status, diffs, and logs when useful.
- You may suggest git commands or commit messages, but leave all git operations for the user to perform manually.
- If not instructed otherwise, don't run commands that can take hours to run (like machine learning training, evaluations, etc.), just say the word, and user will run them manually if they agree to run them
- This also includes generating parsed ZIPs from PDFs. Don't do that by yourself, because it can take a lot of time. Ask me to do it if needed.

## Development Server

- Do not start the development server.
- Do not run commands such as `npm run dev`, `yarn dev`, `pnpm dev`, `bun dev`, `rails server`, `python manage.py runserver`, or similar server-start commands.
- If running the app locally would be useful for verification, explain what the user should run manually instead.

## Working Style

- Make focused, minimal changes that directly address the task.
- Prefer explaining assumptions before making broad changes.
- Preserve existing code style and project conventions.
- When unsure, inspect nearby files for patterns before editing.
- After making changes, summarize:
  - what changed,
  - which files were modified,
  - any checks or tests that were run,
  - any checks that still need to be run manually,
  - recommended commit message.

## Testing and Validation

- Run relevant tests, linters, type checks, or formatters when they do not require starting a dev server.
- If a validation step requires a dev server, browser session, external service, credentials, or manual interaction, do not run it. Instead, describe the manual verification steps.

## User-Controlled Operations

The user will handle manually:

- running long commands (because the user often can't cancel them, if needed), like machine learning training, etc
- starting or stopping development servers
- committing changes
- creating branches
- rebasing, merging, or resetting
- pushing to remotes
- deployment or release steps