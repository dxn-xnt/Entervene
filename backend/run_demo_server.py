import os
import sys

os.environ["ENV_FILE"] = os.path.abspath("backend/.env.demo")
sys.path.insert(0, os.path.abspath("backend"))

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, log_level="info")
