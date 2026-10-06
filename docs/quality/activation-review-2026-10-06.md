# Activation refinement — 2026-10-06

User direction: make the product understandable for all teams. Common jobs and role boundaries take priority over an assumed industry or company size. This is a refinement of the existing Tayvero design system, not a claim of a completed new visual identity.

## Five critique and improvement passes

1. **Time to value:** compulsory Context configuration blocked contacts, deals and tasks before a first useful record. Removed that provider from the workspace redirect gate. Naming the workspace now opens CRM directly; research remains an optional explicit page and settings capability.
2. **Truth of dependencies:** website is optional in onboarding copy and input; backend validates nonempty domains. Mailbox authorization remains an existing dependency and is not claimed as resolved. OAuth, sessions, membership and resource policies remain authoritative.
3. **Recovery and roles:** research has an explicit continue-without-research action. Missing keys and unavailable research cannot cause redirect loops. Members who cannot configure the workspace are not sent to owner setup. Unknown workspace responses still defer to server authorization.
4. **Authorship and hierarchy:** the authentication shell uses Tayvero identity, an editorial customer → next step → delegation sequence, restrained typography and native form controls. Removed the decorative shader, placeholder brand and unowned external link. The workflow is explanatory copy, not fabricated product evidence.
5. **Verification and restraint:** test the production proxy with real NextRequest objects, including absent keys, provider unavailability, unchanged cookie isolation and protected anonymous routes. Run app tests and semantic checks; do not describe component previews as authenticated browser validation. Live browser reopening remains blocked by browser policy from the preceding session.
6. **Cross-screen consistency:** a second check found that workspace settings still disabled Save for an empty website. Removed that inconsistent condition so a company without a website can be renamed and an old domain can be cleared. Added visible loading, retry and persistent save errors; preserved owner/admin restrictions.
7. **Mechanical craft review:** ran Impeccable's detector once after the UI edits. It reported three inherited font-size advisories in unchanged agent sidebar/chat-chip files and zero findings in changed files. This is a mechanical source check, not a substitute for usability or browser verification. See `product-design-detector-2026-10-06.json`.

## Evidence

The initial app-wide test attempt failed because TEST_DATABASE_URL was missing. A subsequent unit run used an explicit guarded localhost `_test` URL (no database operation in that run) and passed 203 tests, with zero failures. The focused production redirect suite contains 30 passing tests. Additional database-backed verification is recorded separately after execution; no live provider call is represented by this unit result.

## Remaining product gaps

- Separating mailbox connection from basic CRM activation needs an explicit dependency review, not deletion of the mailbox guard.
- Task creator and task assignee are currently the same available model concept. A real team assignment workflow needs schema, API, history and authorization changes.
- Full RU/UZ localization and authenticated browser journeys are not completed by these changes.
- Comparative superiority is unproven; use identical customer/deal/follow-up/agent tasks and measure completion time, errors and clarity before claiming it.
