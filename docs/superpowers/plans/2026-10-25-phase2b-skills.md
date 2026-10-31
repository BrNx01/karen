# KAREN Phase 2b — Skill Library Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** The user can add ready-made skill/agent repos with one click; KAREN uses them automatically through two-stage loading.

**Architecture:** `server/skills.ts` scans the filesystem (frontmatter `SKILL.md`, `skills/*.md`, `agents/*.md`) and copies the approved ones into `~/.karen/skills/<id>/`. The catalog (name + description + trigger) enters the system context as a short list; full content is read only when the `load_skill` tool is called. A skill cannot widen its tool permissions.

**Tech Stack:** existing (TS ESM, vitest, React).

**Spec:** `docs/superpowers/specs/2026-10-24-ikinci-beyin-ide-design.md` §7.12

## Global Constraints

- A skill file larger than 256 KiB is rejected.
- Only `.md` files are scanned; `node_modules`, `.git`, `dist` are skipped.
- Copying never writes outside `~/.karen/skills/<id>/`; the id must be `[a-z0-9-]`.
- Catalog at most 200 skills, each line at most 200 characters (context does not bloat).
- `load_skill` returns only registered and enabled skills; no path reads.
- Git install runs on a user click (`git clone --depth 1`), not by the agent.

## Review Focus

1. Skill text must not be written directly into the system context (only the catalog line + explicit load).
2. An id or path containing `../` must not be able to write outside `~/.karen/skills`.
3. A disabled skill must not appear in the catalog or in `load_skill`.
4. Broken frontmatter must not crash the app; the name must be derived from the file name.
5. If the catalog exceeds 200 lines it must be truncated, not silently send hundreds of lines.

---

### Task 1: Parser and discovery

**Files:** Create `server/skills.ts`, `test/skills.test.ts`

**Interfaces:**
- `ParsedSkill = { id: string; name: string; description: string; triggers: string[]; body: string; source: string }`
- `parseSkill(text: string, source: string, fallbackName: string): ParsedSkill`
- `discoverSkills(dir: string): ParsedSkill[]` — `SKILL.md`, `skills/**/*.md`, `agents/**/*.md`
- `toId(name: string): string` — lowercase, space→hyphen, anything outside `[a-z0-9-]` dropped

- [ ] Tests: frontmatter parsing; name from the heading when there is no frontmatter; over 256 KiB rejected; `toId` cleanup.
- [ ] Red → implement → green. Commit.

### Task 2: SkillStore

**Files:** Modify `server/skills.ts`, `test/skill-store.test.ts`

**Interfaces:**
- `InstalledSkill = ParsedSkill & { enabled: boolean; installedAt: number; from: string }`
- `class SkillStore { constructor(rootDir: string); list(): InstalledSkill[]; install(sourceDir: string): InstalledSkill[]; installFromGit(url: string): Promise<InstalledSkill[]>; setEnabled(id: string, enabled: boolean): boolean; remove(id: string): boolean; read(id: string): string | null; catalog(limit?: number): string[] }`
- `install` updates the same id (refreshes the copy); a new install gets `enabled: true`.

- [ ] Tests: install + listing; updating the same id; enable/disable; deletion; `../` id rejection; `catalog` skips disabled skills and truncates at 200 lines.
- [ ] Red → implement → green. Commit.

### Task 3: `load_skill` tool + catalog injection

**Files:** Create `server/engine/tools/skills.ts`, modify `server/sessions.ts`, `test/skill-tool.test.ts`

**Interfaces:**
- `loadSkillTool(store: SkillStore): Tool` — `load_skill {name}`, `access: 'read'`
- `SessionDeps.skills?: SkillStore`; a `## Skills` section is added to the system context
- `load_skill` is added to the active tool list (only when the store exists)

- [ ] Tests: the catalog enters the system text; the tool returns `ok:false` for an unknown/disabled skill; the body is returned for an enabled skill; the skill tool does not change its permission class.
- [ ] Red → implement → green. Commit.

### Task 4: HTTP endpoints

**Files:** Modify `server/http/server.ts`, `server/serve.ts`, `test/http-skills.test.ts`

**Interfaces:** `GET /api/skills`, `POST /api/skills {path}` or `{git}`, `DELETE /api/skills/:id`, `PATCH /api/skills/:id {enabled}`

- [ ] Tests: list; install from a folder; enable/disable; deletion; no token → 401.
- [ ] Red → implement → green. Commit.

### Task 5: UI screen

**Files:** Create `app/src/components/SkillGrid.tsx`, modify `app/src/App.tsx`, `app/src/styles.css`, `test/app-state.test.ts`

- [ ] Skills screen: add by path/git, list, on/off toggle, delete, preview (show the body).
- [ ] "Skills" button in the bottom bar.
- [ ] Reducer test: the `skills` action changes the list.
- [ ] `npm run app:build` clean. Commit.

## Phase 2b Completion Check

- [ ] `npm test` all pass, `npm run build` clean.
- [ ] Manual: a `SKILL.md` in a folder is added, appears in the catalog, and `load_skill` returns the body.

## Deliberately not done

Usage statistics and suggestion ranking (needs memory → Phase 3). Project-scoped skills (global install is enough; will come with memory in Phase 3).
