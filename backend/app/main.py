from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import upload, imports

app = FastAPI(title="Salesmap 데이터 가져오기 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(imports.router, prefix="/api", tags=["import"])


@app.get("/api/health")
def health_check():
    return {"status": "healthy"}
