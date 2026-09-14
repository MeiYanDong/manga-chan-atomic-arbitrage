export const EARN_DISCOVERY_RPC_POLICY = 'PUBLIC_FIRST_WITH_BOUNDED_MANAGED_FALLBACK'
export const EARN_EVENT_SOURCE_POLICY = 'MANAGED_WSS_EARN_SWAP_WITH_PUBLIC_RECOVERY'
export const EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP = 128
export const EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP = 192
export const EARN_PUBLIC_RECOVERY_POLL_MS = 60_000

/** @param {string | null | undefined} reason */
export function earnWakeKind(reason) {
  return reason && reason !== 'PERIODIC_RECOVERY' ? 'EVENT' : 'RECOVERY'
}

/** @param {string | null | undefined} reason */
export function earnManagedFallbackLogicalCallCap(reason) {
  return earnWakeKind(reason) === 'EVENT'
    ? EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP
    : EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP
}
