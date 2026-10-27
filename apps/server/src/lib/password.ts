import { hash, verify } from '@node-rs/argon2';

// Argon2id mit den OWASP-Empfehlungen (19 MiB, 2 Iterationen, Parallelität 1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashValue: string | null | undefined, password: string): Promise<boolean> {
  if (!hashValue) return false;
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

// Wird bei unbekannten Nutzern verwendet, damit die Antwortzeit nicht verrät, ob ein Konto existiert.
let dummyHash: Promise<string> | null = null;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
}
