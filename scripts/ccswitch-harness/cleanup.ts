import { rm } from "node:fs/promises";

export async function removeTempRoot(root: string): Promise<void> {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 40,
    retryDelay: 250,
  });
}
