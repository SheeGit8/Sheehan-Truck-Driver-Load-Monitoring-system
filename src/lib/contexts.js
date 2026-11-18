import { createContext, useContext } from 'react'

/** push(message, { type: 'success' | 'error', duration }) */
export const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

/** open({ title, subtitle, shots: [{ fileId | dataUrl, slot }] }) */
export const ViewerCtx = createContext(() => {})
export const useViewer = () => useContext(ViewerCtx)
