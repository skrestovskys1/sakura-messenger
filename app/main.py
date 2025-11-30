from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional
import os
import uuid
import aiofiles

from .database import engine, get_db, Base
from . import models, schemas, auth
from .websocket import manager

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Messenger")

os.makedirs("uploads", exist_ok=True)
os.makedirs("static/css", exist_ok=True)
os.makedirs("static/js", exist_ok=True)
os.makedirs("templates", exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
templates = Jinja2Templates(directory="templates")

# === AUTH ROUTES ===
@app.post("/api/register", response_model=schemas.Token)
async def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Имя пользователя занято")
    if db.query(models.User).filter(models.User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email уже используется")
    
    db_user = models.User(
        username=user.username,
        email=user.email,
        hashed_password=auth.get_password_hash(user.password)
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/login", response_model=schemas.Token)
async def login(user: schemas.UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if not db_user or not auth.verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверные учетные данные")
    
    token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}

@app.get("/api/me", response_model=schemas.UserResponse)
async def get_me(user: models.User = Depends(auth.get_current_user_required)):
    return user

# === PROFILE SETTINGS ===
@app.put("/api/profile")
async def update_profile(
    username: str = Form(None),
    email: str = Form(None),
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user_required)
):
    if username and username != user.username:
        if db.query(models.User).filter(models.User.username == username).first():
            raise HTTPException(status_code=400, detail="Имя пользователя занято")
        user.username = username
    if email and email != user.email:
        if db.query(models.User).filter(models.User.email == email).first():
            raise HTTPException(status_code=400, detail="Email уже используется")
        user.email = email
    db.commit()
    db.refresh(user)
    return {"status": "ok", "user": {"id": user.id, "username": user.username, "email": user.email, "avatar": user.avatar}}

@app.post("/api/profile/avatar")
async def update_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user_required)
):
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    if ext.lower() not in ["jpg", "jpeg", "png", "gif", "webp"]:
        raise HTTPException(status_code=400, detail="Только изображения")
    
    filename = f"avatar_{user.id}_{uuid.uuid4()}.{ext}"
    filepath = f"uploads/{filename}"
    
    async with aiofiles.open(filepath, 'wb') as f:
        content = await file.read()
        await f.write(content)
    
    user.avatar = f"/uploads/{filename}"
    db.commit()
    return {"status": "ok", "avatar": user.avatar}

@app.put("/api/profile/password")
async def change_password(
    old_password: str = Form(...),
    new_password: str = Form(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user_required)
):
    if not auth.verify_password(old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")
    user.hashed_password = auth.get_password_hash(new_password)
    db.commit()
    return {"status": "ok"}

# === USERS ROUTES ===
@app.get("/api/users", response_model=list[schemas.UserResponse])
async def get_users(db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user_required)):
    users = db.query(models.User).filter(models.User.id != user.id).all()
    for u in users:
        u.is_online = manager.is_online(u.id)
    return users

@app.get("/api/users/{user_id}", response_model=schemas.UserResponse)
async def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user.is_online = manager.is_online(user.id)
    return user

# === MESSAGES ROUTES ===
@app.get("/api/messages/{other_user_id}")
async def get_messages(
    other_user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user_required)
):
    messages = db.query(models.Message).filter(
        ((models.Message.sender_id == user.id) & (models.Message.receiver_id == other_user_id)) |
        ((models.Message.sender_id == other_user_id) & (models.Message.receiver_id == user.id))
    ).order_by(models.Message.created_at).all()
    
    # Помечаем как прочитанные
    for msg in messages:
        if msg.receiver_id == user.id and not msg.is_read:
            msg.is_read = True
    db.commit()
    
    return [{"id": m.id, "content": m.content, "file_url": m.file_url, "file_type": m.file_type,
             "sender_id": m.sender_id, "receiver_id": m.receiver_id, "is_read": m.is_read,
             "created_at": m.created_at.isoformat(), "sender": {"id": m.sender.id, "username": m.sender.username, "avatar": m.sender.avatar}} for m in messages]

# === GROUPS ROUTES ===
@app.post("/api/groups", response_model=schemas.GroupResponse)
async def create_group(
    group: schemas.GroupCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user_required)
):
    db_group = models.Group(name=group.name, description=group.description, owner_id=user.id)
    db_group.members.append(user)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

@app.get("/api/groups", response_model=list[schemas.GroupResponse])
async def get_groups(db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user_required)):
    return db.query(models.Group).filter(models.Group.members.any(id=user.id)).all()

@app.post("/api/groups/{group_id}/join")
async def join_group(group_id: int, db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user_required)):
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    if user not in group.members:
        group.members.append(user)
        db.commit()
    return {"status": "ok"}

@app.get("/api/groups/{group_id}/messages")
async def get_group_messages(group_id: int, db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user_required)):
    messages = db.query(models.Message).filter(models.Message.group_id == group_id).order_by(models.Message.created_at).all()
    return [{"id": m.id, "content": m.content, "file_url": m.file_url, "file_type": m.file_type,
             "sender_id": m.sender_id, "group_id": m.group_id, "created_at": m.created_at.isoformat(),
             "sender": {"id": m.sender.id, "username": m.sender.username, "avatar": m.sender.avatar}} for m in messages]


# === FILE UPLOAD ===
@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    user: models.User = Depends(auth.get_current_user_required)
):
    ext = file.filename.split(".")[-1] if "." in file.filename else ""
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = f"uploads/{filename}"
    
    async with aiofiles.open(filepath, 'wb') as f:
        content = await file.read()
        await f.write(content)
    
    if ext.lower() in ["jpg", "jpeg", "png", "gif", "webp"]:
        file_type = "image"
    elif ext.lower() in ["webm", "ogg", "mp3", "wav", "m4a"]:
        file_type = "voice"
    else:
        file_type = "file"
    return {"url": f"/uploads/{filename}", "type": file_type, "name": file.filename}

# === WEBSOCKET ===
@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    from jose import jwt, JWTError
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        username = payload.get("sub")
        user = db.query(models.User).filter(models.User.username == username).first()
        if not user:
            await websocket.close()
            return
    except JWTError:
        await websocket.close()
        return
    
    await manager.connect(websocket, user.id)
    user.is_online = True
    db.commit()
    
    # Уведомляем всех о статусе онлайн
    await manager.broadcast({"type": "status", "user_id": user.id, "is_online": True})
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data["type"] == "message":
                msg = models.Message(
                    content=data.get("content", ""),
                    file_url=data.get("file_url", ""),
                    file_type=data.get("file_type", ""),
                    sender_id=user.id,
                    receiver_id=data.get("receiver_id"),
                    group_id=data.get("group_id")
                )
                db.add(msg)
                db.commit()
                db.refresh(msg)
                
                response = {
                    "type": "message",
                    "id": msg.id,
                    "content": msg.content,
                    "file_url": msg.file_url,
                    "file_type": msg.file_type,
                    "sender_id": msg.sender_id,
                    "receiver_id": msg.receiver_id,
                    "group_id": msg.group_id,
                    "created_at": msg.created_at.isoformat(),
                    "sender": {"id": user.id, "username": user.username, "avatar": user.avatar}
                }
                
                if msg.receiver_id:
                    await manager.send_personal_message(response, msg.receiver_id)
                    await manager.send_personal_message(response, user.id)
                elif msg.group_id:
                    group = db.query(models.Group).filter(models.Group.id == msg.group_id).first()
                    if group:
                        member_ids = [m.id for m in group.members]
                        await manager.send_to_users(response, member_ids)
            
            elif data["type"] == "typing":
                typing_data = {"type": "typing", "user_id": user.id, "username": user.username}
                if data.get("receiver_id"):
                    await manager.send_personal_message(typing_data, data["receiver_id"])
                elif data.get("group_id"):
                    group = db.query(models.Group).filter(models.Group.id == data["group_id"]).first()
                    if group:
                        member_ids = [m.id for m in group.members if m.id != user.id]
                        await manager.send_to_users(typing_data, member_ids)
                        
    except WebSocketDisconnect:
        manager.disconnect(user.id)
        user.is_online = False
        user.last_seen = datetime.utcnow()
        db.commit()
        await manager.broadcast({"type": "status", "user_id": user.id, "is_online": False})

# === MAIN PAGE ===
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})
