# Contributing to Q11 Freedom

Thanks for helping. The most useful contribution right now is not code: it is
a report that Q11 Freedom worked, or did not, on a unit other than mine.

## Report a unit

Open a post in
[Discussions > It worked on my Q11](https://github.com/ramirezjhulian7/motorola-q11-freedom/discussions/categories/it-worked-on-my-q11)
with:

- Model on the label (MH7601, MH7602, MH7603 or other).
- Firmware version shown in **System** (for example `OpenWrt 2.0.1.390`).
- Number of units and whether they are wired or wireless to the master.
- What worked and what did not.

If something broke, open an issue instead and add the output of
`logread | tail -50` from the affected unit.

## Never attach

- Backups made by `scripts/backup-node.sh`.
- `/etc/shadow`, SSH keys, the mesh key or `/etc/config/freedom`.
- Your real WiFi name, password or public IP.

Redact them before pasting any log.

## Change the code

1. Work on the UI with `cd frontend && npm install && npm run demo`. Any
   password logs in and every value is fictional.
2. Keep the bundle small. The router has about 15 MB free, so a new dependency
   needs a good reason.
3. Never add a step that flashes firmware or writes outside the overlay. A
   factory reset must always bring the unit back to stock.
4. Run `npm run lint` and `npm run build` before opening the pull request.
5. Describe what you tested and on which model.

## Wanted

- Reports from MH7601 and MH7602 kits.
- Other Minim-era Motorola routers and mesh kits. The approach may apply even
  if the scripts need changes.
