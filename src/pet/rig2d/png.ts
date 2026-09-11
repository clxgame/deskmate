import { Rig2dError } from './config';
export const RIG2D_MAX_PNG_BYTES = 8 * 1024 * 1024;
export function validateRig2dPng(bytes: Uint8Array): void {
  const signature = [137,80,78,71,13,10,26,10];
  if (bytes.length < 33 || bytes.length > RIG2D_MAX_PNG_BYTES || signature.some((value,index) => bytes[index] !== value)) throw new Rig2dError('invalid PNG data');
  const header = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 || header.getUint32(16) !== 512 || header.getUint32(20) !== 512 || bytes[24] !== 8 || (bytes[25] !== 6 && bytes[25] !== 2) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) throw new Rig2dError('PNG must be 512×512 RGB8/RGBA8 and noninterlaced');
}
export async function readRig2dResponse(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Rig2dError('asset unavailable or oversized');
  if (!response.body) throw new Rig2dError('empty asset');
  const reader=response.body.getReader(), chunks: Uint8Array[]=[];
  let length=0;
  try {
    while (true) {
      const result=await reader.read(); if (result.done) break;
      length+=result.value.byteLength; if (length>limit) { await reader.cancel(); throw new Rig2dError('asset oversized'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(length); let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return bytes;
}

