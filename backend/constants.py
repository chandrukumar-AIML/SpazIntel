# No magic strings. All action names and config keys live here.

# API Actions
ACTION_SCAN         = "scan"
ACTION_QUERY        = "query"
ACTION_DIFF         = "diff"
ACTION_STATUS       = "status"
ACTION_SCENE_GRAPH  = "scene_graph"
ACTION_MEASURE      = "measure"

VALID_ACTIONS = {ACTION_SCAN, ACTION_QUERY, ACTION_DIFF, ACTION_STATUS, ACTION_SCENE_GRAPH, ACTION_MEASURE}

# Scan statuses
SCAN_STATUS_PENDING = "pending"
SCAN_STATUS_PROCESSING = "processing"
SCAN_STATUS_DONE = "done"
SCAN_STATUS_FAILED = "failed"

# Prompt versions
PROMPT_SPATIAL_QA_VERSION = "v2.0"
PROMPT_CHANGE_DETECT_VERSION = "v1.0"

# LLM fallback chain
# Chain: Claude (cloud) → Groq free tier → error
LLM_PRIMARY        = "claude-sonnet-5-20251101"      # needs ANTHROPIC_API_KEY
LLM_GROQ_MODEL     = "llama-3.1-8b-instant"          # Groq free tier, needs GROQ_API_KEY
