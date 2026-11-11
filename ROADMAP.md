# Posy roadmap

Where 1.x goes now that the format is frozen. A plan, not a promise of dates.

## The format is frozen (since 1.5.0)

The packet format (§5) and signaling (§2) are frozen. A 1.x release only **adds** — a new
optional data type or declared extra, a new profile, a block behind a reserved flag bit, a port
to another language (§9). Anything that changes or removes what exists needs a major version
(`posy/2`). Most new needs are a declared extra (§5.8), not a format change.

Anyone building on Posy at 1.5.0 or later can treat the wire as stable: a later 1.x peer and an
earlier one interoperate (§2.7, §9).

## How it got here

1.0 through 1.4.6 made the breaking changes the format needed — per-joint fingers, the two face
tiers, declared extras, a tested PMX driver, the session layer — each as its own reviewed release
in an open window. 1.5.0 closed the window after a run of real use (real people, live tracking, a
real relay, VRM and PMX avatars in one room, every wire feature exercised at least once) found no
fault in the protocol. The full step-by-step is in [`CHANGELOG.md`]; the reasoning behind the
harder calls is in [`docs/DECISIONS.md`].

## 2.0

2.0 is the place for a change that cannot be additive. None is planned.

---

*Spec changes start with an issue — see [`CONTRIBUTING.md`].*

[`CHANGELOG.md`]: CHANGELOG.md
[`docs/DECISIONS.md`]: docs/DECISIONS.md
[`CONTRIBUTING.md`]: CONTRIBUTING.md
