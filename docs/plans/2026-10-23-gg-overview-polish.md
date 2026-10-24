# GG overview usability iteration

**Goal:** Make the locally installed GG overview easier to navigate and scan, retain known data across tab switches, and open issue-specific agent tabs without sending the issue.

**Scope:** User-requested iteration on IT-1983. Local-only Ovis extension; no upstream push or PR. Existing React/Bun and native Ovis controls, tokens and APIs. User-facing copy stays Hungarian.

**Design:** The global sidebar entry gets a LayoutDashboard icon, workspace-aligned insets and a selected state. Task rows have a linked title, quieter story/reason, labeled status chip and explicit Codex/Claude actions. Planned is neutral, ready/succeeded green, running blue, review accent, waiting accent, errors red, using semantic theme variables. Live agents remain distinct from durable tasks. Keep rows readable on narrow screens by wrapping actions below titles. Status text supplements color. No new dashboard cards or typography.

**Reference:** T3 Code's sidebar keeps a clear leading icon, active row and separate drafts (https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/Sidebar.tsx). Use the same navigation/draft separation, adapting to Ovis's existing native chrome; no code copied.

**Cache:** One app-lifetime memory store for the global feed; workspace views derive their slices from it. Retain data through unmounts, coalesce requests, refresh stale data in background. Manual refresh bypasses freshness. Failure retains known data and a warning. Clear and abort on auth lock; never persist core data in browser storage. Show source observation time.

**Issue actions:** Tamás simplified the request: first copy the issue URL to the clipboard, then open the new Codex/Claude tab. He pastes and adds instructions himself. Reuse createTab with an agent and no prompt. Never use first_message, prompt argv, submit or terminal input. Explicit startup failures open the created pane and explain the failure; ambiguous network failures never retry automatically. Action availability follows local connected workspace and installed agent catalog.

## Steps

- [x] Cache: behavioral unit tests for remount reuse, single-flight, manual refresh, retained data on error, auth-reset race; then implement app-owned store and panel subscription.
- [x] Visual: sidebar icon/insets/active state, task/agent status chips, quieter metadata, aligned/wrapping rows. Inspect test-session screenshots in dark/light narrow/desktop; no static CSS assertions.
- [x] Issue actions: test copying precedes creation and request has no send fields; clipboard/startup failures and double click. Reuse existing lifecycle and clipboard helper. Browser fixture asserts no automatic message.
- [ ] Typecheck/build, affected unit checks and isolated existing browser regression extended for cache and new actions. Fresh independent review for the launch/draft path. Install via existing updater, inspect range-diff if rebased and verify normal server revision.

## Review focus

No automatic message submission; local machine/workspace ownership and agent availability; no late response hijacking selection; no duplicate tab creation on double click/network uncertainty; no cached data surviving auth reset.

## Follow-up navigation correction

Tamás: switching workspaces in the sidebar must restore the last selected tab, while global overview links still explicitly open overview. Reuse the existing per-machine lastViewedPane storage with a workspace-view scope; @overview records the virtual tab and native pane IDs record native mode. Existing sidebar pane memory restores the native target. Next/previous pane retains its existing navigation order, inserting overview before each workspace. Watch mode retains native-only navigation. Pure navigation test and browser sidebar/shortcut transitions verify both.
