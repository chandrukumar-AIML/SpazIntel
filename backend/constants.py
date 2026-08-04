# No magic strings. All action names and config keys live here.

# API Actions
ACTION_SCAN         = "scan"
ACTION_QUERY        = "query"
ACTION_DIFF         = "diff"
ACTION_STATUS       = "status"
ACTION_SCENE_GRAPH  = "scene_graph"
ACTION_MEASURE      = "measure"
ACTION_REPORT       = "report"
ACTION_SEARCH       = "search"
ACTION_RENAME       = "rename"
ACTION_DELETE       = "delete"

VALID_ACTIONS = {ACTION_SCAN, ACTION_QUERY, ACTION_DIFF, ACTION_STATUS, ACTION_SCENE_GRAPH, ACTION_MEASURE, ACTION_REPORT, ACTION_SEARCH, ACTION_RENAME, ACTION_DELETE}

# Scan statuses
SCAN_STATUS_PENDING = "pending"
SCAN_STATUS_PROCESSING = "processing"
SCAN_STATUS_DONE = "done"
SCAN_STATUS_FAILED = "failed"

# Prompt versions
PROMPT_SPATIAL_QA_VERSION = "v2.0"
PROMPT_CHANGE_DETECT_VERSION = "v1.0"

# LLM fallback chain
# Claude → Groq → Gemini → OpenAI → Ollama → DEMO_MODE canned response
LLM_PRIMARY        = "claude-sonnet-5"                # needs ANTHROPIC_API_KEY
LLM_GROQ_MODEL     = "llama-3.1-8b-instant"          # Groq free tier, needs GROQ_API_KEY
LLM_GEMINI_MODEL   = "gemini-1.5-flash"              # needs GEMINI_API_KEY
LLM_OPENAI_MODEL   = "gpt-3.5-turbo"                 # needs OPENAI_API_KEY
