import { useCallback, useState } from 'react'
import {
  readPersistedFlag,
  writePersistedFlag,
  type PersistedFlagKey,
} from '../state/persistedFlags'

/**
 * useState-shaped hook for a boolean that mirrors localStorage.
 *
 * Reads the initial value lazily from the registered key (falling back
 * to `defaultValue` when storage is empty or unavailable), and on every
 * setter call writes the resolved value back. The setter accepts both
 * `boolean` and `(prev: boolean) => boolean` like `setState`.
 */
export function usePersistedBoolean(
  key: PersistedFlagKey,
  defaultValue: boolean,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() =>
    readPersistedFlag(key, defaultValue),
  )

  const setPersisted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        writePersistedFlag(key, resolved)
        return resolved
      })
    },
    [key],
  )

  return [value, setPersisted]
}
