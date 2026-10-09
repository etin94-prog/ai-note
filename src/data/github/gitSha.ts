/** Git blob SHA-1 = sha1("blob <바이트수>\0<내용>"). 커밋 후 다시 받지 않고 캐시를 맞추는 데 사용. */
export async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const buf = new Uint8Array(header.byteLength + body.byteLength);
  buf.set(header, 0);
  buf.set(body, header.byteLength);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
