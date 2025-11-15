# INTENT schema (v1)
- title: <single line>
- slug: <kebab-case>
- type: feature|bug|techdebt
- context: <where in system; files/dirs/modules>
- why_now: <value or dependency>
- scope_in:
  - <bullets>
- scope_out:
  - <bullets>
- acceptance:
  1. <assertion>
  2. <assertion>
- constraints:
  - perf/security/compat
- non_negotiables:
  - <must not break …>
- refs:
  - <links, doc paths>
- status: draft|ready|in-progress|done
