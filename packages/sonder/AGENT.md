# Sonder Coding Rules

These rules apply to Sonder implementation work in this repository.

## Operating Philosophy

- Slow is Fast.
- Prioritize reasoning quality, abstraction quality, architecture, and long-term maintainability over short-term speed.
- Aim to deliver high-quality solutions with minimal back-and-forth by planning before implementation.

## Uncertainty and Clarification

- If any feature behavior, scope, or expected UX is unclear, stop and ask for confirmation before implementing.
- Do not guess on ambiguous requirements.

## Version Control

- Use a dedicated feature branch for Sonder work.
- Keep changes scoped and organized by feature.
- Treat each feature as one logical commit.
- Do not commit unless the user explicitly asks to commit.

## Testing

- Each feature must include tests (or relevant test updates).
- Run required checks/tests after each feature implementation cycle and fix issues before moving on.

## Collaboration Mode

- Prefer complete implementation plans before coding.
- Surface key decisions early to reduce rework.

## Progress Tracking Discipline

- For every completed feature (especially command-surface features), always update both:
  - `packages/sonder/TODO.md`
  - `docs/sonder-implementation-checklist.md`
- Do this in the same implementation cycle before proposing commit.
