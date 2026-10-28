import json
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from backend.config import HISTORY_FILE

def get_history() -> List[Dict[str, Any]]:
    if not HISTORY_FILE.exists():
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def add_history_entry(
    original_filename: str,
    conversion_type: str,
    status: str,
    output_location: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None
) -> Dict[str, Any]:
    history = get_history()
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now().isoformat(),
        "original_filename": original_filename,
        "conversion_type": conversion_type,
        "status": status,
        "output_location": output_location,
        "details": details or {},
        "error_message": error_message
    }
    # Keep most recent 500 entries
    history.insert(0, entry)
    history = history[:500]
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Failed to save history: {e}")
    return entry

def clear_history() -> bool:
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump([], f)
        return True
    except Exception:
        return False

def delete_history_entry(entry_id: str) -> bool:
    history = get_history()
    new_history = [e for e in history if e.get("id") != entry_id]
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(new_history, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False
