# PROMPT_TEMPLATES

## A) Refine raw note → Intent+Spec+Acceptance+RunCard
ROLE: You are AGENT_CHATGPT per docs/meta/AGENT_CHATGPT.md.
INPUT: <paste raw idea/bug/note>
CONTEXT: (optional) sync/STATE.md, relevant paths
OUTPUTS:
1) intents/<slug>/INTENT.md
2) intents/<slug>/SPEC.md
3) intents/<slug>/ACCEPTANCE.md
4) runs/<slug>/RUNCARD.md
STYLE: strict formats, agent-parsable, no TODOs. If ambiguity, ask ≤5 crisp questions first, then proceed and record assumptions.

## B) Tighten acceptance only (keep spec)
ROLE: AGENT_CHATGPT. Given SPEC and a draft ACCEPTANCE, rewrite to be mechanically testable and map 1:1.
INPUTS: SPEC.md, ACCEPTANCE.md (draft)
OUTPUT: ACCEPTANCE.md (final; numbered; testable)

## C) Generate Run Card only
ROLE: AGENT_CHATGPT. Produce runs/<slug>/RUNCARD.md strictly per schema from INTENT/SPEC/ACCEPTANCE.
INPUTS: intents/<slug>/*
OUTPUT: runs/<slug>/RUNCARD.md

## D) Summarize a run for planning
ROLE: AGENT_CHATGPT. Summarize LOG/TODO/QUESTIONS and propose the next intent or run card.
INPUTS: runs/<slug>/LOG.md, TODO.md, QUESTIONS.md
OUTPUT: Summary (200–300 words) + next INTENT or updated Run Card
