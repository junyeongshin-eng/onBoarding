import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import upload, imports, ai, export

app = FastAPI(title="Salesmap 데이터 가져오기 API", version="1.0.0")

# Get allowed origins from environment variable, fallback to localhost for development
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
allowed_origins = [origin.strip() for origin in allowed_origins_env.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(imports.router, prefix="/api", tags=["import"])
app.include_router(ai.router, prefix="/api", tags=["ai"])
app.include_router(export.router, prefix="/api", tags=["export"])


@app.get("/api/health")
def health_check():
    return {"status": "healthy"}
