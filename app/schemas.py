from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional, List

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    user_id: str
    username: str
    email: str
    avatar: str
    is_online: bool
    last_seen: datetime
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class MessageCreate(BaseModel):
    content: str
    receiver_id: Optional[int] = None
    group_id: Optional[int] = None

class MessageResponse(BaseModel):
    id: int
    content: str
    file_url: str
    file_type: str
    sender_id: int
    receiver_id: Optional[int]
    group_id: Optional[int]
    is_read: bool
    created_at: datetime
    sender: UserResponse
    
    class Config:
        from_attributes = True

class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = ""

class GroupResponse(BaseModel):
    id: int
    name: str
    description: str
    avatar: str
    owner_id: int
    created_at: datetime
    members: List[UserResponse]
    
    class Config:
        from_attributes = True
