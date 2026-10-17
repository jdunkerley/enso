/**
 * @file Writing a project's open modules to disk before a version is saved. The ydoc server holds
 * the modules (it is the Language Server's client for them), so the GUI asks it on the index doc's
 * control channel. The client's end lives in `ydoc-shared/moduleFlusher`, beside the protocol, so
 * that the ydoc server's tests run it against the real session; this module is the GUI's name for
 * it.
 */
export {
  AUTOSAVE_FALLBACK_MS,
  FLUSH_TIMEOUT_MS,
  createModuleFlusher,
  type FlushOutcome,
} from 'ydoc-shared/moduleFlusher'
