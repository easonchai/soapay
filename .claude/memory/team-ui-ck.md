---
name: team-ui-ck
description: CK (a teammate) is building a separate UI design; our app UIs stay simple, with logic separated so it can be merged or compared later
metadata:
  type: project
---
As of 2026-09-25, CK is building his own UI for the apps in parallel. Our `apps/recipient` and `apps/sender` UIs are deliberately simple. All integration logic lives in hooks and framework-light modules (src/lib, services, hooks), and each app README documents "how to plug in another UI".

**Why:** the team will later either merge CK's design with our integration or compare the two and pick one.
**How to apply:** don't sink time into visual polish here. Before UI work, check whether CK's code has landed (ask the owner or look for his branch) and plan the merge or comparison.
