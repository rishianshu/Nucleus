.PHONY: promote start end summarize today lint-governance

promote:
	@bash scripts/promote.sh $(slug)

start:
	@bash scripts/start_run.sh $(slug)

end:
	@bash scripts/end_run.sh $(slug) $(status) "$(tests)" "$(commits)" "$(next)"

summarize:
	@bash scripts/summarize_run.sh $(slug)

today:
	@cat sync/STATE.md || echo "No STATE.md yet."

lint-governance:
	@echo "(TODO) validate schemas & drifts via scripts/lint_governance.sh"

lint-spec:
	@bash scripts/lint_spec.sh

prompt:
	@bash scripts/mk_prompt.sh $(slug)