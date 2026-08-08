---
description: Set the project Airlock runtime without activating it
argument-hint: native|opencode
---

# Configure Airlock

Set the current project's runtime preference from `$ARGUMENTS`. Accept only `native` or `opencode`.

Write `.airlock/config.json` with exactly:

```json
{
  "schema": "airlock.config/v1",
  "runtime": "native"
}
```

Replace `native` with the selected runtime. Preserve unrelated files and create only the `.airlock` directory and config when absent. If the file exists with unknown fields or an unsupported schema, stop and show the conflict rather than overwriting it.

For `opencode`, check for local Node.js, Git, and OpenCode executables without installing or changing them. Record unavailable prerequisites but still write the explicit preference when the user requested it. Unsupported hosts fail closed when `/airlock:start` later tries to use the runtime.

End with one line: configured runtime and `Airlock remains off until /airlock:start`.
