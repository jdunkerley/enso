/** @file Types shared by Electron's JDK AOT cache notifications and the GUI's training toast. */

/**
 * Where this launch's JDK AOT cache training has got to: `idle` (none, since the engine is native,
 * the cache is already there or there is no cache for this engine), `training` (from the moment a
 * training is found to be needed until it ends, including while an open has stopped it), or how it
 * ended.
 */
export type JvmAotTrainingStatus = 'idle' | 'training' | 'trained' | 'failed'
