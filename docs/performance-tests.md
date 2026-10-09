# Performance Tests

The standalone k6 scripts under `tests/load/` exercise an MCP router over SSE. Run them against a separately deployed Wanaku instance and downstream MCP server. Barn supplies management and persistence APIs and does not run the MCP request path.

Install k6 with the `k6/x/mcp` extension. The scripts currently target `http://localhost:8080/public/mcp/sse`; adjust that URL and the tool/resource names to match your test deployment before running:

```shell
k6 run --vus 10 --duration 30s tests/load/mcp-tools-invoke-sse.js
k6 run --vus 10 --duration 30s tests/load/mcp-resources-read-sse.js
```

Collect the same workloads and virtual user levels for baseline and patched deployments, then compare the exported JSON summaries with `generate-perf-report.py`.

## Report Generation

`generate-perf-report.py` produces a Markdown comparison report from k6 JSON summary files.

### Expected Directory Structure

```text
$EVAL_DIR/
├── baseline/
│   ├── tools-invoke-sse/
│   │   ├── test-summary-vus-1.json
│   │   ├── test-summary-vus-10.json
│   │   ├── vmstat-baseline-tools-invoke-sse.log    # optional
│   │   └── java-procs-baseline-tools-invoke-sse.log # optional
│   └── resources-read-sse/
│       └── test-summary-vus-*.json
└── patched/
    ├── tools-invoke-sse/
    │   └── test-summary-vus-*.json
    └── resources-read-sse/
        └── test-summary-vus-*.json
```

### Usage

```bash
python3 tests/load/generate-perf-report.py \
  --eval-dir /path/to/eval-dir \
  --test-scope all \
  --output /path/to/report.md
```

Options:

- `--eval-dir` (required): directory containing `baseline/` and `patched/` subdirectories
- `--test-scope`: `all` (default), `tools`, or `resources`
- `--output`: output file path (defaults to `$EVAL_DIR/perf-report.md`)

### Key Metrics

The report tracks these metrics per VU level:

| Metric | Direction | Description |
|--------|-----------|-------------|
| `mcp_request_duration` (avg, med, p90, p95, max) | Lower is better | End-to-end MCP request latency |
| `mcp_request_count` (rate, count) | Higher is better | Throughput |
| `mcp_request_errors` (rate, count) | Lower is better | Error count |
| `iterations` (rate, count) | Higher is better | Full iteration throughput |
| `iteration_duration` (avg, p95) | Higher is better | Full iteration time (includes all MCP calls per iteration) |
| `data_sent` / `data_received` (rate) | Higher is better | Network throughput |

The report uses indicators: green circle for >5% improvement, red circle for >10% regression.
