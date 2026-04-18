import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import fs from "fs"
import tailwindcss from '@tailwindcss/vite'


export default defineConfig({
  plugins: [
    {
      name: "agent-debug-alias-resolution",
      configResolved(config) {
        const typesDir = path.resolve(__dirname, "./src/types")
        const typesTs = path.resolve(__dirname, "./src/types.ts")
        const typesIndexTs = path.resolve(__dirname, "./src/types/index.ts")
        const typesIndexDts = path.resolve(__dirname, "./src/types/index.d.ts")
        // #region agent log
        fetch('http://127.0.0.1:7485/ingest/3a9a3448-1bd9-405f-8357-a95cb0abb46c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c521c'},body:JSON.stringify({sessionId:'8c521c',runId:'pre-fix',hypothesisId:'H1',location:'vite.config.ts:13',message:'Vite config resolved',data:{root:config.root,mode:config.mode,alias:config.resolve.alias},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        // #region agent log
        fetch('http://127.0.0.1:7485/ingest/3a9a3448-1bd9-405f-8357-a95cb0abb46c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c521c'},body:JSON.stringify({sessionId:'8c521c',runId:'pre-fix',hypothesisId:'H2',location:'vite.config.ts:15',message:'Checked @/types candidates',data:{typesDirExists:fs.existsSync(typesDir),typesTsExists:fs.existsSync(typesTs),typesIndexTsExists:fs.existsSync(typesIndexTs),typesIndexDtsExists:fs.existsSync(typesIndexDts)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      },
      resolveId(source) {
        if (source === "@/types" || source === "@/types/index") {
          // #region agent log
          fetch('http://127.0.0.1:7485/ingest/3a9a3448-1bd9-405f-8357-a95cb0abb46c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c521c'},body:JSON.stringify({sessionId:'8c521c',runId:'pre-fix',hypothesisId:'H3',location:'vite.config.ts:22',message:'resolveId intercepted @/types import',data:{source},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
        return null
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})