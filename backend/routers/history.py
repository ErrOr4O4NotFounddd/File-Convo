from fastapi import APIRouter
from backend.services.history_service import get_history, clear_history, delete_history_entry

router = APIRouter(prefix="/api/history", tags=["History"])

@router.get("")
def api_get_history():
    return {"history": get_history()}

@router.delete("")
def api_clear_history():
    success = clear_history()
    return {"success": success}

@router.delete("/{entry_id}")
def api_delete_history_entry(entry_id: str):
    success = delete_history_entry(entry_id)
    return {"success": success}
