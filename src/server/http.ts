import type { Response } from "undici";

export async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Response exceeds the safe size limit.");
  }
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error("Response exceeds the safe size limit.");
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}
