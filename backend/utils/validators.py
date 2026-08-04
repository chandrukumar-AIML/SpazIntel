import re
from fastapi import HTTPException


def validate_scan_id(scan_id: str) -> str:
    """Accept only scan_<digits> or demo_scan_<word>. Reject anything with path traversal chars."""
    if not re.match(r'^(scan_\d+|scan_\w{1,32}|demo_scan_\w{1,32})$', scan_id):
        raise HTTPException(status_code=400, detail="Invalid scan_id format")
    return scan_id
