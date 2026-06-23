## Codex Usage Window Efficiency

- Prefer bounded reads instead of dumping full files: `sed -n '1,120p' file.log` and `rg -n "error" src --max-count 20`.
- Use file-head/tail limits for quick context: `head -n 40 README.md` or `tail -n 25 diagnostics.log`.
- Keep listing commands capped: `ls src --color=never | head -n 50` and avoid open-ended directory traversals.
- Query telemetry in summarized form first: `SELECT id, started_at FROM job_events WHERE status='failed' ORDER BY started_at DESC LIMIT 20;`.
- Ask for aggregates and top-N first: `SELECT error_code, COUNT(*) FROM telemetry GROUP BY error_code ORDER BY COUNT(*) DESC LIMIT 10;`.
- Use counts and filters before wide rows: `SELECT COUNT(*) FROM sessions WHERE created_at >= NOW() - INTERVAL '1 day';` then query one ID only if needed.
- Avoid repeated wide scans after edits: `git diff --name-only` followed by `rg -n "TODO|FIXME" src/changed/file.ts`.
- Batch nearby checks in one pass: `rg -n "TODO|FIXME|XXX" src --max-count 80` plus `sed -n '1,120p' src/config/*.json`.
- Keep command output small and focused: pipe to `head`, `tail`, or line limits, and save full dumps for explicit follow-up requests.
- Replace broad logs with summaries: `tail -n 200 app.log | rg -c "ERROR"` instead of opening the whole log file.
- Reduce tokens per turn by asking for scoped metrics: "top 10 slowest endpoints" via SQL `ORDER BY duration_ms DESC LIMIT 10`.
- Keep context tight across turns: summarize prior findings in one short list and avoid copying long command history or whole transcripts.
