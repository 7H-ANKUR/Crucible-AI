"""app/api/routers/mines.py — Mines list and summary"""
from fastapi import APIRouter, Depends

from ..core.db import query
from ..core.security import get_current_user

router = APIRouter(tags=["mines"])

@router.get("/mines")
def list_mines(user=Depends(get_current_user)):
    rows = query("SELECT * FROM ops.mines ORDER BY mine_id")
    return {"mines": rows, "count": len(rows), "data_origin": "SYNTHETIC"}

@router.get("/mines/{mine_id}")
def get_mine(mine_id: str, user=Depends(get_current_user)):
    rows = query("SELECT * FROM ops.mines WHERE mine_id = %s", (mine_id,))
    if not rows:
        from fastapi import HTTPException
        raise HTTPException(404, f"Mine {mine_id} not found")
    return rows[0]
