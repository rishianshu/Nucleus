# Your Role with Antigravity

## Quick Start
```
You say: "I want X"
Antigravity: Assesses complexity, creates artifacts if needed
You: Approve or give feedback
Antigravity: Implements
You: Merge
```

---

## Time Investment

| Activity | Your Time | Frequency |
| :--- | :--- | :--- |
| Ideas | 5% | As needed |
| Review artifacts | 20% | Per story |
| Unblock | 15% | When asked |
| Merge | 10% | Per completion |
| **Hands-off** | **50%** | Agent working |

---

## By Task Size

### Small Tasks (Tier 1)
**You say**: "Fix the null check in foo.go"
**You do**: Review diff → Merge
**Artifacts**: None needed (maybe DECISIONS.md)

### Stories (Tier 2)
**You say**: "Add retry logic to Jira connector"
**Antigravity creates**: INTENT + ACCEPTANCE
**You do**: Review artifacts → "LGTM" → Review code → Merge

### Big Design (Tier 3)
**You say**: "Design the metadata caching layer"
**Antigravity creates**: INTENT + SPEC + ADRs
**You do**: Deep review → Iterate → Approve → Review code → Merge

---

## When You're Asked

| Antigravity Says | You Do |
| :--- | :--- |
| "Review INTENT.md" | Check scope is correct |
| "Review ACCEPTANCE.md" | Check criteria are testable |
| "Review ADR" | Approve architectural choice |
| "Blocked on question" | Answer and unblock |
| "ESCALATION.md created" | Consult o1/pro model |

---

## Escalation to Reasoning Models

When Antigravity creates `ESCALATION.md`:
1. Copy the contents
2. Paste into o1 / Claude Pro
3. Get the decision
4. Tell Antigravity the answer

**When this happens**: Complex trade-offs, novel algorithms, uncertain architecture.

**How often**: Rare (maybe 5% of stories).

---

## Slash Commands

| Command | When to Use |
| :--- | :--- |
| `/fix <desc>` | Quick bug fix |
| `/story <desc>` | New feature |
| `/design <desc>` | Architecture work |
| `/ucl-connector` | New UCL connector |
| `/ucl-action` | New UCL action |

---

## Anti-Patterns

❌ **Over-specify**: Don't write detailed specs yourself. Say what you want, I'll structure it.

❌ **Delay answers**: If I'm blocked, I'm waiting. Respond within ~4 hours.

❌ **Skip review**: Trust but verify. Check the artifacts before I implement.

❌ **Vague feedback**: "Make it better" doesn't help. Be specific.

---

## Decision Points Cheat Sheet

```
┌────────────────────────────────────────┐
│          YOUR DECISION POINTS          │
├────────────────────────────────────────┤
│ INTENT → Is scope right?               │
│ ACCEPTANCE → Are criteria testable?    │
│ ADR → Is architecture sound?           │
│ ESCALATION → Consult reasoning model?  │
│ CODE → Merge?                          │
└────────────────────────────────────────┘
```
