# Round 2 Engineering-flow audit — live walk evidence

Live walk performed 2026-08-26 against the running dev stack (`http://acco.localhost:3000`,
`admin@acco.com`), project **Hodan District Office Tower** (`PRJ-V26NG`, contract
`ACCO-2026-V26NG`, status Active), at 1280×860 (desktop) and 633×863 (mobile). Findings feed
`docs/reference/round2-audit-engineering-flow.md`.

Screenshots were captured through the browser-automation host during the session (image IDs
`ss_*`); they are not committed to the repo. What each capture established:

| Surface | URL | What it confirmed |
|---|---|---|
| Overview (mobile 633px) | `/projects/{id}` | Header + status badge, one primary "Record practical completion" + overflow, lifecycle strip, mobile tab `<select>`, hairline 4-tile summary strip. Usable at 633px, no horizontal scroll on core content. |
| Overview (desktop) | `/projects/{id}` | Lifecycle **dots** (green/blue/grey) correct; 4-tile metric strip good; "Setup and control guidance" panel renders live ("No immediate attention required") — project attention feed is wired. Below it: 6 bordered cards restating strip facts (P1/P2). Money `$4,500,000.00` prefix (P3). |
| BOQ | `/projects/{id}/boq` | Reference tab: one primary "Start revision" + overflow, status-carrying progress bar 100%, "4 of 4 items priced", contract-baseline verdict, clean toolbar + `Table` with `(USD)` column labels. `$409,400.00` header total (B2). |
| Progress | `/projects/{id}/progress` | Inner sub-tab bar = third nav level (PR1/X3); always-expanded "New daily report" form leads, no page primary (PR2). |
| Commercial applications | `/projects/{id}/commercial/applications` | Inner sub-tab bar (X3); good metric strip (Open 1 / Submitted 2 / Effective 1); applications `Table` with **raw cuid `cmssv27jp004wtgaosje3ajxc` in the CERTIFICATE column** (A1); rows not clickable (A2); `$`-prefixed money. |

Owed: live walk of the IPA **detail** and IPC **wizard** (`/contracts/{id}/applications/{ipaId}`
and `.../certificates/new`) — grilled from code only this pass.
