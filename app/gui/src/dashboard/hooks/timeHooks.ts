/** @file React hooks related to time. */
import { useEffect, useState } from 'react'

/** A React hook that presents current timestamp as state value and updates in specified interval. */
export function useCurrentTimestamp(refreshInterval: number) {
  const [timestampValue, setTimestampValue] = useState(Date.now())
  useEffect(() => {
    const interval = setInterval(() => setTimestampValue(Date.now()), refreshInterval)
    return () => clearInterval(interval)
  }, [refreshInterval])
  return timestampValue
}
