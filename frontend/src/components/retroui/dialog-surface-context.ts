import { createContext, useContext } from "react";

export const DialogSurfaceContext = createContext(false);

export function useInsideDialog() {
  return useContext(DialogSurfaceContext);
}
