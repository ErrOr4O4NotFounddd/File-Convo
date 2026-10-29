from typing import List, Dict, Any, Optional
from backend.config import HISTORY_FILE

def get_history() -> List[Dict[str, Any]]:
    """
    Conversion history persistence is disabled.
    Always returns an empty list.
    """
    return []

def add_history_entry(
    original_filename: str = "",
    conversion_type: str = "",
    status: str = "success",
    output_location: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None
) -> Dict[str, Any]:
    """
    Conversion history persistence is disabled.
    No records are saved to databases, JSON files, or persistent storage.
    Returns ephemeral metadata for backward compatibility with calling services.
    """
    return {
        "original_filename": original_filename,
        "conversion_type": conversion_type,
        "status": status,
        "output_location": output_location,
        "details": details or {},
        "error_message": error_message
    }

def clear_history() -> bool:
    """
    Purges any legacy history.json file if present on disk.
    """
    try:
        if HISTORY_FILE.exists():
            HISTORY_FILE.unlink(missing_ok=True)
        return True
    except Exception:
        return False

def delete_history_entry(entry_id: str) -> bool:
    """
    Conversion history persistence is disabled.
    Always returns True safely.
    """
    return True
