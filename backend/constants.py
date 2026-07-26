# No magic strings. All action names and config keys live here.

# API Actions
ACTION_SCAN = "scan"
ACTION_QUERY = "query"
ACTION_DIFF = "diff"
ACTION_STATUS = "status"

VALID_ACTIONS = {ACTION_SCAN, ACTION_QUERY, ACTION_DIFF, ACTION_STATUS}

# Scan statuses
SCAN_STATUS_PENDING = "pending"
SCAN_STATUS_PROCESSING = "processing"
SCAN_STATUS_DONE = "done"
SCAN_STATUS_FAILED = "failed"

# Prompt versions
PROMPT_SPATIAL_QA_VERSION = "v1.0"
PROMPT_CHANGE_DETECT_VERSION = "v1.0"

# LLM fallback chain
# Chain: Claude (cloud) → Ollama (local) → error
LLM_PRIMARY        = "claude-sonnet-5-20251101"   # needs ANTHROPIC_API_KEY
LLM_OLLAMA_MODEL   = "llama3.2:latest"             # local Ollama, always available
LLM_OLLAMA_HOST    = "http://localhost:11434"
