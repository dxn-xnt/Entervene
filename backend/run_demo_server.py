import os
import sys

os.environ["ENV_FILE"] = os.path.abspath("backend/.env.demo")
sys.path.insert(0, os.path.abspath("backend"))

import uvicorn

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("DEMO_PORT", 8001))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="info")
