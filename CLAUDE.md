# Floodlight

## Working on the website

**Context first.** Before any website work, read Erez's Obsidian vault at
`/Users/erezeisenstein/Claude- FloodLight/Floodlight` (Home, Workstreams, Decisions, Open issues) and treat it
as the source of truth, not chat history. Update it when work finishes or a decision is made, using the colour
code 🟢 done, 🟠 in progress, 🔴 broken, 🟣 decision, 🔵 index.

**Design toolset: use all nine on every website task.**
- frontend-design: a bold, deliberate visual direction instead of a generic one
- ui-ux-pro-max: layout, spacing, type and colour systems
- web-design-guidelines: check every screen against the web interface guidelines
- unslop: strip the generic "AI look" from layout and copy
- design-system: keep buttons, cards and colours consistent
- design-critique: review each screen for hierarchy and clutter
- ux-copy: sharper labels, empty states and instructions
- dataviz: cleaner charts and stat tiles
- accessibility-review: contrast, readability, focus and keyboard use

If a skill isn't installed in the session, read its copy in `~/Documents/Floodlight/_design-skills/`, or fetch it:
- frontend-design: https://github.com/anthropics/skills (skills/frontend-design)
- web-design-guidelines: https://github.com/vercel-labs/agent-skills (skills/web-design-guidelines)
  plus https://github.com/vercel-labs/web-interface-guidelines (command.md)
- ui-ux-pro-max, design-system: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- design-critique, ux-copy, accessibility-review: https://github.com/anthropics/knowledge-work-plugins (design/skills)
- javascript-pro (for the JS): https://github.com/Jeffallan/claude-skills (skills/javascript-pro)
- dataviz: built into Claude Code sessions
- unslop: in the Claude plugin directory ("unslop" by Jean-Luc Winkler); install it there

**Standing rules.**
- Work on the `redesign` branch. Never merge into `main` without Erez's go-ahead.
- One local preview only: http://localhost:8650 (`python3 server.py 8650`). Stop any other preview first.
- No purple anywhere.
- Theme tokens (colours, fonts, radii, spacing, timing) live in `arena.css`, in the first block.
- New public files must be added to `PUBLIC_FILES` in `server.py`, or the server won't serve them.
- One commit per section, with a clear message, so any section can be undone on its own.
