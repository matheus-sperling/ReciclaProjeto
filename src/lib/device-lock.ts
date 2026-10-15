export const deviceLockKey = "recicla-device-lock-v1";
export const deviceRevokedKey = "recicla-device-revoked-v1";
export const deviceUnlockedKey = "recicla-device-unlocked-v1";
export const collectorIdentityKey = "recicla-current-collector-v1";

export function deviceLock(storage: Storage = localStorage) {
  const value = storage.getItem(deviceLockKey);
  if (!value || storage.getItem(deviceUnlockedKey) === value) return null;
  return storage.getItem(deviceRevokedKey) === value
    ? value.replace(/^pending:/, "signed-out:")
    : value;
}

export function clearCollectorCache(storage: Storage = localStorage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && /^recicla-v3:[^:]+:[^:]+:(catalog|receipts)$/.test(key))
      keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  storage.removeItem(collectorIdentityKey);
}

export function beginDeviceLock(storage: Storage = localStorage) {
  const value = `pending:${crypto.randomUUID()}`;
  // Persist before clearing anything: a failed marker must not look like a
  // successful logout that an existing HttpOnly cookie could undo on reload.
  try {
    storage.setItem(deviceLockKey, value);
  } catch {
    throw new Error(
      "Não foi possível bloquear este dispositivo. Libere espaço no navegador sem apagar pendências e tente novamente.",
    );
  }
  // Outboxes must survive both local locking and remote session revocation.
  clearCollectorCache(storage);
  return value;
}

export function confirmDeviceLogout(
  value: string,
  storage: Storage = localStorage,
) {
  // Acknowledge the nonce rather than replacing/removing the lock. A logout
  // from another tab can arrive between any two localStorage operations.
  storage.setItem(deviceRevokedKey, value.replace(/^signed-out:/, "pending:"));
}

export function unlockDevice(
  value: string | null,
  storage: Storage = localStorage,
) {
  if (deviceLock(storage) !== value)
    throw new Error("O dispositivo foi bloqueado. Entre novamente.");
  if (value)
    storage.setItem(
      deviceUnlockedKey,
      value.replace(/^signed-out:/, "pending:"),
    );
}
