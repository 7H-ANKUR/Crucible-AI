"""apps/api/routers/auth.py"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from ..core.security import (
    ROLE_DASHBOARD,
    authenticate_user,
    create_token,
    get_current_user,
)

router = APIRouter(tags=["auth"])

@router.post("/token")
def login(form: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form.username, form.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_token({"sub": form.username, "role": user["role"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["role"],
        "name": user["name"],
        "redirect_to": ROLE_DASHBOARD.get(user["role"], "/dashboard"),
    }

@router.get("/me")
def me(user=Depends(get_current_user)):
    return {"username": user["username"], "role": user["role"], "name": user["name"]}
